import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CostStatus,
  LedgerAccount,
  LedgerSource,
  OrderStatus,
  PaymentKind,
  PaymentMethod,
  PriceKind,
  Prisma,
  TransportMode,
  TransportPaidStatus,
  Vehicle,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { otherFactoryKind, PricingService } from '../common/pricing.service';
import {
  autoAllocateClientPayment,
  clientUnallocatedPayments,
  CLIENT_SETTLING_KINDS,
  orderClientOutstanding,
} from '../common/auto-allocate';
import { SettingsService, SETTING_KEYS } from '../common/settings.service';
import { assertPositiveMoney, D, round2, round3, sum, ZERO } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { agentScope, assertOwnAgent, RequestUser } from '../common/scoping';
import { recomputeTransportStatus } from '../common/transport';
import { PalletService } from '../pallets/pallets.service';
import { BonusService } from '../bonus/bonus.service';
import {
  AddCommentDto,
  AdminOrderPatchDto,
  CancelOrderDto,
  CreateOrderDto,
  OrderItemDto,
  OrderListQueryDto,
  SetStatusDto,
  UpdateOrderDto,
} from './dto';

/** Lifecycle (CANCELLED is reachable only through cancel()). */
const STATUS_FLOW: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.LOADING,
  OrderStatus.DELIVERING,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];

const TX_OPTS = { maxWait: 10_000, timeout: 20_000 };

/**
 * Statuses at/after which the dealer→factory cost has been posted to the ledger
 * (postOrderSupplyLedger fires when the truck leaves the factory, i.e. entering LOADING).
 * Before that the order carries no factory debt, however large its costTotal looks.
 */
const COST_POSTED_STATUSES: OrderStatus[] = [
  OrderStatus.LOADING,
  OrderStatus.DELIVERING,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];

/**
 * DEALER_CHARGED billed transport ON TOP of the goods total, which contradicts how the
 * business actually prices: transport always sits INSIDE the agreed sum. The value stays
 * in the enum so historical orders keep rendering, but it may not be chosen again.
 */
function assertLiveTransportMode(mode: TransportMode): void {
  if (mode === TransportMode.DEALER_CHARGED) {
    throw new BadRequestException(
      "«Mijozdan alohida olinadi» rejimi ishlatilmaydi — transport summa ICHIDA hisoblanadi. " +
        "«Diller to'laydi» yoki «Mijoz shofyorga to'laydi» ni tanlang.",
    );
  }
}

interface BuiltItem {
  productId: string;
  quantityM3: Prisma.Decimal;
  palletCount: number;
  palletPrice: Prisma.Decimal;
  listPricePerM3: Prisma.Decimal | null;
  salePricePerM3: Prisma.Decimal;
  saleTotal: Prisma.Decimal;
  saleLumpSum: Prisma.Decimal | null;
  pricePending: boolean;
  provisionalPriceKind: PriceKind;
  costPricePerM3: Prisma.Decimal;
  costTotal: Prisma.Decimal;
}

interface BuiltItems {
  itemsData: BuiltItem[];
  factoryId: string;
  saleTotal: Prisma.Decimal;
  costTotal: Prisma.Decimal;
  totalPallets: number;
}

export type TimelineEvent =
  | { type: 'status'; at: Date; from: OrderStatus | null; to: OrderStatus; by: string | null; note: string | null }
  | {
      type: 'payment';
      at: Date;
      paymentId: string;
      kind: PaymentKind;
      method: PaymentMethod;
      amount: Prisma.Decimal;
      voided: boolean;
    }
  | { type: 'comment'; at: Date; by: string | null; text: string };

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private settings: SettingsService,
    private pricing: PricingService,
    private pallets: PalletService,
    private bonus: BonusService,
  ) {}

  // ─────────────────────────────── create ───────────────────────────────

  async create(dto: CreateOrderDto, user: RequestUser) {
    const date = new Date(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: dto.clientId } });
      if (!client || !client.active) throw new BadRequestException('Mijoz topilmadi yoki faol emas');
      assertOwnAgent(user, client.agentId);
      const agentId = client.agentId; // snapshot: agent KPIs are historical
      const dueDate = client.paymentTermDays
        ? new Date(date.getTime() + client.paymentTermDays * 86_400_000)
        : null;

      const provisionalPriceKind =
        dto.intendedPaymentMethod === 'CASH' ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;

      let vehicle: Vehicle | null = null;
      if (dto.vehicleId) {
        vehicle = await tx.vehicle.findUnique({ where: { id: dto.vehicleId } });
        if (!vehicle) throw new BadRequestException('Moshina topilmadi');
        if (vehicle.oneTime) throw new BadRequestException('Bir martalik moshina qayta ishlatilmaydi');
      } else if (dto.oneTimeVehicle) {
        // ad-hoc truck: minted hidden (oneTime=true) so its transport ledger has a real
        // VEHICLE FK, but it never joins the fleet or the picker. plate stays optional —
        // the partial-unique index only constrains oneTime=false rows.
        const otv = dto.oneTimeVehicle;
        vehicle = await tx.vehicle.create({
          data: {
            name: otv.name.trim(),
            plate: otv.plate?.trim() || null,
            driver: otv.driver?.trim() || null,
            phone: otv.phone?.trim() || null,
            oneTime: true,
          },
        });
      }

      const built = await this.buildOrderItems(tx, dto.items, {
        clientId: client.id,
        date,
        provisionalPriceKind,
        role: user.role,
      });

      await this.assertCapacity(built.totalPallets, vehicle);

      const transportMode = dto.transportMode ?? TransportMode.DEALER_ABSORBED;
      assertLiveTransportMode(transportMode);
      const transportCost =
        transportMode === TransportMode.CLIENT_OWN
          ? ZERO
          : this.toNonNegativeMoney(dto.transportCost, 'transportCost');
      // transport is INSIDE the goods total in every live mode — nothing is billed on top
      const transportCharge = ZERO;

      // ── limits — row locks serialize concurrent checks on the same client/agent ──
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${client.id} FOR UPDATE`;
      if (agentId) {
        await tx.$executeRaw`SELECT id FROM "Agent" WHERE id = ${agentId} FOR UPDATE`;
      }

      await this.assertClientCreditLimit(tx, client.id, client.creditLimit, built.saleTotal.plus(transportCharge));

      if (agentId) {
        const agent = await tx.agent.findUnique({ where: { id: agentId } });
        const limitRaw =
          agent?.debtLimit ?? (await this.settings.get<number | string | null>(SETTING_KEYS.agentDebtLimitDefault));
        if (limitRaw !== null && limitRaw !== undefined) {
          const limit = D(limitRaw);
          const outstanding = await this.ledger.agentOutstandingDebt(tx, agentId);
          // prospective: this order's own exposure counts toward the cap (mirrors the
          // client credit-limit gate). A purely retrospective check let a single large
          // order blow far past the limit as long as prior debt was still under it.
          const projected = outstanding.plus(built.saleTotal.plus(transportCharge));
          if (projected.gt(limit)) {
            throw new BadRequestException(
              `Agent qarz limiti: limit ${limit.toFixed(2)}, joriy qarz ${outstanding.toFixed(2)}, yangi buyurtma bilan ${projected.toFixed(2)} — bloklandi`,
            );
          }
        }
      }

      const [{ nextval }] = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('order_no_seq') AS nextval`;
      const orderNo = 'ORD-' + String(nextval).padStart(6, '0');

      const transportPaidStatus =
        transportMode !== TransportMode.CLIENT_OWN && transportCost.gt(0) && vehicle
          ? TransportPaidStatus.UNPAID
          : TransportPaidStatus.NOT_APPLICABLE;

      const order = await tx.order.create({
        data: {
          orderNo,
          date,
          dueDate,
          status: OrderStatus.NEW,
          agentId,
          clientId: client.id,
          factoryId: built.factoryId,
          vehicleId: vehicle?.id ?? null,
          driverName: dto.driverName ?? vehicle?.driver ?? null,
          saleTotal: built.saleTotal,
          costTotal: built.costTotal,
          costStatus: CostStatus.PROVISIONAL,
          transportMode,
          transportCost,
          transportCharge,
          transportPaidStatus,
          note: dto.note ?? null,
          createdById: user.userId,
          items: { create: built.itemsData },
        },
        include: { items: true },
      });

      await tx.orderStatusHistory.create({
        data: { orderId: order.id, from: null, to: OrderStatus.NEW, byId: user.userId },
      });

      // CLIENT debt is written immediately at create. The dealer→factory cost debt and
      // the driver transport-cost are posted later, when the truck leaves the factory
      // (LOADING transition) — see postOrderSupplyLedger in setStatus.
      await this.postOrderClientLedger(tx, {
        orderId: order.id,
        date,
        clientId: client.id,
        saleTotal: built.saleTotal,
        transportMode,
        transportCharge,
        createdById: user.userId,
      });

      await this.pallets.recordOrderPallets(tx, {
        orderId: order.id,
        clientId: client.id,
        factoryId: built.factoryId,
        date,
        items: order.items,
        createdById: user.userId,
      });

      // A client who is already in credit should not read as owing this order in full:
      // pull his standing advance onto it right away, oldest money first. This is the
      // same FIFO rule payments use, seen from the other side (order arrives after money).
      await this.applyClientAdvance(tx, client.id, user.userId);

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.CREATE,
        entity: 'Order',
        entityId: order.id,
        after: {
          orderNo,
          clientId: client.id,
          factoryId: built.factoryId,
          saleTotal: built.saleTotal.toFixed(2),
          costTotal: built.costTotal.toFixed(2),
          transportMode,
          transportCost: transportCost.toFixed(2),
          transportCharge: transportCharge.toFixed(2),
          items: order.items.length,
        },
      });

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          items: { include: { product: true } },
          client: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
          factory: { select: { id: true, name: true } },
          vehicle: { select: { id: true, name: true, plate: true } },
        },
      });
    }, TX_OPTS);
  }

  // ─────────────────────────────── reads ───────────────────────────────

  async findAll(user: RequestUser, q: OrderListQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.OrderWhereInput = {
      // caller filter first — agentScope spreads AFTER it, so an AGENT can never
      // widen the scope to another agent by passing ?agentId=
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...agentScope(user),
      ...(q.status ? { status: q.status } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.factoryId ? { factoryId: q.factoryId } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            date: {
              ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { orderNo: { contains: q.search, mode: 'insensitive' as const } },
              { client: { name: { contains: q.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        include: {
          client: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
          factory: { select: { id: true, name: true } },
          vehicle: { select: { id: true, name: true, plate: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    // Per-order client debt for the list's red column. One grouped query for the whole
    // page rather than N per-row lookups — the list is the hottest read in the app.
    const ids = items.map((o) => o.id);
    const settled = ids.length
      ? await this.prisma.paymentAllocation.groupBy({
          by: ['orderId'],
          where: {
            orderId: { in: ids },
            voidedAt: null,
            payment: { voidedAt: null, kind: { in: CLIENT_SETTLING_KINDS } },
          },
          _sum: { amount: true },
        })
      : [];
    const paidByOrder = new Map(settled.map((s) => [s.orderId, D(s._sum.amount ?? 0)]));

    const rows = items.map((o) => {
      const paid = paidByOrder.get(o.id) ?? ZERO;
      const left =
        o.status === OrderStatus.CANCELLED ? ZERO : round2(D(o.saleTotal).minus(paid));
      return {
        ...o,
        clientPaid: round2(paid).toFixed(2),
        clientOutstanding: (left.lessThan(0) ? ZERO : left).toFixed(2),
      };
    });
    return paged(rows, total, page, pageSize);
  }

  /**
   * Board (doska) — buyurtmalar status ustunlariga guruhlangan, har ustun uchun
   * jami (dona / m³ / paddon / summa) va tepada umumiy grand-total. Sahifalanmaydi
   * (bir yuk = bir moshina; dealer hajmida boshqarsa bo'ladi). Filtrlar findAll bilan
   * bir xil; status filtri board'da e'tiborsiz (barcha ustunlar ko'rsatiladi).
   */
  async board(user: RequestUser, q: OrderListQueryDto) {
    const where: Prisma.OrderWhereInput = {
      // caller filter first — agentScope spreads AFTER it (see findAll)
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...agentScope(user),
      // Board = faqat jarayondagi ish: bekor qilingan VA yakunlangan buyurtmalar
      // doskada ko'rinmaydi (yakunlanganlar vaqt o'tib ko'payib ketadi — ular
      // «Buyurtmalar» ro'yxatida qoladi). Grand-total ham shu jarayondagi ishga mos.
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.factoryId ? { factoryId: q.factoryId } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            date: {
              ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { orderNo: { contains: q.search, mode: 'insensitive' as const } },
              { client: { name: { contains: q.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        factory: { select: { id: true, name: true } },
        vehicle: { select: { id: true, name: true, plate: true } },
        items: { select: { quantityM3: true, palletCount: true } },
      },
    });

    const rows = orders.map((o) => {
      const { items, ...rest } = o;
      return {
        ...rest,
        totalM3: sum(items.map((i) => i.quantityM3)),
        totalPallets: items.reduce((a, i) => a + i.palletCount, 0),
        itemCount: items.length,
      };
    });

    // COMPLETED lane'i doskada chizilmaydi (yuqoridagi where uni allaqachon chiqarib
    // tashlagan — bo'sh «Yakunlandi» ustuni ko'rinmasin).
    const groups = STATUS_FLOW.filter((s) => s !== OrderStatus.COMPLETED).map((status) => {
      const laneRows = rows.filter((r) => r.status === status);
      return {
        status,
        count: laneRows.length,
        saleTotal: sum(laneRows.map((r) => r.saleTotal)),
        totalM3: sum(laneRows.map((r) => r.totalM3)),
        totalPallets: laneRows.reduce((a, r) => a + r.totalPallets, 0),
        rows: laneRows,
      };
    });

    const grand = {
      count: rows.length,
      saleTotal: sum(rows.map((r) => r.saleTotal)),
      totalM3: sum(rows.map((r) => r.totalM3)),
      totalPallets: rows.reduce((a, r) => a + r.totalPallets, 0),
    };

    return { groups, grand };
  }

  async findOne(id: string, user: RequestUser) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        client: true,
        agent: { select: { id: true, name: true } },
        factory: { select: { id: true, name: true } },
        vehicle: true,
        createdBy: { select: { id: true, name: true, username: true } },
        items: { include: { product: true } },
        statusHistory: { orderBy: { at: 'asc' }, include: { by: { select: { id: true, name: true } } } },
        comments: { orderBy: { createdAt: 'asc' }, include: { by: { select: { id: true, name: true } } } },
        allocations: { orderBy: { createdAt: 'asc' }, include: { payment: true } },
        ledgerEntries: { orderBy: { at: 'asc' } },
        palletTransactions: { orderBy: { at: 'asc' } },
        documents: true,
      },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    assertOwnAgent(user, order.agentId);

    // Dealer→factory cost is shown BOTH ways with EXACT sums (naqd / bank) — the order UI
    // no longer labels it "taxminiy". Prices are resolved at the order date; on a missing
    // kind we fall back to the item's stored cost price so a total is always defined.
    const resolveOr = async (productId: string, kind: PriceKind, fallback: Prisma.Decimal) => {
      try {
        return await this.pricing.resolveFactoryPrice(this.prisma, productId, kind, order.date);
      } catch {
        return fallback;
      }
    };
    let costTotalCash = ZERO;
    let costTotalBank = ZERO;
    for (const it of order.items) {
      const effM3 = it.actualQuantityM3 != null ? D(it.actualQuantityM3) : D(it.quantityM3);
      const effPallets = it.actualPalletCount != null ? it.actualPalletCount : it.palletCount;
      const palletMoney = D(it.palletPrice).mul(effPallets);
      const stored = D(it.finalCostPricePerM3 ?? it.costPricePerM3);
      const cashPrice = await resolveOr(it.productId, PriceKind.FACTORY_CASH, stored);
      const bankPrice = await resolveOr(it.productId, PriceKind.FACTORY_BANK, stored);
      costTotalCash = costTotalCash.plus(round2(effM3.mul(cashPrice).plus(palletMoney)));
      costTotalBank = costTotalBank.plus(round2(effM3.mul(bankPrice).plus(palletMoney)));
    }

    // Per-order settlement, the two figures the owner reads off this screen in red:
    // what the CLIENT still owes on this order, and what WE still owe the factory for it.
    const settlement = await this.orderSettlement(this.prisma, order);

    return {
      ...order,
      costTotalCash: round2(costTotalCash).toFixed(2),
      costTotalBank: round2(costTotalBank).toFixed(2),
      ...settlement,
    };
  }

  /**
   * CLIENT side: saleTotal − Σ active CLIENT_IN/TRANSPORT_DIRECT allocations (transport
   * lives inside saleTotal, so the driver's slice counts as settled).
   * FACTORY side: costTotal − Σ active FACTORY_OUT allocations, and only once the cost
   * has actually been posted to the ledger — before LOADING we owe the factory nothing
   * for this order, so showing a red debt then would be a lie.
   */
  private async orderSettlement(
    db: Prisma.TransactionClient | PrismaService,
    order: { id: string; saleTotal: Prisma.Decimal; costTotal: Prisma.Decimal; status: OrderStatus },
  ) {
    const tx = db as Prisma.TransactionClient;
    const clientOutstanding =
      order.status === OrderStatus.CANCELLED ? ZERO : await orderClientOutstanding(tx, order);
    const clientPaid = round2(D(order.saleTotal).minus(clientOutstanding));

    const factoryAgg = await tx.paymentAllocation.aggregate({
      where: {
        orderId: order.id,
        voidedAt: null,
        payment: { voidedAt: null, kind: PaymentKind.FACTORY_OUT },
      },
      _sum: { amount: true },
    });
    const factoryPaid = D(factoryAgg._sum.amount ?? 0);
    const costPosted = COST_POSTED_STATUSES.includes(order.status);
    const factoryOutstandingRaw = costPosted ? round2(D(order.costTotal).minus(factoryPaid)) : ZERO;

    return {
      clientPaid: clientPaid.toFixed(2),
      clientOutstanding: clientOutstanding.toFixed(2),
      factoryPaid: round2(factoryPaid).toFixed(2),
      factoryOutstanding: (factoryOutstandingRaw.lessThan(0) ? ZERO : factoryOutstandingRaw).toFixed(2),
      factoryCostPosted: costPosted,
    };
  }

  async timeline(id: string, user: RequestUser): Promise<TimelineEvent[]> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        statusHistory: { include: { by: { select: { name: true } } } },
        comments: { include: { by: { select: { name: true } } } },
        allocations: {
          include: {
            payment: {
              select: { id: true, date: true, kind: true, method: true, voidedAt: true },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    assertOwnAgent(user, order.agentId);

    const events: TimelineEvent[] = [
      ...order.statusHistory.map(
        (h): TimelineEvent => ({
          type: 'status',
          at: h.at,
          from: h.from,
          to: h.to,
          by: h.by?.name ?? null,
          note: h.note,
        }),
      ),
      ...order.allocations.map(
        (a): TimelineEvent => ({
          type: 'payment',
          at: a.payment.date,
          paymentId: a.payment.id,
          kind: a.payment.kind,
          method: a.payment.method,
          amount: a.amount,
          voided: Boolean(a.voidedAt || a.payment.voidedAt),
        }),
      ),
      ...order.comments.map(
        (c): TimelineEvent => ({ type: 'comment', at: c.createdAt, by: c.by?.name ?? null, text: c.text }),
      ),
    ];
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
    return events;
  }

  // ─────────────────────────────── update ───────────────────────────────

  /** ADMIN/ACCOUNTANT, status NEW/CONFIRMED, cost still PROVISIONAL. Full financial repost. */
  async update(id: string, dto: UpdateOrderDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      // serialize against concurrent cancel/setStatus/allocation on this order
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.order.findUnique({
        where: { id },
        include: { items: true, client: true },
      });
      if (!existing) throw new NotFoundException('Buyurtma topilmadi');
      if (existing.status !== OrderStatus.NEW && existing.status !== OrderStatus.CONFIRMED) {
        throw new BadRequestException('Faqat NEW yoki CONFIRMED holatdagi buyurtmani tahrirlash mumkin');
      }
      if (existing.costStatus !== CostStatus.PROVISIONAL) {
        throw new BadRequestException('Narx allokatsiya bilan qotirilgan');
      }

      const date = dto.date ? new Date(dto.date) : existing.date;
      // intendedPaymentMethod is not editable — keep the kind snapshotted at creation
      const provisionalPriceKind = existing.items[0]?.provisionalPriceKind ?? PriceKind.FACTORY_BANK;

      const vehicleId = dto.vehicleId === undefined ? existing.vehicleId : dto.vehicleId || null;
      let vehicle: Vehicle | null = null;
      if (vehicleId) {
        vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
        if (!vehicle) throw new BadRequestException('Moshina topilmadi');
      }

      const built = await this.buildOrderItems(tx, dto.items, {
        clientId: existing.clientId,
        date,
        provisionalPriceKind,
        role: user.role,
      });

      await this.assertCapacity(built.totalPallets, vehicle);

      // A legacy DEALER_CHARGED order cannot be edited at all. Editing reverses the order's
      // ledger and reposts it, and the repost no longer emits TRANSPORT_CHARGE — so the
      // client's receivable would silently shrink by the old charge with nothing to show
      // for it. Cancel + recreate is the only safe route.
      if (existing.transportMode === TransportMode.DEALER_CHARGED) {
        throw new BadRequestException(
          "Bu eski buyurtmada transport summa ustiga qo'shilgan — uni tahrirlab bo'lmaydi. " +
            'Bekor qilib, yangi buyurtma yarating.',
        );
      }
      const transportMode = dto.transportMode ?? existing.transportMode;
      assertLiveTransportMode(transportMode);
      const transportCost =
        transportMode === TransportMode.CLIENT_OWN
          ? ZERO
          : dto.transportCost === undefined
            ? round2(existing.transportCost)
            : this.toNonNegativeMoney(dto.transportCost, 'transportCost');
      const transportCharge = ZERO; // transport is INSIDE the goods total (see create)

      const dueDate = existing.client.paymentTermDays
        ? new Date(date.getTime() + existing.client.paymentTermDays * 86_400_000)
        : null;

      // serialize with concurrent creates on the same client, then reverse + recheck + repost
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${existing.clientId} FOR UPDATE`;

      await this.ledger.reverseAllForOrder(tx, id, 'Buyurtma tahrirlandi', user.userId);
      await this.pallets.reverseForOrder(tx, id, user.userId);

      // credit limit against the delta: old exposure is reversed out of the balance above
      await this.assertClientCreditLimit(
        tx,
        existing.clientId,
        existing.client.creditLimit,
        built.saleTotal.plus(transportCharge),
      );

      const transportPaidStatus =
        transportMode !== TransportMode.CLIENT_OWN && transportCost.gt(0) && vehicleId
          ? TransportPaidStatus.UNPAID
          : TransportPaidStatus.NOT_APPLICABLE;

      await tx.orderItem.deleteMany({ where: { orderId: id } });
      const updated = await tx.order.update({
        where: { id },
        data: {
          date,
          dueDate,
          factoryId: built.factoryId,
          vehicleId,
          driverName: dto.driverName === undefined ? existing.driverName : dto.driverName || null,
          note: dto.note === undefined ? existing.note : dto.note || null,
          saleTotal: built.saleTotal,
          costTotal: built.costTotal,
          costStatus: CostStatus.PROVISIONAL,
          transportMode,
          transportCost,
          transportCharge,
          transportPaidStatus,
          items: { create: built.itemsData },
        },
        include: { items: true },
      });

      // NEW/CONFIRMED only ⇒ supply side (factory/transport-cost) is not yet on the ledger;
      // repost the CLIENT side only (it will get the supply side at the LOADING transition).
      await this.postOrderClientLedger(tx, {
        orderId: id,
        date,
        clientId: existing.clientId,
        saleTotal: built.saleTotal,
        transportMode,
        transportCharge,
        createdById: user.userId,
      });

      await this.pallets.recordOrderPallets(tx, {
        orderId: id,
        clientId: existing.clientId,
        factoryId: built.factoryId,
        date,
        items: updated.items,
        createdById: user.userId,
      });

      // an already-settled transport (standing VEHICLE_OUT / TRANSPORT_DIRECT
      // payment) must survive the edit — derive the status, don't reset it
      await recomputeTransportStatus(tx, id);

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'Order',
        entityId: id,
        before: {
          saleTotal: round2(existing.saleTotal).toFixed(2),
          costTotal: round2(existing.costTotal).toFixed(2),
          transportCost: round2(existing.transportCost).toFixed(2),
          transportCharge: round2(existing.transportCharge).toFixed(2),
          transportMode: existing.transportMode,
        },
        after: {
          saleTotal: built.saleTotal.toFixed(2),
          costTotal: built.costTotal.toFixed(2),
          transportCost: transportCost.toFixed(2),
          transportCharge: transportCharge.toFixed(2),
          transportMode,
        },
      });

      return tx.order.findUniqueOrThrow({
        where: { id },
        include: {
          items: { include: { product: true } },
          client: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
          factory: { select: { id: true, name: true } },
          vehicle: { select: { id: true, name: true, plate: true } },
        },
      });
    }, TX_OPTS);
  }

  /**
   * Super-admin metadata patch — ANY status. Faqat ledger'siz maydonlar
   * (moshina/haydovchi/izoh). Moliyaga (narx/hajm/summa/tannarx) tegmaydi, shu
   * sabab logika buzilmaydi. Moshinani almashtirish faqat transport xarajati
   * hali yozilmagan bo'lsa mumkin (aks holda VEHICLE ledger yozuvi eski
   * moshinaga bog'liq qolib, nomuvofiqlik bo'ladi).
   */
  async adminPatch(id: string, dto: AdminOrderPatchDto, user: RequestUser) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Buyurtma topilmadi');
    if (existing.cancelledAt) throw new BadRequestException('Bekor qilingan buyurtmani tahrirlab bo‘lmaydi');

    const data: Prisma.OrderUncheckedUpdateInput = {};
    if (dto.driverName !== undefined) data.driverName = dto.driverName?.trim() || null;
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;

    if (dto.vehicleId !== undefined) {
      const nextVehicleId = dto.vehicleId || null;
      if (nextVehicleId !== existing.vehicleId) {
        const hasTransportCost = round2(existing.transportCost).gt(0) && !!existing.vehicleId;
        if (hasTransportCost) {
          throw new BadRequestException(
            "Moshinani almashtirib bo'lmaydi — bu buyurtmada transport xarajati yozilgan. Avval transport to'lovini bekor qiling.",
          );
        }
        if (nextVehicleId) {
          const v = await this.prisma.vehicle.findUnique({ where: { id: nextVehicleId } });
          if (!v) throw new BadRequestException('Moshina topilmadi');
        }
        data.vehicleId = nextVehicleId;
      }
    }

    if (Object.keys(data).length === 0) return this.findOne(id, user);

    const updated = await this.prisma.order.update({ where: { id }, data });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.UPDATE,
      entity: 'Order',
      entityId: id,
      before: { driverName: existing.driverName, note: existing.note, vehicleId: existing.vehicleId },
      after: { driverName: updated.driverName, note: updated.note, vehicleId: updated.vehicleId },
      note: 'Admin metadata tahriri (moliyasiz)',
    });
    return this.findOne(id, user);
  }

  // ─────────────────────────────── status ───────────────────────────────

  async setStatus(id: string, dto: SetStatusDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      // lock before validating — two racing transitions must apply sequentially,
      // each against the truly-current status (double COMPLETED would double-accrue)
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      assertOwnAgent(user, order.agentId);

      if (dto.to === OrderStatus.CANCELLED) {
        throw new BadRequestException('Bekor qilish faqat DELETE /orders/:id orqali amalga oshiriladi');
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException("Bekor qilingan buyurtma holatini o'zgartirib bo'lmaydi");
      }

      const fromIdx = STATUS_FLOW.indexOf(order.status);
      const toIdx = STATUS_FLOW.indexOf(dto.to);
      if (toIdx === fromIdx) throw new BadRequestException('Buyurtma allaqachon shu holatda');

      const privileged = user.role === 'ADMIN' || user.role === 'ACCOUNTANT';
      if (toIdx > fromIdx) {
        if (!privileged && toIdx !== fromIdx + 1) {
          throw new BadRequestException("Faqat keyingi bosqichga o'tish mumkin");
        }
      } else {
        if (!privileged) throw new ForbiddenException('Orqaga qaytarish faqat ADMIN/ACCOUNTANT uchun');
        if (toIdx !== fromIdx - 1) throw new BadRequestException('Faqat bir bosqich orqaga qaytarish mumkin');
      }

      const loadingIdx = STATUS_FLOW.indexOf(OrderStatus.LOADING);
      if (toIdx >= loadingIdx && !order.vehicleId) {
        throw new BadRequestException('Moshina biriktirilmagan');
      }

      // supply-side debts (factory cost + driver transport) are posted the moment the
      // truck leaves the factory — i.e. crossing INTO the LOADING band — and reversed
      // when the order is pulled back out of it.
      const enteringLoading = fromIdx < loadingIdx && toIdx >= loadingIdx;
      const leavingLoading = fromIdx >= loadingIdx && toIdx < loadingIdx;

      if (leavingLoading) {
        const factoryPaid = await tx.paymentAllocation.count({
          where: { orderId: id, voidedAt: null, payment: { kind: PaymentKind.FACTORY_OUT, voidedAt: null } },
        });
        if (factoryPaid > 0) {
          throw new BadRequestException("Zavodga to'lov qilingan — orqaga qaytarish uchun avval to'lovni bekor qiling");
        }
        // The driver's transport cost is posted with the supply side at LOADING and is
        // reversed on the way out. If a transport payment already SETTLED that liability
        // (VEHICLE_OUT, or TRANSPORT_DIRECT paid by the client), reversing only the cost
        // leaves the payment stranded and flips the VEHICLE account positive — a phantom
        // advance to the driver. Same rule as the factory side: void the payment first.
        const transportPaid = await tx.paymentAllocation.count({
          where: {
            orderId: id,
            voidedAt: null,
            payment: {
              kind: { in: [PaymentKind.VEHICLE_OUT, PaymentKind.TRANSPORT_DIRECT] },
              voidedAt: null,
            },
          },
        });
        if (transportPaid > 0) {
          throw new BadRequestException(
            "Transport to'lovi qilingan — orqaga qaytarish uchun avval shofyor to'lovini bekor qiling",
          );
        }
        const loaded = await tx.orderItem.count({ where: { orderId: id, actualQuantityM3: { not: null } } });
        if (loaded > 0) {
          throw new BadRequestException("Haqiqiy yuk kiritilgan — orqaga qaytarib bo'lmaydi");
        }
      }

      const enteringCompleted = dto.to === OrderStatus.COMPLETED;
      const leavingCompleted = order.status === OrderStatus.COMPLETED && toIdx < fromIdx;

      const updated = await tx.order.update({
        where: { id },
        data: {
          status: dto.to,
          ...(enteringCompleted ? { completedAt: new Date() } : {}),
          ...(leavingCompleted ? { completedAt: null } : {}),
        },
      });

      await tx.orderStatusHistory.create({
        data: { orderId: id, from: order.status, to: dto.to, byId: user.userId, note: dto.note ?? null },
      });

      if (enteringLoading) {
        await this.postOrderSupplyLedger(tx, {
          orderId: id,
          date: order.date,
          factoryId: order.factoryId,
          vehicleId: order.vehicleId,
          costTotal: D(order.costTotal),
          transportMode: order.transportMode,
          transportCost: D(order.transportCost),
          createdById: user.userId,
        });
      }
      if (leavingLoading) {
        await this.ledger.reverseOrderByAccounts(
          tx,
          id,
          [LedgerAccount.FACTORY, LedgerAccount.VEHICLE],
          'Yuklashdan qaytarildi — zavod/transport qarzi bekor qilindi',
          user.userId,
        );
      }

      if (enteringCompleted) await this.bonus.accrueForOrder(tx, id, user.userId);
      if (leavingCompleted) await this.bonus.reverseForOrder(tx, id, user.userId);

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.STATUS_CHANGE,
        entity: 'Order',
        entityId: id,
        before: { status: order.status },
        after: { status: dto.to },
        note: dto.note ?? null,
      });

      return updated;
    }, TX_OPTS);
  }

  // ─────────────────────────────── cancel ───────────────────────────────

  /** Soft-cancel: compensating ledger/pallet/bonus entries; payments stay on the client account. */
  async cancel(id: string, dto: CancelOrderDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      // same lock as setStatus/allocation recompute — cancel decides its reversals
      // from a state no concurrent transaction can be mid-flight on
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Buyurtma allaqachon bekor qilingan');
      }

      const updated = await tx.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED, cancelReason: dto.reason, cancelledAt: new Date() },
      });

      await tx.orderStatusHistory.create({
        data: { orderId: id, from: order.status, to: OrderStatus.CANCELLED, byId: user.userId, note: dto.reason },
      });

      await this.ledger.reverseAllForOrder(tx, id, 'Buyurtma bekor qilindi: ' + dto.reason, user.userId);
      await this.pallets.reverseForOrder(tx, id, user.userId);
      // unconditional — reverseForOrder is idempotent (skips when no accrual exists)
      await this.bonus.reverseForOrder(tx, id, user.userId);

      // detach payments from the dead order — the money stays on the client's account
      await tx.paymentAllocation.updateMany({
        where: { orderId: id, voidedAt: null },
        data: { voidedAt: new Date() },
      });

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.VOID,
        entity: 'Order',
        entityId: id,
        before: {
          status: order.status,
          saleTotal: round2(order.saleTotal).toFixed(2),
          costTotal: round2(order.costTotal).toFixed(2),
        },
        after: { status: OrderStatus.CANCELLED, cancelReason: dto.reason },
      });

      return updated;
    }, TX_OPTS);
  }

  // ─────────────────────────────── comments ───────────────────────────────

  async addComment(orderId: string, dto: AddCommentDto, user: RequestUser) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, agentId: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    assertOwnAgent(user, order.agentId);
    return this.prisma.orderComment.create({
      data: { orderId, byId: user.userId, text: dto.text },
      include: { by: { select: { id: true, name: true } } },
    });
  }

  async listComments(orderId: string, user: RequestUser) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, agentId: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    assertOwnAgent(user, order.agentId);
    return this.prisma.orderComment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      include: { by: { select: { id: true, name: true } } },
    });
  }

  // ─────────────────────────────── late pricing ───────────────────────────────

  /**
   * Prices a pricePending item after the fact (workbook reality: goods sometimes
   * ship before the price is agreed — Шиддат моналит case). Posts the item's
   * sale as a fresh ORDER_SALE entry dated to the order's business date; debt
   * recognition simply happens late, per the owner's recognize-at-creation rule.
   */
  async priceItem(
    orderId: string,
    itemId: string,
    dto: { salePricePerM3?: string | number; saleLumpSum?: string | number },
    user: RequestUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException("Bekor qilingan buyurtma narxlanmaydi");
      }
      const item = order.items.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('Buyurtma pozitsiyasi topilmadi');
      if (!item.pricePending) {
        throw new BadRequestException('Bu pozitsiya allaqachon narxlangan');
      }

      let salePricePerM3: Prisma.Decimal;
      let saleTotal: Prisma.Decimal;
      const qty = item.actualQuantityM3 != null ? D(item.actualQuantityM3) : D(item.quantityM3);
      if (dto.saleLumpSum != null) {
        saleTotal = round2(this.toPositiveMoneyRaw(dto.saleLumpSum, 'saleLumpSum'));
        salePricePerM3 = saleTotal.dividedBy(qty).toDecimalPlaces(6);
      } else if (dto.salePricePerM3 != null) {
        salePricePerM3 = this.toPositiveMoneyRaw(dto.salePricePerM3, 'salePricePerM3').toDecimalPlaces(6);
        saleTotal = round2(qty.times(salePricePerM3));
      } else {
        throw new BadRequestException('salePricePerM3 yoki saleLumpSum majburiy');
      }

      // late pricing recognizes new client debt — gate it on the credit limit like
      // every other debt-posting path (order create, admin reprice), else a pending
      // item could be priced straight past the client's limit.
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${order.clientId} FOR UPDATE`;
      const priceClient = await tx.client.findUnique({
        where: { id: order.clientId },
        select: { creditLimit: true },
      });
      await this.assertClientCreditLimit(tx, order.clientId, priceClient?.creditLimit ?? null, saleTotal);

      await tx.orderItem.update({
        where: { id: itemId },
        data: { salePricePerM3, saleTotal, saleLumpSum: dto.saleLumpSum != null ? saleTotal : null, pricePending: false },
      });
      const newOrderSale = round2(D(order.saleTotal).plus(saleTotal));
      await tx.order.update({ where: { id: orderId }, data: { saleTotal: newOrderSale } });

      await this.ledger.post(tx, {
        date: order.date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.ORDER_SALE,
        amount: saleTotal,
        clientId: order.clientId,
        orderId,
        note: `Kechiktirilgan narxlash (${item.id.slice(0, 8)})`,
        createdById: user.userId,
      });

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'OrderItem',
        entityId: itemId,
        before: { pricePending: true, saleTotal: '0.00' },
        after: { salePricePerM3: salePricePerM3.toFixed(6), saleTotal: saleTotal.toFixed(2) },
        note: 'Late pricing',
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    }, TX_OPTS);
  }

  /**
   * Super-admin sotuv narxini TUZATISH — ANY status, ANY pozitsiya. Faqat mijoz
   * (sale) tomonini o'zgartiradi: yangi−eski saleTotal deltasini CLIENT ledger'ga
   * ADJUSTMENT sifatida yozadi. Balans doim SUM(ledger) bo'lgani uchun to'g'ri
   * qoladi — logika buzilmaydi. Zavod tannarxi, bonus va transportga TEGILMAYDI.
   */
  async adminRepriceItem(
    orderId: string,
    itemId: string,
    dto: { salePricePerM3?: string | number; saleLumpSum?: string | number },
    user: RequestUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (order.status === OrderStatus.CANCELLED) throw new BadRequestException('Bekor qilingan buyurtma narxlanmaydi');
      const item = order.items.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('Buyurtma pozitsiyasi topilmadi');

      const qty = item.actualQuantityM3 != null ? D(item.actualQuantityM3) : D(item.quantityM3);
      if (qty.lte(0)) throw new BadRequestException('Hajmi 0 pozitsiyani narxlab bo‘lmaydi');

      let salePricePerM3: Prisma.Decimal;
      let saleTotal: Prisma.Decimal;
      if (dto.saleLumpSum != null) {
        saleTotal = round2(this.toPositiveMoneyRaw(dto.saleLumpSum, 'saleLumpSum'));
        salePricePerM3 = saleTotal.dividedBy(qty).toDecimalPlaces(6);
      } else if (dto.salePricePerM3 != null) {
        salePricePerM3 = this.toPositiveMoneyRaw(dto.salePricePerM3, 'salePricePerM3').toDecimalPlaces(6);
        saleTotal = round2(qty.times(salePricePerM3));
      } else {
        throw new BadRequestException('salePricePerM3 yoki saleLumpSum majburiy');
      }

      const oldSale = round2(D(item.saleTotal));
      const delta = round2(saleTotal.minus(oldSale));

      await tx.orderItem.update({
        where: { id: itemId },
        data: { salePricePerM3, saleTotal, saleLumpSum: dto.saleLumpSum != null ? saleTotal : null, pricePending: false },
      });
      await tx.order.update({ where: { id: orderId }, data: { saleTotal: round2(D(order.saleTotal).plus(delta)) } });

      if (!delta.isZero()) {
        if (delta.gt(0)) {
          await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${order.clientId} FOR UPDATE`;
          const client = await tx.client.findUnique({ where: { id: order.clientId }, select: { creditLimit: true } });
          await this.assertClientCreditLimit(tx, order.clientId, client?.creditLimit ?? null, delta);
        }
        await this.ledger.post(tx, {
          date: order.date,
          account: LedgerAccount.CLIENT,
          source: LedgerSource.ADJUSTMENT,
          amount: delta,
          clientId: order.clientId,
          orderId,
          note: `Admin narx tuzatishi (${item.id.slice(0, 8)}): ${oldSale.toFixed(2)} → ${saleTotal.toFixed(2)}`,
          createdById: user.userId,
        });
      }

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'OrderItem',
        entityId: itemId,
        before: { saleTotal: oldSale.toFixed(2) },
        after: { saleTotal: saleTotal.toFixed(2), salePricePerM3: salePricePerM3.toFixed(6) },
        note: 'Admin reprice (sale-only delta)',
      });

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { include: { product: true } } },
      });
    }, TX_OPTS);
  }

  private toPositiveMoneyRaw(v: string | number, field: string): Prisma.Decimal {
    const d = D(v);
    if (!d.isFinite() || d.lessThanOrEqualTo(0)) {
      throw new BadRequestException(`${field} musbat son bo'lishi kerak`);
    }
    return d;
  }

  // ─────────────────────────── actual loading (zavoddan chiqqan yuk) ───────────────────────────

  /**
   * Yuklashda haqiqiy yuk miqdorini kiritish (LOADING..DELIVERED). Faqat ADMIN/ACCOUNTANT
   * (SmartBlok'da zavod-ishchi roli yo'q). Zavoddan chiqqach yuk rejadagidan farq qilishi
   * mumkin — har pozitsiyaning actualQuantityM3/actualPalletCount saqlanadi, so'ng hamma
   * balans (mijoz sotuvi + zavod tannarxi) haqiqiy miqdorga IDEMPOTENT delta bilan
   * moslashtiriladi. NARX kiritilmaydi (xavfsizlik) — faqat miqdor.
   */
  async applyActualLoading(
    orderId: string,
    dto: { items: { itemId: string; actualQuantityM3?: string | number }[] },
    user: RequestUser,
  ) {
    if (user.role !== 'ADMIN' && user.role !== 'ACCOUNTANT') {
      throw new ForbiddenException('Haqiqiy yukni faqat ADMIN/ACCOUNTANT kiritadi');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Bekor qilingan buyurtmaga haqiqiy yuk kiritilmaydi');
      }
      // goods leave the factory at LOADING; correction allowed through DELIVERED. NOT
      // after COMPLETED (bonus already accrued off the then-current cost) — un-complete
      // first to correct, so the reconcile never needs to re-touch bonus.
      const idx = STATUS_FLOW.indexOf(order.status);
      if (idx < STATUS_FLOW.indexOf(OrderStatus.LOADING) || order.status === OrderStatus.COMPLETED) {
        throw new BadRequestException(
          'Haqiqiy yuk faqat yuklashdan keyin (LOADING / DELIVERING / DELIVERED) kiritiladi',
        );
      }
      // gate to PROVISIONAL cost: the qty cost-delta is posted at the provisional price
      // as ORDER_COST. Once the factory cost is finalized (PARTIAL/FINAL), changing qty
      // would desync the finalization COST_ADJUSTMENT — void the factory payment first.
      if (order.costStatus !== CostStatus.PROVISIONAL) {
        throw new BadRequestException(
          "Zavod tannarxi allaqachon qotirilgan — haqiqiy miqdorni o'zgartirish uchun avval zavod to'lovini bekor qiling",
        );
      }

      const byId = new Map(order.items.map((i) => [i.id, i]));
      let touched = 0;
      for (const line of dto.items) {
        if (!byId.has(line.itemId)) throw new BadRequestException(`Pozitsiya topilmadi: ${line.itemId}`);
        if (this.hasValue(line.actualQuantityM3)) {
          await tx.orderItem.update({
            where: { id: line.itemId },
            data: { actualQuantityM3: this.toPositiveVolume(line.actualQuantityM3!, 'actualQuantityM3') },
          });
          touched++;
        }
      }
      if (touched === 0) throw new BadRequestException('Kamida bitta pozitsiya uchun haqiqiy hajm kiriting');

      await tx.order.update({ where: { id: orderId }, data: { loadedAt: new Date(), loadedById: user.userId } });

      // reconcile every ledger level (client sale + factory cost) to the actual qty
      await this.reconcileOrderToActual(tx, orderId, user.userId);

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'Order',
        entityId: orderId,
        after: {
          loaded: true,
          items: dto.items.map((l) => ({
            itemId: l.itemId,
            actualQuantityM3: l.actualQuantityM3 ?? null,
          })),
        },
        note: 'Haqiqiy yuk kiritildi',
      });

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { include: { product: true } }, client: { select: { id: true, name: true } } },
      });
    }, TX_OPTS);
  }

  /**
   * Buyurtma balanslarini HAQIQIY miqdorga moslashtiradi (IDEMPOTENT). Har pozitsiya
   * uchun effektiv miqdor = actual ?? planned. Sotuv (per-m³) va zavod tannarxi shu
   * miqdorga qayta hisoblanadi; farq (delta = target − order.{sale,cost}Total) append-only
   * ledger qatori sifatida yoziladi. Kelishilgan LUMP-SUM va TRANSPORT (flat, per-truck)
   * O'ZGARMAYDI. `order.{sale,cost}Total` — haqiqat manbasi; `recomputeOrderCost` (to'lov)
   * ham shu asosdan delta yozadi → ikki marta sanamaydi, doim to'g'ri targetga yaqinlashadi.
   */
  private async reconcileOrderToActual(tx: Prisma.TransactionClient, orderId: string, userId: string) {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status === OrderStatus.CANCELLED) return;

    let newSaleTotal = ZERO;
    let newCostTotal = ZERO;
    const itemUpdates: { id: string; saleTotal: Prisma.Decimal; costTotal: Prisma.Decimal }[] = [];
    for (const item of order.items) {
      const effM3 = item.actualQuantityM3 != null ? D(item.actualQuantityM3) : D(item.quantityM3);
      const effPallets = item.actualPalletCount != null ? item.actualPalletCount : item.palletCount;

      // sale: pending → 0; lump-sum → FIXED; per-m³ → scales with effective m³
      const itemSale = item.pricePending
        ? ZERO
        : item.saleLumpSum != null
          ? round2(D(item.saleLumpSum))
          : round2(effM3.mul(item.salePricePerM3));

      // cost: effective m³ × best-known factory price + effective pallets × pallet price
      const costPrice = item.finalCostPricePerM3 != null ? D(item.finalCostPricePerM3) : D(item.costPricePerM3);
      const itemCost = round2(effM3.mul(costPrice).plus(D(item.palletPrice).mul(effPallets)));

      newSaleTotal = newSaleTotal.plus(itemSale);
      newCostTotal = newCostTotal.plus(itemCost);
      itemUpdates.push({ id: item.id, saleTotal: itemSale, costTotal: itemCost });
    }
    newSaleTotal = round2(newSaleTotal);
    newCostTotal = round2(newCostTotal);

    // CLIENT sale delta — base is order.saleTotal (== current CLIENT sale-ledger sum),
    // posted as ORDER_SALE so the balance converges to the actual sale exactly.
    const saleDelta = round2(newSaleTotal.minus(round2(D(order.saleTotal))));
    if (!saleDelta.isZero()) {
      // a qty increase recognizes NEW client debt — gate it on the credit limit like
      // create/priceItem/adminReprice, else an actual-loading bump could push a client
      // straight past a limit that an equivalent reprice would have blocked.
      if (saleDelta.gt(0)) {
        await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${order.clientId} FOR UPDATE`;
        const client = await tx.client.findUnique({
          where: { id: order.clientId },
          select: { creditLimit: true },
        });
        await this.assertClientCreditLimit(tx, order.clientId, client?.creditLimit ?? null, saleDelta);
      }
      await this.ledger.post(tx, {
        date: order.date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.ORDER_SALE,
        amount: saleDelta,
        clientId: order.clientId,
        orderId,
        note: 'Haqiqiy miqdor — sotuv tuzatildi',
        createdById: userId,
      });
    }

    // FACTORY cost delta at the PROVISIONAL price (applyActualLoading is gated to
    // costStatus=PROVISIONAL, so finalCostPricePerM3 is null here). Posted as ORDER_COST
    // — NOT COST_ADJUSTMENT — so a later finalize/un-finalize (which reverses only the
    // finalization COST_ADJUSTMENT rows and restores costTotal to the provisional total
    // at EFFECTIVE qty) stays exactly consistent with this qty-adjusted provisional cost.
    const costDelta = round2(newCostTotal.minus(round2(D(order.costTotal))));
    if (!costDelta.isZero()) {
      await this.ledger.post(tx, {
        date: order.date,
        account: LedgerAccount.FACTORY,
        source: LedgerSource.ORDER_COST,
        amount: costDelta.negated(),
        factoryId: order.factoryId,
        orderId,
        note: 'Haqiqiy miqdor — tannarx tuzatildi',
        createdById: userId,
      });
    }

    for (const u of itemUpdates) {
      await tx.orderItem.update({ where: { id: u.id }, data: { saleTotal: u.saleTotal, costTotal: u.costTotal } });
    }
    await tx.order.update({ where: { id: orderId }, data: { saleTotal: newSaleTotal, costTotal: newCostTotal } });
  }

  // ─────────────────────────────── internals ───────────────────────────────

  /**
   * Server-authoritative item pricing. Sale side: pricePending → 0;
   * lump sum → back-solved 6dp price, EXACT total; explicit price → AGENT floor
   * at the factory bank price; otherwise the price book (ClientPrice wins).
   * Cost side: provisional factory price + pallets.
   */
  private async buildOrderItems(
    tx: Prisma.TransactionClient,
    itemsDto: OrderItemDto[],
    opts: { clientId: string; date: Date; provisionalPriceKind: PriceKind; role: string },
  ): Promise<BuiltItems> {
    const productIds = [...new Set(itemsDto.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map<string, (typeof products)[number]>(products.map((p) => [p.id, p]));

    for (const it of itemsDto) {
      if (!productById.has(it.productId)) {
        throw new BadRequestException(`Mahsulot topilmadi: ${it.productId}`);
      }
    }
    const factoryIds = new Set(products.map((p) => p.factoryId));
    if (factoryIds.size !== 1) {
      throw new BadRequestException(
        "Bitta buyurtmadagi barcha mahsulotlar bitta zavodga tegishli bo'lishi kerak",
      );
    }
    const factoryId = products[0].factoryId;

    const palletPriceDefault = D(
      (await this.settings.get<number | string | null>('palletPriceDefault')) ?? 130_000,
    );

    const itemsData: BuiltItem[] = [];
    for (const it of itemsDto) {
      const product = productById.get(it.productId)!;
      const palletCount = it.palletCount ?? 0;

      // dto.quantityM3 wins over palletCount × m3PerPallet when both are given
      const quantityM3 = this.hasValue(it.quantityM3)
        ? this.toPositiveVolume(it.quantityM3!, 'quantityM3')
        : round3(D(product.m3PerPallet).mul(palletCount));
      if (quantityM3.lte(0)) {
        throw new BadRequestException("Hajm (m³) yoki pallet soni kiritilishi shart");
      }

      const palletPrice = this.hasValue(it.palletPrice)
        ? this.toNonNegativeMoney(it.palletPrice, 'palletPrice')
        : round2(palletPriceDefault);

      const pricePending = !!it.pricePending;
      let salePricePerM3 = ZERO;
      let saleTotal = ZERO;
      let saleLumpSum: Prisma.Decimal | null = null;
      let listPricePerM3: Prisma.Decimal | null = null;

      if (!pricePending) {
        if (this.hasValue(it.saleLumpSum)) {
          const lump = this.toPositiveMoney(it.saleLumpSum!, 'saleLumpSum');
          salePricePerM3 = lump.div(quantityM3).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
          saleTotal = lump; // negotiated lump sum is stored EXACTLY
          saleLumpSum = lump; // flag: fixed total, does NOT scale with actual qty
          listPricePerM3 = await this.trySalePrice(tx, it.productId, opts.clientId, opts.date);
          await this.assertAgentPriceFloor(tx, opts.role, it.productId, salePricePerM3, opts.date);
        } else if (this.hasValue(it.salePricePerM3)) {
          // Explicit (negotiated) price — the book is REFERENCE ONLY here, so a product
          // with no DEALER_SALE row must NOT block the order. Resolving it eagerly is what
          // made every fully-filled row fail with "…DEALER_SALE narxi belgilanmagan".
          salePricePerM3 = this.toPositivePrice(it.salePricePerM3!, 'salePricePerM3');
          listPricePerM3 = await this.trySalePrice(tx, it.productId, opts.clientId, opts.date);
          await this.assertAgentPriceFloor(tx, opts.role, it.productId, salePricePerM3, opts.date);
          saleTotal = round2(quantityM3.mul(salePricePerM3));
        } else {
          // Catalog price — the book IS the price, so a missing row is a real error.
          listPricePerM3 = await this.pricing.resolveSalePrice(tx, it.productId, opts.clientId, opts.date);
          salePricePerM3 = listPricePerM3;
          saleTotal = round2(quantityM3.mul(salePricePerM3));
        }
      }

      // PROVISIONAL cost — never blocks the sale. The factory book may legitimately be
      // empty (freshly imported catalog); the real cost is fixed later by
      // recomputeOrderCost at factory-payment time, which is why costStatus stays
      // PROVISIONAL. Falling back keeps the order writable; refusing it would make the
      // COST book a hidden gate on SELLING.
      const costPricePerM3 =
        (await this.pricing.tryBookPrice(tx, it.productId, opts.provisionalPriceKind, opts.date)) ??
        (await this.pricing.tryBookPrice(tx, it.productId, otherFactoryKind(opts.provisionalPriceKind), opts.date)) ??
        ZERO;
      const costTotal = round2(quantityM3.mul(costPricePerM3).plus(palletPrice.mul(palletCount)));

      itemsData.push({
        productId: it.productId,
        quantityM3,
        palletCount,
        palletPrice,
        listPricePerM3,
        salePricePerM3,
        saleTotal,
        saleLumpSum,
        pricePending,
        provisionalPriceKind: opts.provisionalPriceKind,
        costPricePerM3,
        costTotal,
      });
    }

    return {
      itemsData,
      factoryId,
      saleTotal: round2(sum(itemsData.map((i) => i.saleTotal))),
      costTotal: round2(sum(itemsData.map((i) => i.costTotal))),
      totalPallets: itemsData.reduce((a, i) => a + i.palletCount, 0),
    };
  }

  /** Postings for a (re)created order — one call site for create and update-repost. */
  /**
   * CLIENT side — posted at ORDER CREATE (mijozga qarz darhol yoziladi): the sale debt
   * and, when the dealer charges transport, the transport charge.
   */
  private async postOrderClientLedger(
    tx: Prisma.TransactionClient,
    p: {
      orderId: string;
      date: Date;
      clientId: string;
      saleTotal: Prisma.Decimal;
      transportMode: TransportMode;
      transportCharge: Prisma.Decimal;
      createdById: string;
    },
  ) {
    if (p.saleTotal.gt(0)) {
      await this.ledger.post(tx, {
        date: p.date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.ORDER_SALE,
        amount: p.saleTotal,
        clientId: p.clientId,
        orderId: p.orderId,
        createdById: p.createdById,
      });
    }
    if (p.transportMode === TransportMode.DEALER_CHARGED && p.transportCharge.gt(0)) {
      await this.ledger.post(tx, {
        date: p.date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.TRANSPORT_CHARGE,
        amount: p.transportCharge,
        clientId: p.clientId,
        orderId: p.orderId,
        createdById: p.createdById,
      });
    }
  }

  /**
   * SUPPLY side — posted when the TRUCK LEAVES THE FACTORY (LOADING transition), NOT at
   * create: the dealer→factory cost debt and the dealer→driver transport cost. This is
   * the moment those liabilities become real (goods shipped / driver engaged).
   */
  private async postOrderSupplyLedger(
    tx: Prisma.TransactionClient,
    p: {
      orderId: string;
      date: Date;
      factoryId: string;
      vehicleId: string | null;
      costTotal: Prisma.Decimal;
      transportMode: TransportMode;
      transportCost: Prisma.Decimal;
      createdById: string;
    },
  ) {
    if (p.costTotal.gt(0)) {
      await this.ledger.post(tx, {
        date: p.date,
        account: LedgerAccount.FACTORY,
        source: LedgerSource.ORDER_COST,
        amount: p.costTotal.negated(),
        factoryId: p.factoryId,
        orderId: p.orderId,
        createdById: p.createdById,
      });
    }
    if (p.transportMode !== TransportMode.CLIENT_OWN && p.transportCost.gt(0) && p.vehicleId) {
      await this.ledger.post(tx, {
        date: p.date,
        account: LedgerAccount.VEHICLE,
        source: LedgerSource.TRANSPORT_COST,
        amount: p.transportCost.negated(),
        vehicleId: p.vehicleId,
        orderId: p.orderId,
        createdById: p.createdById,
      });
    }
  }

  /**
   * Re-run FIFO settlement for every client payment that still has unspent money on it.
   * Called after a new order is booked so a standing advance attaches to it automatically.
   * Cheap in practice: only payments with a free remainder are considered, and a client
   * in credit normally has one or two of them.
   */
  private async applyClientAdvance(tx: Prisma.TransactionClient, clientId: string, userId: string) {
    const free = await clientUnallocatedPayments(tx, clientId);
    for (const p of free) {
      await autoAllocateClientPayment(
        tx,
        { id: p.id, clientId, amount: p.amount, kind: PaymentKind.CLIENT_IN },
        userId,
        { alreadyPlaced: p.allocated },
      );
    }
  }

  private async assertClientCreditLimit(
    tx: Prisma.TransactionClient,
    clientId: string,
    creditLimit: Prisma.Decimal | null,
    newExposure: Prisma.Decimal,
  ) {
    if (creditLimit === null) return; // null ⇒ unlimited
    const balance = await this.ledger.clientBalance(clientId, tx);
    if (balance.plus(newExposure).gt(D(creditLimit))) {
      throw new BadRequestException(
        `Kredit limiti oshib ketdi: limit ${D(creditLimit).toFixed(2)}, joriy qarz ${balance.toFixed(2)}, yangi buyurtma ${newExposure.toFixed(2)}`,
      );
    }
  }

  private async assertCapacity(totalPallets: number, vehicle: Vehicle | null) {
    const capacity = vehicle
      ? vehicle.capacityPallets
      : ((await this.settings.get<number | null>(SETTING_KEYS.truckCapacityPallets)) ?? 19);
    if (totalPallets > capacity) {
      throw new BadRequestException(`Moshina sig'imi oshib ketdi: ${totalPallets} > ${capacity} pallet`);
    }
  }

  /** AGENT may not sell below the factory bank price of the product at the order date. */
  private async assertAgentPriceFloor(
    tx: Prisma.TransactionClient,
    role: string,
    productId: string,
    salePricePerM3: Prisma.Decimal,
    date: Date,
  ) {
    if (role !== 'AGENT') return;
    // No factory book row ⇒ no floor to enforce. Throwing here would turn a missing COST
    // price into a hard block on an agent's SALE, which is the same trap as above.
    const floor = await this.pricing.tryBookPrice(tx, productId, PriceKind.FACTORY_BANK, date);
    if (floor && salePricePerM3.lt(floor)) {
      throw new BadRequestException(
        `Zavod narxidan (${floor.toFixed(2)}) past narxda sotish faqat ADMIN/ACCOUNTANT uchun`,
      );
    }
  }

  private hasValue(v: number | string | undefined | null): boolean {
    return v !== undefined && v !== null && v !== '';
  }

  private toPositiveMoney(v: number | string, field: string): Prisma.Decimal {
    try {
      return assertPositiveMoney(v, field);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** per-m³ prices keep 6dp — do NOT round them to the money grid */
  private toPositivePrice(v: number | string, field: string): Prisma.Decimal {
    const d = D(v);
    if (!d.isFinite() || d.lte(0)) {
      throw new BadRequestException(`${field} musbat son bo'lishi kerak`);
    }
    return d.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
  }

  private toPositiveVolume(v: number | string, field: string): Prisma.Decimal {
    const d = D(v);
    if (!d.isFinite() || d.lte(0)) {
      throw new BadRequestException(`${field} musbat son bo'lishi kerak`);
    }
    return round3(d);
  }

  private toNonNegativeMoney(v: number | string | undefined | null, field: string): Prisma.Decimal {
    if (v === undefined || v === null || v === '') return ZERO;
    const d = D(v);
    if (!d.isFinite() || d.lt(0)) {
      throw new BadRequestException(`${field} manfiy bo'lishi mumkin emas`);
    }
    return round2(d);
  }

  private async trySalePrice(
    tx: Prisma.TransactionClient,
    productId: string,
    clientId: string,
    date: Date,
  ): Promise<Prisma.Decimal | null> {
    try {
      return await this.pricing.resolveSalePrice(tx, productId, clientId, date);
    } catch {
      return null; // lump-sum deals may have no book price — list is reference-only there
    }
  }
}
