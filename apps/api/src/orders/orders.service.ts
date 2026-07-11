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
import { PricingService } from '../common/pricing.service';
import { SettingsService, SETTING_KEYS } from '../common/settings.service';
import { assertPositiveMoney, D, round2, round3, sum, ZERO } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { agentScope, assertOwnAgent, RequestUser } from '../common/scoping';
import { PalletService } from '../pallets/pallets.service';
import { BonusService } from '../bonus/bonus.service';
import {
  AddCommentDto,
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

interface BuiltItem {
  productId: string;
  quantityM3: Prisma.Decimal;
  palletCount: number;
  palletPrice: Prisma.Decimal;
  listPricePerM3: Prisma.Decimal | null;
  salePricePerM3: Prisma.Decimal;
  saleTotal: Prisma.Decimal;
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
      }

      const built = await this.buildOrderItems(tx, dto.items, {
        clientId: client.id,
        date,
        provisionalPriceKind,
        role: user.role,
      });

      await this.assertCapacity(built.totalPallets, vehicle);

      const transportMode = dto.transportMode ?? TransportMode.DEALER_ABSORBED;
      const transportCost =
        transportMode === TransportMode.CLIENT_OWN
          ? ZERO
          : this.toNonNegativeMoney(dto.transportCost, 'transportCost');
      const transportCharge =
        transportMode === TransportMode.DEALER_CHARGED
          ? this.toNonNegativeMoney(dto.transportCharge, 'transportCharge')
          : ZERO;

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
          if (outstanding.gte(limit)) {
            throw new BadRequestException(
              `Agent qarz limiti: limit ${limit.toFixed(2)}, joriy qarz ${outstanding.toFixed(2)} — yangi buyurtma bloklandi`,
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

      await this.postOrderLedger(tx, {
        orderId: order.id,
        date,
        clientId: client.id,
        factoryId: built.factoryId,
        vehicleId: vehicle?.id ?? null,
        saleTotal: built.saleTotal,
        costTotal: built.costTotal,
        transportMode,
        transportCost,
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
    return paged(items, total, page, pageSize);
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
    return order;
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

      const transportMode = dto.transportMode ?? existing.transportMode;
      const transportCost =
        transportMode === TransportMode.CLIENT_OWN
          ? ZERO
          : dto.transportCost === undefined
            ? round2(existing.transportCost)
            : this.toNonNegativeMoney(dto.transportCost, 'transportCost');
      const transportCharge =
        transportMode !== TransportMode.DEALER_CHARGED
          ? ZERO
          : dto.transportCharge === undefined
            ? round2(existing.transportCharge)
            : this.toNonNegativeMoney(dto.transportCharge, 'transportCharge');

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

      await this.postOrderLedger(tx, {
        orderId: id,
        date,
        clientId: existing.clientId,
        factoryId: built.factoryId,
        vehicleId,
        saleTotal: built.saleTotal,
        costTotal: built.costTotal,
        transportMode,
        transportCost,
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

  // ─────────────────────────────── status ───────────────────────────────

  async setStatus(id: string, dto: SetStatusDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
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

      if (toIdx >= STATUS_FLOW.indexOf(OrderStatus.LOADING) && !order.vehicleId) {
        throw new BadRequestException('Moshina biriktirilmagan');
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
      if (order.completedAt) await this.bonus.reverseForOrder(tx, id, user.userId);

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
      let listPricePerM3: Prisma.Decimal | null = null;

      if (!pricePending) {
        if (this.hasValue(it.saleLumpSum)) {
          const lump = this.toPositiveMoney(it.saleLumpSum!, 'saleLumpSum');
          salePricePerM3 = lump.div(quantityM3).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
          saleTotal = lump; // negotiated lump sum is stored EXACTLY
          listPricePerM3 = await this.trySalePrice(tx, it.productId, opts.clientId, opts.date);
          await this.assertAgentPriceFloor(tx, opts.role, it.productId, salePricePerM3, opts.date);
        } else {
          listPricePerM3 = await this.pricing.resolveSalePrice(tx, it.productId, opts.clientId, opts.date);
          if (this.hasValue(it.salePricePerM3)) {
            salePricePerM3 = this.toPositivePrice(it.salePricePerM3!, 'salePricePerM3');
            await this.assertAgentPriceFloor(tx, opts.role, it.productId, salePricePerM3, opts.date);
          } else {
            salePricePerM3 = listPricePerM3;
          }
          saleTotal = round2(quantityM3.mul(salePricePerM3));
        }
      }

      const costPricePerM3 = await this.pricing.resolveFactoryPrice(
        tx,
        it.productId,
        opts.provisionalPriceKind,
        opts.date,
      );
      const costTotal = round2(quantityM3.mul(costPricePerM3).plus(palletPrice.mul(palletCount)));

      itemsData.push({
        productId: it.productId,
        quantityM3,
        palletCount,
        palletPrice,
        listPricePerM3,
        salePricePerM3,
        saleTotal,
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
  private async postOrderLedger(
    tx: Prisma.TransactionClient,
    p: {
      orderId: string;
      date: Date;
      clientId: string;
      factoryId: string;
      vehicleId: string | null;
      saleTotal: Prisma.Decimal;
      costTotal: Prisma.Decimal;
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
    const floor = await this.pricing.resolveFactoryPrice(tx, productId, PriceKind.FACTORY_BANK, date);
    if (salePricePerM3.lt(floor)) {
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
