import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CostStatus,
  FactoryBucket,
  FactoryPayIntent,
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
import { assertPositiveMoney, D, ONE_SOM, round2, round3, sum, ZERO } from '../common/money';
import { factoryCoverage } from '../common/factory-coverage';
import { PaymentsService } from '../payments/payments.service';
import { pageArgs, paged } from '../common/pagination';
import { cleanPlate, cleanText, findFleetVehicleByPlate } from '../common/plate';
import { agentScope, assertOwnAgent, RequestUser } from '../common/scoping';
import { clientChargeable, clientDirectTransport, recomputeTransportStatus } from '../common/transport';
import { PalletService } from '../pallets/pallets.service';
import { BonusService } from '../bonus/bonus.service';
import {
  AddCommentDto,
  AdminOrderPatchDto,
  CancelMoneyMode,
  CancelOrderDto,
  CreateOrderDto,
  DrawFactoryAdvanceDto,
  OrderItemDto,
  OrderListQueryDto,
  SetFactoryPayIntentDto,
  UpdateOrderDto,
} from './dto';

/**
 * Legacy lifecycle order. Nothing TRANSITIONS along it any more (orders are born
 * COMPLETED, 2026-07-22) — it survives only so `applyActualLoading` can keep gating
 * legacy rows that were left mid-flow by the pre-2026-07-22 board.
 */
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
 * Reads the factory-payment intent off a DTO, tolerating the retired two-way
 * `intendedPaymentMethod` field so older clients keep working. Returns undefined when
 * the caller said nothing at all — an EDIT must then keep what the order already has,
 * rather than silently resetting it to UNKNOWN and repricing the purchase.
 */
const intentOfOptional = (dto: {
  factoryPayIntent?: FactoryPayIntent;
  intendedPaymentMethod?: 'CASH' | 'BANK';
}): FactoryPayIntent | undefined =>
  dto.factoryPayIntent ??
  (dto.intendedPaymentMethod === 'CASH'
    ? FactoryPayIntent.CASH
    : dto.intendedPaymentMethod === 'BANK'
      ? FactoryPayIntent.BANK
      : undefined);

/** Same, for CREATE: saying nothing means «to'lov usuli aniq emas». */
const intentOf = (dto: {
  factoryPayIntent?: FactoryPayIntent;
  intendedPaymentMethod?: 'CASH' | 'BANK';
}): FactoryPayIntent => intentOfOptional(dto) ?? FactoryPayIntent.UNKNOWN;

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
    private payments: PaymentsService,
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

      // The owner's three buttons. UNKNOWN («to'lov usuli aniq emas») is the honest
      // default: both candidate costs are shown and the order may settle as a mix.
      // Its PROVISIONAL posting still needs one number, and that is the BANK (dearer)
      // price — understating a debt is the one error that must never happen. If it is
      // later settled in naqd the COST_ADJUSTMENT delta gives the difference back.
      const factoryPayIntent = intentOf(dto);
      const provisionalPriceKind =
        factoryPayIntent === FactoryPayIntent.CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;

      let vehicle: Vehicle | null = null;
      // Ad-hoc truck ma'lumoti SHU REYS uchun — moshina paydo bo'lgan usulidan qat'i nazar
      // saqlanishi kerak (mavjud parkdagi moshina qayta ishlatilsa ham yo'qolmaydi).
      let adhocDriver: string | null = null;
      if (dto.vehicleId) {
        vehicle = await tx.vehicle.findUnique({ where: { id: dto.vehicleId } });
        if (!vehicle) throw new BadRequestException('Moshina topilmadi');
        if (vehicle.oneTime) throw new BadRequestException('Bir martalik moshina qayta ishlatilmaydi');
      } else if (dto.oneTimeVehicle) {
        // ad-hoc truck: minted hidden (oneTime=true) so its transport ledger has a real
        // VEHICLE FK, but it never joins the fleet or the picker. plate stays optional —
        // the partial-unique index only constrains oneTime=false rows.
        const otv = dto.oneTimeVehicle;
        const plate = cleanPlate(otv.plate);
        const otvPhone = cleanText(otv.phone);
        adhocDriver = cleanText(otv.driver);
        // …unless the plate is ALREADY a real fleet truck. Minting a hidden twin would
        // divert its transport ledger to a row no list, picker or debt board ever shows.
        // An archived fleet row still counts — same physical truck, and splitting its
        // ledger is worse than referencing a nofaol vehicle.
        if (plate) {
          const fleet = await findFleetVehicleByPlate(tx, plate);
          if (fleet) {
            vehicle = await tx.vehicle.findUnique({ where: { id: fleet.id } });
            // faqat BO'SH maydonlarni to'ldiramiz — parkdagi moshinaning shofyori/telefoni
            // hech qachon bir martalik kiritma bilan ustidan yozilmaydi
            if (vehicle && ((!vehicle.driver && adhocDriver) || (!vehicle.phone && otvPhone))) {
              vehicle = await tx.vehicle.update({
                where: { id: vehicle.id },
                data: {
                  ...(!vehicle.driver && adhocDriver ? { driver: adhocDriver } : {}),
                  ...(!vehicle.phone && otvPhone ? { phone: otvPhone } : {}),
                },
              });
            }
          }
        }
        if (!vehicle) {
          vehicle = await tx.vehicle.create({
            data: { name: otv.name.trim(), plate, driver: adhocDriver, phone: otvPhone, oneTime: true },
          });
        }
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
      // What this order adds to the client's book. Under CLIENT_PAYS_DRIVER the driver's
      // slice never becomes a dealer receivable, so the limit gates must weigh the NET
      // exposure — gating on the gross would refuse orders the client can in fact take.
      const clientExposure = clientChargeable({
        transportMode,
        transportCost,
        saleTotal: built.saleTotal,
      });

      // ── limits — row locks serialize concurrent checks on the same client/agent ──
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${client.id} FOR UPDATE`;
      if (agentId) {
        await tx.$executeRaw`SELECT id FROM "Agent" WHERE id = ${agentId} FOR UPDATE`;
      }

      await this.assertClientCreditLimit(tx, client.id, client.creditLimit, clientExposure);

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
          const projected = outstanding.plus(clientExposure);
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
          // Owner rule (2026-07-22): no lifecycle stepping — an order is FINAL the instant it
          // is created. Born COMPLETED so its factory cost, driver transport-cost and bonus are
          // all posted at create (below), exactly as a finished order used to be at COMPLETED.
          // completedAt is the WALL-CLOCK finalization time (not the business `date`), matching
          // the old COMPLETED transition — the versioned bonus program in force at THIS moment
          // governs the accrual (a back-dated order still earns today's program, not a stale one).
          status: OrderStatus.COMPLETED,
          completedAt: new Date(),
          agentId,
          clientId: client.id,
          factoryId: built.factoryId,
          vehicleId: vehicle?.id ?? null,
          // adhocDriver reysga kiritilgan shofyor — parkdagi moshina qayta ishlatilganda
          // ham yo'qolmasligi uchun moshinaning o'z shofyoridan OLDIN turadi
          driverName: dto.driverName ?? adhocDriver ?? vehicle?.driver ?? null,
          saleTotal: built.saleTotal,
          costTotal: built.costTotal,
          costStatus: CostStatus.PROVISIONAL,
          factoryPayIntent,
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
        data: { orderId: order.id, from: null, to: OrderStatus.COMPLETED, byId: user.userId },
      });

      // Owner rule (2026-07-22): an order is FINAL at create — no NEW→…→LOADING→COMPLETED
      // stepping. So EVERYTHING an order used to post across its lifecycle is posted here:
      //   • CLIENT sale debt (was always at create);
      //   • FACTORY cost debt + driver TRANSPORT_COST (used to post at the LOADING transition);
      //   • bonus accrual (used to accrue at COMPLETED).
      await this.postOrderClientLedger(tx, {
        orderId: order.id,
        date,
        clientId: client.id,
        saleTotal: built.saleTotal,
        transportMode,
        transportCost,
        transportCharge,
        createdById: user.userId,
      });

      await this.postOrderSupplyLedger(tx, {
        orderId: order.id,
        date,
        factoryId: built.factoryId,
        vehicleId: vehicle?.id ?? null,
        costTotal: built.costTotal,
        transportMode,
        transportCost,
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

      // Bonus accrues now the order is COMPLETED at birth (was the COMPLETED transition).
      // Idempotent: accrueForOrder no-ops if an un-reversed ACCRUAL already exists.
      await this.bonus.accrueForOrder(tx, order.id, user.userId);

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
    // Payment-tab filter (paid / unpaid). `clientOutstanding` is a COMPUTED figure (sale minus
    // the driver's direct slice minus client settlements), so it can't be a plain SQL where.
    // Resolve the matching order id-set over the current scope once, then let normal pagination
    // run on it. Cancelled orders carry no outstanding, so they are excluded from both tabs.
    if (q.paid) {
      // The exclusion is INTERSECTED (AND), never assigned onto `where.status`: spreading it
      // would silently drop an explicit `?status=` the caller also sent, answering a different
      // question than the one asked. With no `?status=` the two forms are identical.
      const notCancelled: Prisma.OrderWhereInput = { status: { not: OrderStatus.CANCELLED } };
      const scopeWhere: Prisma.OrderWhereInput = { AND: [where, notCancelled] };
      const scoped = await this.prisma.order.findMany({
        where: scopeWhere,
        select: { id: true, saleTotal: true, transportMode: true, transportCost: true },
      });
      const scopedIds = scoped.map((o) => o.id);
      const settledScoped = scopedIds.length
        ? await this.prisma.paymentAllocation.groupBy({
            by: ['orderId'],
            where: {
              orderId: { in: scopedIds },
              voidedAt: null,
              payment: { voidedAt: null, kind: { in: CLIENT_SETTLING_KINDS } },
            },
            _sum: { amount: true },
          })
        : [];
      const paidScoped = new Map(settledScoped.map((s) => [s.orderId, D(s._sum.amount ?? 0)]));
      const wantPaid = q.paid === 'paid';
      const matchIds = scoped
        .filter((o) => {
          const paid = paidScoped.get(o.id) ?? ZERO;
          const left = round2(clientChargeable(o).minus(paid));
          const fullyPaid = left.lessThanOrEqualTo(ONE_SOM); // ≤1 so'm left ⇒ settled
          return wantPaid ? fullyPaid : !fullyPaid;
        })
        .map((o) => o.id);
      where.id = { in: matchIds };
      // same intersection on the paged query (nothing else writes `where.AND` or `where.id`)
      where.AND = [...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []), notCancelled];
    }

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
      // the driver's direct slice is not a dealer receivable — subtract it here too, or
      // this column would disagree with the order card and the client's statement
      const left =
        o.status === OrderStatus.CANCELLED ? ZERO : round2(clientChargeable(o).minus(paid));
      return {
        ...o,
        clientPaid: round2(paid).toFixed(2),
        clientOutstanding: (left.lessThan(0) ? ZERO : left).toFixed(2),
      };
    });
    return paged(rows, total, page, pageSize);
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

    // Dealer→factory cost BOTH ways with EXACT sums (naqd / bank) plus how much of the
    // order each channel has already bought — the single source the order screen reads
    // for «naqd bilan to'lasangiz X, o'tkazma bilan Y». Blocks only: pallets are in-kind.
    const cov = await factoryCoverage(this.prisma as unknown as Prisma.TransactionClient, this.pricing, id);

    // Per-order settlement, the two figures the owner reads off this screen in red:
    // what the CLIENT still owes on this order, and what WE still owe the factory for it.
    const settlement = await this.orderSettlement(this.prisma, order);

    // What is available to draw from, so the button can say «bor: 30 mln (10 naqd + 20 bank)»
    const buckets = await this.ledger.factoryBuckets(order.factoryId);

    // AGENTs must never see factory cost prices or company-wide balances (owner-locked,
    // docs/design/06-decisions.md D1). Skipping the extra cost fields is not enough — the
    // spread `order` ITSELF carries the factory cost on every item (costPricePerM3,
    // finalCostPricePerM3, item costTotal, provisionalPriceKind), on the order (costTotal),
    // on its FACTORY ledger rows and on its FACTORY_OUT allocations. There is no
    // serializer @Exclude in this app, so those go over the wire raw unless stripped here.
    if (user.role === 'AGENT') {
      return this.stripFactoryCostForAgent(order, settlement);
    }

    return {
      ...order,
      costTotalCash: cov.totals[PriceKind.FACTORY_CASH].toFixed(2),
      costTotalBank: cov.totals[PriceKind.FACTORY_BANK].toFixed(2),
      factoryCoverage: {
        /** 0…1 — how much of the goods has been bought so far */
        fraction: cov.fraction.toFixed(6),
        settled: cov.settled,
        paidCash: round2(cov.paidCash).toFixed(2),
        paidBank: round2(cov.paidBank).toFixed(2),
        /** still to pay, expressed in each channel's own money */
        remainingCash: cov.remaining[PriceKind.FACTORY_CASH].toFixed(2),
        remainingBank: cov.remaining[PriceKind.FACTORY_BANK].toFixed(2),
        mix: cov.describeMix(),
      },
      factoryAdvance: {
        cash: round2(buckets.advanceCash).toFixed(2),
        bank: round2(buckets.advanceBank).toFixed(2),
        total: round2(buckets.advanceTotal).toFixed(2),
      },
      ...settlement,
    };
  }

  /**
   * «AVANSDAN YECHISH» — settle part of this order out of money already standing at the
   * factory, in the channel the user picks. That choice is what fixes the price basis
   * for the slice it buys: naqd advance buys at the factory's naqd price, o'tkazma
   * advance at its bank price.
   *
   * Guard rails the owner asked for: never more than the order still needs, may be less,
   * and may simply not happen at all (nothing is drawn automatically, ever).
   */
  async drawFactoryAdvance(id: string, dto: DrawFactoryAdvanceDto, user: RequestUser) {
    // `await`, not `return`: the refreshed card is read AFTER the commit (findOne runs on
    // a different connection and would otherwise return pre-commit state). Returning the
    // transaction directly would make that post-commit read unreachable dead code and the
    // endpoint would answer `undefined`.
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException("Bekor qilingan buyurtmaga avansdan yechilmaydi");
      }
      if (!COST_POSTED_STATUSES.includes(order.status)) {
        throw new BadRequestException(
          `Buyurtma ${order.orderNo} hali zavoddan chiqmagan — zavod qarzi yuklashda yoziladi. ` +
            'Avval yuklashni boshlang, keyin avansdan yeching.',
        );
      }

      const bucket = dto.bucket as FactoryBucket;
      const priceKind =
        bucket === FactoryBucket.ADVANCE_CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;

      // serialize two draws racing for the same advance
      await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${order.factoryId} FOR UPDATE`;
      const buckets = await this.ledger.factoryBuckets(order.factoryId, tx);
      const available = round2(
        bucket === FactoryBucket.ADVANCE_CASH ? buckets.advanceCash : buckets.advanceBank,
      );
      const channel = bucket === FactoryBucket.ADVANCE_CASH ? 'naqd' : "o'tkazma";
      if (available.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`Zavodda ${channel} avansingiz yo'q`);
      }

      const cov = await factoryCoverage(tx, this.pricing, id);
      const need = cov.remaining[priceKind];
      if (need.lessThan(ONE_SOM)) {
        throw new BadRequestException(`Buyurtma ${order.orderNo} zavod tomonidan to'liq yopilgan`);
      }

      // omitted amount ⇒ take as much as both sides allow
      const ceiling = Prisma.Decimal.min(available, need);
      const amount = dto.amount === undefined ? ceiling : this.toPositiveMoney(dto.amount, 'amount');
      if (amount.greaterThan(available)) {
        throw new BadRequestException(
          `Zavoddagi ${channel} avansingiz ${available.toFixed(2)} so'm — bundan ko'p yechib bo'lmaydi`,
        );
      }
      if (amount.minus(need).greaterThan(ONE_SOM)) {
        throw new BadRequestException(
          `Bu buyurtma uchun ${channel} narxida ko'pi bilan ${need.toFixed(2)} so'm yechiladi ` +
            `(so'ralgan ${amount.toFixed(2)})`,
        );
      }

      // Spend the OLDEST money in that channel first, so the advance ages sensibly.
      const drawn = await this.payments.drawFromAdvance(tx, {
        factoryId: order.factoryId,
        orderId: id,
        bucket,
        amount,
        date: dto.date ? new Date(dto.date) : new Date(),
        note: dto.note ?? null,
        userId: user.userId,
      });

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'Order',
        entityId: id,
        after: { drawnFrom: bucket, amount: amount.toFixed(2), payments: drawn.length },
        note: `Avansdan yechildi (${channel})`,
      });
      // NOTE: the refreshed card is read AFTER the commit (below). findOne runs on
      // this.prisma, a different connection, so reading it here would return the
      // pre-transaction state and the screen would look like nothing happened.
    }, TX_OPTS);

    return this.findOne(id, user);
  }

  /**
   * Re-picks «zavodga to'lov turi» on an existing order. Nothing about this is
   * destructive: the provisional block price is re-resolved at the new basis and the
   * difference posts as one COST_ADJUSTMENT delta, exactly like a settlement does.
   * Slices already bought keep the price they were bought at — money that has changed
   * hands is never retro-priced.
   */
  async setFactoryPayIntent(id: string, dto: SetFactoryPayIntentDto, user: RequestUser) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException("Bekor qilingan buyurtma tahrirlanmaydi");
      }
      if (order.factoryPayIntent === dto.factoryPayIntent) return;

      const kind =
        dto.factoryPayIntent === FactoryPayIntent.CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;

      for (const item of order.items) {
        const price =
          (await this.pricing.tryBookPrice(tx, item.productId, kind, order.date)) ??
          (await this.pricing.tryBookPrice(tx, item.productId, otherFactoryKind(kind), order.date)) ??
          D(item.costPricePerM3);
        await tx.orderItem.update({
          where: { id: item.id },
          data: { provisionalPriceKind: kind, costPricePerM3: price },
        });
      }

      await tx.order.update({ where: { id }, data: { factoryPayIntent: dto.factoryPayIntent } });
      // posts the provisional delta and re-blends whatever is already settled
      await this.payments.recomputeOrderCost(tx, id, user.userId);

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.UPDATE,
        entity: 'Order',
        entityId: id,
        before: { factoryPayIntent: order.factoryPayIntent },
        after: { factoryPayIntent: dto.factoryPayIntent },
        note: "Zavodga to'lov turi o'zgartirildi",
      });
      // refreshed card is read after the commit — see drawFactoryAdvance
    }, TX_OPTS);

    return this.findOne(id, user);
  }

  /**
   * Redacts every factory-cost-derived figure from an order before it reaches an AGENT.
   * The agent still gets everything client-facing (sale prices, quantities, their client's
   * ledger, transport as the client sees it) — only the dealer's purchase economics vanish.
   */
  private stripFactoryCostForAgent(
    order: Prisma.OrderGetPayload<{
      include: {
        items: { include: { product: true } };
        ledgerEntries: true;
        allocations: { include: { payment: true } };
      };
    }> & Record<string, unknown>,
    settlement: Record<string, unknown>,
  ) {
    const { costTotal: _costTotal, costStatus: _costStatus, ...rest } = order;
    return {
      ...rest,
      items: order.items.map((it) => {
        // drop the four factory-cost fields; keep sale side + product + pallet COUNTS
        const {
          costPricePerM3: _c,
          finalCostPricePerM3: _f,
          costTotal: _ct,
          provisionalPriceKind: _pk,
          palletPrice: _pp,
          ...safeItem
        } = it;
        return safeItem;
      }),
      // the agent may see their own client's money, never the factory/vehicle ledger
      ledgerEntries: order.ledgerEntries.filter((e) => e.account === LedgerAccount.CLIENT),
      // FACTORY_OUT allocations carry the factory payment + priceKind — hide them entirely
      allocations: order.allocations.filter((a) => a.payment?.kind !== PaymentKind.FACTORY_OUT),
      // settlement carries factoryPaid / factoryOutstanding (= costTotal − Σ paid), which
      // is the factory cost by subtraction — expose only the CLIENT half to the agent.
      clientPaid: settlement.clientPaid,
      clientOutstanding: settlement.clientOutstanding,
    };
  }

  /**
   * CLIENT side: clientChargeable (saleTotal minus the slice the client hands the driver
   * himself) − Σ active CLIENT_IN allocations.
   * FACTORY side: costTotal − Σ active FACTORY_OUT allocations, and only once the cost
   * has actually been posted to the ledger — before LOADING we owe the factory nothing
   * for this order, so showing a red debt then would be a lie.
   */
  private async orderSettlement(
    db: Prisma.TransactionClient | PrismaService,
    order: {
      id: string;
      saleTotal: Prisma.Decimal;
      costTotal: Prisma.Decimal;
      status: OrderStatus;
      transportMode: TransportMode;
      transportCost: Prisma.Decimal;
    },
  ) {
    const tx = db as Prisma.TransactionClient;
    const clientOutstanding =
      order.status === OrderStatus.CANCELLED ? ZERO : await orderClientOutstanding(tx, order);
    // "paid" is what the client actually handed the DEALER — measured against the
    // chargeable total, not the gross, so a CLIENT_PAYS_DRIVER order does not read as
    // part-paid before a single so'm has arrived.
    const clientPaid = round2(clientChargeable(order).minus(clientOutstanding));

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
      // Owner rule (2026-07-22): orders are COMPLETED-at-birth, so the old «NEW/CONFIRMED
      // only» gate would block every edit. An order stays editable while it is not cancelled
      // and its factory cost has NOT been locked by a payment (still PROVISIONAL) — once the
      // factory is (partly) paid, that payment must be voided before the order can be edited.
      if (existing.status === OrderStatus.CANCELLED) {
        throw new BadRequestException("Bekor qilingan buyurtmani tahrirlab bo'lmaydi");
      }
      if (existing.costStatus !== CostStatus.PROVISIONAL) {
        throw new BadRequestException("Narx zavod to'lovi bilan qotirilgan — avval o'sha to'lovni bekor qiling");
      }

      const date = dto.date ? new Date(dto.date) : existing.date;
      // The factory-payment intent IS editable now (owner: every operation must be
      // correctable). Omitting it keeps whatever the order already carries, so an edit
      // that does not mention it cannot silently reprice the purchase.
      const factoryPayIntent =
        dto.factoryPayIntent ?? intentOfOptional(dto) ?? existing.factoryPayIntent;
      const provisionalPriceKind =
        factoryPayIntent === FactoryPayIntent.CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;

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

      // Rejimni almashtirish TO'LANGAN transportni yolg'iz qoldirib ketmasligi kerak.
      // Ikkala yo'nalish ham buzuq:
      //  · CLIENT_PAYS_DRIVER'dan CHIQISH — mijoz shofyorga bergan TRANSPORT_DIRECT
      //    to'lovi faol qoladi, recomputeTransportStatus esa yana PAID_BY_CLIENT deb
      //    o'qiydi: shofyor «to'langan» ko'rinadi, holbuki endi unga DILLER qarzdor.
      //  · CLIENT_PAYS_DRIVER'ga KIRISH — VEHICLE_OUT bilan to'langan shofyor qoladi-yu,
      //    yangi rejimda VEHICLE qarzi umuman yozilmaydi (postOrderSupplyLedger uni
      //    o'tkazib yuboradi) → moshina hisobida yo'qdan paydo bo'lgan avans.
      // Har ikkalasida ham yechim bitta: avval o'sha to'lovni bekor qilish.
      if (transportMode !== existing.transportMode) {
        const strandedKind =
          existing.transportMode === TransportMode.CLIENT_PAYS_DRIVER
            ? PaymentKind.TRANSPORT_DIRECT
            : transportMode === TransportMode.CLIENT_PAYS_DRIVER
              ? PaymentKind.VEHICLE_OUT
              : null;
        if (strandedKind) {
          const live = await tx.paymentAllocation.count({
            where: {
              orderId: id,
              voidedAt: null,
              payment: { kind: strandedKind, voidedAt: null },
            },
          });
          if (live > 0) {
            throw new BadRequestException(
              strandedKind === PaymentKind.TRANSPORT_DIRECT
                ? "Shofyorga to'g'ridan-to'g'ri to'lov yozilgan — transport rejimini o'zgartirishdan oldin o'sha to'lovni bekor qiling"
                : "Shofyorga diller to'lovi yozilgan — transport rejimini o'zgartirishdan oldin o'sha to'lovni bekor qiling",
            );
          }
        }
      }

      // final-at-create (2026-07-22): editing now reverses+reposts the SUPPLY side too, so a
      // vehicle SWAP with a live driver payment would strand that payment on the OLD vehicle
      // (a phantom advance) while the cost reposts on the new one. Same rule as a mode change.
      const vehicleChanged = (vehicleId ?? null) !== (existing.vehicleId ?? null);
      if (vehicleChanged) {
        const liveTransport = await tx.paymentAllocation.count({
          where: {
            orderId: id,
            voidedAt: null,
            payment: {
              kind: { in: [PaymentKind.VEHICLE_OUT, PaymentKind.TRANSPORT_DIRECT] },
              voidedAt: null,
            },
          },
        });
        if (liveTransport > 0) {
          throw new BadRequestException(
            "Transport to'lovi qilingan — moshinani almashtirishdan oldin o'sha shofyor to'lovini bekor qiling",
          );
        }
      }

      const transportCost =
        transportMode === TransportMode.CLIENT_OWN
          ? ZERO
          : dto.transportCost === undefined
            ? round2(existing.transportCost)
            : this.toNonNegativeMoney(dto.transportCost, 'transportCost');
      const transportCharge = ZERO; // transport is INSIDE the goods total (see create)
      const clientExposure = clientChargeable({ transportMode, transportCost, saleTotal: built.saleTotal });

      const dueDate = existing.client.paymentTermDays
        ? new Date(date.getTime() + existing.client.paymentTermDays * 86_400_000)
        : null;

      // serialize with concurrent creates on the same client, then reverse + recheck + repost
      await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${existing.clientId} FOR UPDATE`;

      await this.ledger.reverseAllForOrder(tx, id, 'Buyurtma tahrirlandi', user.userId);
      await this.pallets.reverseForOrder(tx, id, user.userId);
      // supply side (factory cost + transport) and bonus are posted at CREATE now, so an edit
      // must reverse them too before reposting the fresh figures below (both idempotent).
      await this.bonus.reverseForOrder(tx, id, user.userId);

      // credit limit against the delta: old exposure is reversed out of the balance above
      await this.assertClientCreditLimit(tx, existing.clientId, existing.client.creditLimit, clientExposure);

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
          factoryPayIntent,
          transportMode,
          transportCost,
          transportCharge,
          transportPaidStatus,
          items: { create: built.itemsData },
        },
        include: { items: true },
      });

      // Repost the FULL order (final-at-create model): client sale debt, factory cost debt
      // and driver transport-cost. The PROVISIONAL gate above guarantees no factory payment
      // is stranded; the mode-change guard above guarantees no transport payment is stranded.
      await this.postOrderClientLedger(tx, {
        orderId: id,
        date,
        clientId: existing.clientId,
        saleTotal: built.saleTotal,
        transportMode,
        transportCost,
        transportCharge,
        createdById: user.userId,
      });

      await this.postOrderSupplyLedger(tx, {
        orderId: id,
        date,
        factoryId: built.factoryId,
        vehicleId,
        costTotal: built.costTotal,
        transportMode,
        transportCost,
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

      // re-accrue bonus on the freshly-reposted cost (reversed above); idempotent. Only when
      // the order is actually completed — if it was manually stepped back (completedAt null),
      // accruing here would re-introduce the bonus that step-back deliberately removed.
      if (existing.completedAt) await this.bonus.accrueForOrder(tx, id, user.userId);

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

  // `setStatus` va `GET /orders/board` OLIB TASHLANDI (2026-07-22, egasi qoidasi):
  // buyurtma yaratilgan payti COMPLETED bo'ladi, bosqichma-bosqich status yo'q. Route ochiq
  // qolsa ADMIN yakunlangan buyurtmani DELIVERED ga qaytarib, zavod tannarxi + transport
  // qarzini ledger'dan yechib tashlardi. Miqdor/narx tuzatishi `update()` orqali (u
  // supply+bonus ni to'liq reverse+repost qiladi). Yagona tirik holat o'zgarishi — CANCELLED.

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

      // serialize the money-side unwind against concurrent factory ops too
      if (order.factoryId) {
        await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${order.factoryId} FOR UPDATE`;
      }

      // 1. reverse the order's OWN ledger — sale (client debt), cost (factory debt),
      //    transport, and any advance-draw pairs (they carry orderId). After this the
      //    client shows an advance = what they paid, and the factory advance we drew is back.
      await this.ledger.reverseAllForOrder(tx, id, 'Buyurtma bekor qilindi: ' + dto.reason, user.userId);
      await this.pallets.reverseForOrder(tx, id, user.userId);
      // unconditional — reverseForOrder is idempotent (skips when no accrual exists)
      await this.bonus.reverseForOrder(tx, id, user.userId);

      // 2. PUL tomoni (egasi qoidasi, 2026-07-22 kechqurun). Ikkala rejimda ham kassa
      //    buyurtmadan OLDINGI holatiga qaytadi: zavodga to'langani kassaga qaytadi va
      //    mijozning to'lagani kassadan chiqadi — bekor qilingan buyurtmaning puli kassada
      //    turib qolmaydi. Farq mijozda nima qolishida:
      //      REFUND   — shofyorga o'z qo'li bilan bergani balansida kredit bo'lib qoladi;
      //      VOID_ALL — u ham bekor qilinadi, mijoz balansi 0 (buyurtma berilmagandek).
      //    Taqsimotlar VOID qilinishidan OLDIN, ledger teskari yozilgandan KEYIN ishlaydi.
      await this.payments.refundOrderOnCancel(tx, id, user.userId, dto.mode ?? CancelMoneyMode.REFUND);

      // 3. detach the (now-refunded) payments from the dead order
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

      // saleTotal siljidi ⇒ shofyor ulushi ham qayta hisoblanishi shart. pricePending
      // buyurtmada yaratilganda saleTotal 0 edi, demak carve-out UMUMAN yozilmagan —
      // usiz mijoz kartasi 22 000 000, buyurtma kartasi 20 000 000 ko'rsatib turardi.
      await this.syncClientDirectTransport(tx, orderId, user.userId);

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

      // Narx tuzatilgach shofyor ulushi ham siljiydi: summa pasaysa eski (katta) ulush
      // mijozni MANFIY balansga — yo'q avansga — tushirib yuborardi; summa ko'tarilsa
      // ulush transportCost'gacha yetmay, qarz oshib ketardi.
      await this.syncClientDirectTransport(tx, orderId, user.userId);

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

      // cost: effective m³ × best-known factory price. Pallets are in-kind (count), so
      // they contribute nothing here — see buildOrderItems.
      const costPrice = item.finalCostPricePerM3 != null ? D(item.finalCostPricePerM3) : D(item.costPricePerM3);
      const itemCost = round2(effM3.mul(costPrice));

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
        factoryBucket: FactoryBucket.PAYABLE,
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

    // ...va SHUNDAN KEYIN shofyor ulushi (u yangi saleTotal'dan hisoblanadi). Kam yuk
    // tushib saleTotal transportCost'dan pastga tushsa, eski ulush mijozni manfiy
    // balansga tortib ketardi; ko'p yuk tushsa — ulush yetmay qolardi.
    await this.syncClientDirectTransport(tx, orderId, userId);
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

      // PALLETS ARE NEVER MONEY (owner rule, 2026-07-21). The dealer owes the factory a
      // COUNT of pallets and gets nothing back for returning them, so a pallet must not
      // appear in any cost total. The column stays for historical rows; new orders book
      // zero and every cost formula ignores it outright.
      const palletPrice = ZERO;

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
      const costTotal = round2(quantityM3.mul(costPricePerM3)); // blocks only — pallets are in-kind

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
   * CLIENT side — posted at ORDER CREATE (mijozga qarz darhol yoziladi).
   *
   * Ikki qator yoziladi, va bu ATAYLAB shunday: buyurtma baribir «Savdo summasi 22 000 000»
   * bo'lib o'qilishi kerak, mijozning hisobvarag'i esa NEGA 20 000 000 qolganini ko'rsatishi
   * shart. Shu sabab to'liq ORDER_SALE saqlanadi va uning ostiga alohida ko'rinadigan
   * TRANSPORT_CLIENT_DIRECT carve-out qatori qo'yiladi (CLIENT_PAYS_DRIVER rejimida).
   *
   * Har ikki qator ham orderId olib yuradi — demak ledger.reverseAllForOrder ularni
   * tahrirlashda ham, bekor qilishda ham o'zi qaytaradi (ikkinchi qaytarish yo'li kerak emas).
   */
  private async postOrderClientLedger(
    tx: Prisma.TransactionClient,
    p: {
      orderId: string;
      date: Date;
      clientId: string;
      saleTotal: Prisma.Decimal;
      transportMode: TransportMode;
      transportCost: Prisma.Decimal;
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
    // CLIENT_PAYS_DRIVER: mijoz shu bo'lakni to'g'ridan-to'g'ri shofyorga beradi, shuning
    // uchun u dillerning qarzidan darhol ayriladi — hech qanday qo'lda to'lov kutilmaydi.
    // Carve-out qatorini SHU YERDA qo'lda yozmaymiz: yagona yozuvchi —
    // syncClientDirectTransport. Bu yerda ham u chaqiriladi, chunki buyurtma qatori
    // (saleTotal/transportMode/transportCost) chaqiruvdan OLDIN yozib bo'lingan, demak
    // u aynan shu summani hisoblab beradi — lekin invariant endi bitta joyda yashaydi.
    await this.syncClientDirectTransport(tx, p.orderId, p.createdById);
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
   * SHOFYOR ULUSHI INVARIANTI — yagona yozuvchi.
   *
   *   Σ (buyurtmaning FAOL TRANSPORT_CLIENT_DIRECT qatorlari)
   *     == −clientDirectTransport({transportMode, transportCost, JORIY saleTotal})
   *
   * Carve-out bir marta, buyurtma yaratilganda yozilardi — lekin saleTotal keyin ham
   * qonuniy ravishda o'zgaradi (kechiktirilgan narxlash, admin narx tuzatishi, haqiqiy
   * yuk). O'shanda faqat sotuv deltasi yozilib, ulush eskisicha qolar edi — natijada
   * MIJOZ KARTASI va BUYURTMA KARTASI turli raqam ko'rsatardi (egasining asl shikoyati).
   * Shu sabab saleTotal'ni siljitadigan HAR BIR yo'l shu funksiyani chaqiradi.
   *
   * Farq DELTA qator bilan yopiladi — teskari qilib qayta yozilmaydi: aks holda har bir
   * narx tuzatishida ikkitadan qator to'planib, mijozning hisobvarag'i o'qib bo'lmas
   * holga kelardi.
   *
   * «Faol» = ledger.service qoidasi bilan bir xil: qaytarish qatori emas (reversalOfId
   * null) va o'zi qaytarilmagan (reversedBy null).
   */
  private async syncClientDirectTransport(
    tx: Prisma.TransactionClient,
    orderId: string,
    userId: string | null,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        clientId: true,
        date: true,
        status: true,
        saleTotal: true,
        transportMode: true,
        transportCost: true,
      },
    });
    // bekor qilingan buyurtmada butun ledger allaqachon qaytarilgan — bu yerda yangi
    // qator yozish o'lik buyurtmani tiriltirib qo'yardi
    if (!order || order.status === OrderStatus.CANCELLED) return;

    const target = clientDirectTransport(order).negated();

    const agg = await tx.ledgerEntry.aggregate({
      where: {
        orderId,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.TRANSPORT_CLIENT_DIRECT,
        reversalOfId: null,
        reversedBy: null,
      },
      _sum: { amount: true },
    });
    const posted = round2(D(agg._sum.amount ?? 0));

    const delta = round2(target.minus(posted));
    if (delta.isZero()) return;

    await this.ledger.post(tx, {
      date: order.date,
      account: LedgerAccount.CLIENT,
      source: LedgerSource.TRANSPORT_CLIENT_DIRECT,
      amount: delta,
      clientId: order.clientId,
      orderId,
      note: posted.isZero()
        ? "Shofyorga mijoz to'laydi (summa ichidan)"
        : `Shofyor ulushi qayta hisoblandi (savdo summasi o'zgardi): ${posted.negated().toFixed(2)} → ${target.negated().toFixed(2)}`,
      createdById: userId,
    });
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
        // open goods debt — never nets against money standing at the factory until
        // someone explicitly draws it (see LedgerService.postAdvanceDraw)
        factoryBucket: FactoryBucket.PAYABLE,
        amount: p.costTotal.negated(),
        factoryId: p.factoryId,
        orderId: p.orderId,
        createdById: p.createdById,
      });
    }
    // Faqat DILLER shofyorga qarzdor bo'lgan rejimlarda VEHICLE qarzi yoziladi.
    // CLIENT_PAYS_DRIVER'da diller bu pul zanjirida umuman qatnashmaydi (mijoz shofyorga
    // o'zi beradi) — bu yerda qator yozish dillerga yo'q qarzni o'ylab topgan bo'lardi.
    // DEALER_CHARGED — eski (nofaol) rejim, tarixiy qatorlar o'z holicha o'qilaveradi.
    const dealerOwesDriver =
      p.transportMode === TransportMode.DEALER_ABSORBED || p.transportMode === TransportMode.DEALER_CHARGED;
    if (dealerOwesDriver && p.transportCost.gt(0) && p.vehicleId) {
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
