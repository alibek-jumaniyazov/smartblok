import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  BonusProgramKind,
  BonusTransactionType,
  Cashbox,
  CashDirection,
  CashSource,
  CostStatus,
  Currency,
  LedgerAccount,
  LedgerSource,
  Order,
  OrderStatus,
  Payment,
  PaymentKind,
  PaymentMethod,
  PriceKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { PricingService } from '../common/pricing.service';
import { assertPositiveMoney, D, round2, sum, ZERO } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { assertOwnAgent, clientAgentScope, RequestUser } from '../common/scoping';
import { recomputeTransportStatus } from '../common/transport';
import {
  AllocateDto,
  AllocationItemDto,
  CreatePaymentDto,
  PaymentsQueryDto,
  VoidPaymentDto,
} from './dto';

/** kind → which party FKs are required — mirrors SQL CHECK "payment_kind_party" */
const KIND_PARTY: Record<PaymentKind, { client: boolean; factory: boolean; vehicle: boolean }> = {
  [PaymentKind.CLIENT_IN]: { client: true, factory: false, vehicle: false },
  [PaymentKind.CLIENT_REFUND]: { client: true, factory: false, vehicle: false },
  [PaymentKind.FACTORY_OUT]: { client: false, factory: true, vehicle: false },
  [PaymentKind.FACTORY_REFUND]: { client: false, factory: true, vehicle: false },
  [PaymentKind.VEHICLE_OUT]: { client: false, factory: false, vehicle: true },
  [PaymentKind.TRANSPORT_DIRECT]: { client: true, factory: false, vehicle: true },
};

/** kinds where money flows INTO a cashbox (all other cashbox kinds are OUT) */
const CASH_IN_KINDS: readonly PaymentKind[] = [PaymentKind.CLIENT_IN, PaymentKind.FACTORY_REFUND];

/** payment methods that settle at the factory's CASH price (everything else → BANK price) */
const FACTORY_CASH_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.USD,
];

/** kinds that may carry order allocations at all (create-time or endpoint) */
const ALLOCATABLE_KINDS: readonly PaymentKind[] = [
  PaymentKind.CLIENT_IN,
  PaymentKind.FACTORY_OUT,
  PaymentKind.VEHICLE_OUT,
  PaymentKind.TRANSPORT_DIRECT,
];

const listInclude = {
  client: { select: { id: true, name: true, agentId: true } },
  factory: { select: { id: true, name: true } },
  vehicle: { select: { id: true, name: true, plate: true, driver: true } },
  agent: { select: { id: true, name: true } },
  cashbox: { select: { id: true, name: true, type: true, currency: true } },
  allocations: {
    where: { voidedAt: null },
    include: { order: { select: { id: true, orderNo: true } } },
  },
} satisfies Prisma.PaymentInclude;

const detailInclude = {
  client: { select: { id: true, name: true, agentId: true, phone: true } },
  factory: { select: { id: true, name: true } },
  vehicle: { select: { id: true, name: true, plate: true, driver: true } },
  agent: { select: { id: true, name: true } },
  cashbox: { select: { id: true, name: true, type: true, currency: true } },
  payerEntity: true,
  receiverEntity: true,
  createdBy: { select: { id: true, name: true, username: true } },
  voidedBy: { select: { id: true, name: true, username: true } },
  allocations: {
    include: {
      order: {
        select: { id: true, orderNo: true, costStatus: true, transportPaidStatus: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  ledgerEntries: { orderBy: { at: 'asc' } },
  cashTransactions: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PaymentInclude;

/** allocation/recompute chains touch pricing history — give the interactive tx headroom */
const TX_OPTS = { maxWait: 10_000, timeout: 30_000 };

/** Decimal/Date-safe snapshot for audit JSON columns. */
const plain = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private pricing: PricingService,
  ) {}

  /** assertPositiveMoney throws a bare Error — surface it as a 400, not a 500 */
  private positiveMoney(v: Prisma.Decimal.Value | undefined, field: string): Prisma.Decimal {
    try {
      return assertPositiveMoney(v ?? 0, field);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  // ─────────────────────────── create ───────────────────────────

  async create(dto: CreatePaymentDto, user: RequestUser) {
    // per-kind role matrix: only CLIENT_IN is open to AGENT (own clients only, checked below)
    if (user.role === 'AGENT' && dto.kind !== PaymentKind.CLIENT_IN) {
      throw new ForbiddenException("Agent faqat mijozdan to'lov (CLIENT_IN) kirita oladi");
    }
    // BONUS payments are born in the bonus module (debt offset), never here
    if (dto.method === PaymentMethod.BONUS) {
      throw new BadRequestException(
        "BONUS usuli bu yerda qabul qilinmaydi — bonus hisobidan to'lash /bonus/offset orqali amalga oshiriladi",
      );
    }
    // Inline allocations are the same privileged operation as POST /:id/allocations —
    // without this gate a CASHIER/AGENT could finalize order costs at create time.
    if (dto.allocations?.length && user.role !== 'ADMIN' && user.role !== 'ACCOUNTANT') {
      throw new ForbiddenException(
        "To'lovni buyurtmalarga taqsimlash faqat ADMIN/ACCOUNTANT uchun",
      );
    }
    const date = new Date(dto.date);

    try {
      return await this.createTx(dto, user, date);
    } catch (e) {
      // concurrent duplicate submit: both passed the pre-check, the unique index
      // rejected the second — return the original instead of a 500
      if (
        dto.idempotencyKey &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        (e.meta?.target as string[] | string | undefined)?.includes?.('idempotencyKey')
      ) {
        const existing = await this.prisma.payment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: detailInclude,
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  private async createTx(dto: CreatePaymentDto, user: RequestUser, date: Date) {
    return this.prisma.$transaction(async (tx) => {
      // 1. idempotency: a repeated submit returns the original payment untouched
      if (dto.idempotencyKey) {
        const existing = await tx.payment.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: detailInclude,
        });
        if (existing) return existing;
      }

      // 2. amount: USD channel stores the UZS value, computed — never client-supplied
      let amount: Prisma.Decimal;
      let usdAmount = ZERO;
      let rate = ZERO;
      if (dto.method === PaymentMethod.USD) {
        if (dto.usdAmount == null || dto.rate == null) {
          throw new BadRequestException("USD to'lovi uchun usdAmount va rate majburiy");
        }
        usdAmount = this.positiveMoney(dto.usdAmount, 'usdAmount');
        rate = this.positiveMoney(dto.rate, 'rate');
        amount = round2(usdAmount.times(rate));
      } else {
        amount = this.positiveMoney(dto.amount, 'amount');
      }

      // 3/4. cashbox: TRANSPORT_DIRECT never touches dealer cash; everything else must
      let cashbox: Cashbox | null = null;
      if (dto.kind === PaymentKind.TRANSPORT_DIRECT) {
        if (dto.cashboxId) {
          throw new BadRequestException(
            "TRANSPORT_DIRECT to'lovi kassadan o'tmaydi — cashboxId yuborilmasin",
          );
        }
      } else {
        if (!dto.cashboxId) {
          throw new BadRequestException(`${dto.kind} to'lovi uchun cashboxId majburiy`);
        }
        cashbox = await tx.cashbox.findUnique({ where: { id: dto.cashboxId } });
        if (!cashbox || !cashbox.active) {
          throw new BadRequestException('Kassa topilmadi yoki faol emas');
        }
        const needCurrency = dto.method === PaymentMethod.USD ? Currency.USD : Currency.UZS;
        if (cashbox.currency !== needCurrency) {
          throw new BadRequestException(`Bu to'lov uchun kassa valyutasi ${needCurrency} bo'lishi kerak`);
        }
      }

      // 5. party ↔ kind (mirror of SQL CHECK payment_kind_party, plus existence)
      const spec = KIND_PARTY[dto.kind];
      if (spec.client && !dto.clientId) throw new BadRequestException(`${dto.kind} uchun clientId majburiy`);
      if (!spec.client && dto.clientId) throw new BadRequestException(`${dto.kind} to'lovida clientId bo'lmasligi kerak`);
      if (spec.factory && !dto.factoryId) throw new BadRequestException(`${dto.kind} uchun factoryId majburiy`);
      if (!spec.factory && dto.factoryId) throw new BadRequestException(`${dto.kind} to'lovida factoryId bo'lmasligi kerak`);
      if (spec.vehicle && !dto.vehicleId) throw new BadRequestException(`${dto.kind} uchun vehicleId majburiy`);
      if (!spec.vehicle && dto.vehicleId) throw new BadRequestException(`${dto.kind} to'lovida vehicleId bo'lmasligi kerak`);

      let agentId: string | null = null;
      if (dto.clientId) {
        // CLIENT_REFUND increases the client's debt — take the same row lock the
        // order-creation credit gate uses so the two cannot race past each other
        if (dto.kind === PaymentKind.CLIENT_REFUND) {
          await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${dto.clientId} FOR UPDATE`;
        }
        const client = await tx.client.findUnique({ where: { id: dto.clientId } });
        if (!client) throw new BadRequestException('Mijoz topilmadi');
        if (dto.kind === PaymentKind.CLIENT_IN) assertOwnAgent(user, client.agentId);
        agentId = client.agentId; // attribution snapshot at payment time
      }
      if (dto.factoryId) {
        const factory = await tx.factory.findUnique({ where: { id: dto.factoryId } });
        if (!factory) throw new BadRequestException('Zavod topilmadi');
      }
      if (dto.vehicleId) {
        const vehicle = await tx.vehicle.findUnique({ where: { id: dto.vehicleId } });
        if (!vehicle) throw new BadRequestException('Mashina topilmadi');
      }
      if (dto.payerEntityId) {
        const e = await tx.legalEntity.findUnique({ where: { id: dto.payerEntityId } });
        if (!e) throw new BadRequestException("To'lovchi yuridik shaxs topilmadi");
      }
      if (dto.receiverEntityId) {
        const e = await tx.legalEntity.findUnique({ where: { id: dto.receiverEntityId } });
        if (!e) throw new BadRequestException('Qabul qiluvchi yuridik shaxs topilmadi');
      }

      // 6. payment row
      const payment = await tx.payment.create({
        data: {
          date,
          kind: dto.kind,
          method: dto.method,
          amount,
          usdAmount,
          rate,
          denominations:
            dto.denominations === undefined
              ? undefined
              : (dto.denominations as Prisma.InputJsonValue),
          agentId,
          clientId: dto.clientId ?? null,
          factoryId: dto.factoryId ?? null,
          vehicleId: dto.vehicleId ?? null,
          payerEntityId: dto.payerEntityId ?? null,
          receiverEntityId: dto.receiverEntityId ?? null,
          payerName: dto.payerName ?? null,
          receiverName: dto.receiverName ?? null,
          cashboxId: cashbox?.id ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          note: dto.note ?? null,
          createdById: user.userId,
        },
      });

      // ledger postings (sign convention: >0 = asset for the dealer)
      await this.postLedger(tx, payment, user.userId);

      // 7. kassa row (TRANSPORT_DIRECT skips the kassa entirely)
      if (payment.kind !== PaymentKind.TRANSPORT_DIRECT && cashbox) {
        const direction = CASH_IN_KINDS.includes(payment.kind) ? CashDirection.IN : CashDirection.OUT;
        const cashAmount = cashbox.currency === Currency.USD ? usdAmount : amount;
        if (direction === CashDirection.OUT) {
          // serialize concurrent OUTs and enforce the same never-below-zero rule
          // the manual-kassa and expense paths already apply
          await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${cashbox.id} FOR UPDATE`;
          const sums = await tx.cashTransaction.groupBy({
            by: ['direction'],
            where: { cashboxId: cashbox.id },
            _sum: { amount: true },
          });
          const inSum = D(sums.find((s) => s.direction === CashDirection.IN)?._sum.amount ?? 0);
          const outSum = D(sums.find((s) => s.direction === CashDirection.OUT)?._sum.amount ?? 0);
          const balance = inSum.minus(outSum);
          if (balance.lessThan(cashAmount)) {
            throw new BadRequestException(
              `Kassada mablag' yetarli emas: qoldiq ${balance.toFixed(2)}, so'ralgan ${cashAmount.toFixed(2)}`,
            );
          }
        }
        await tx.cashTransaction.create({
          data: {
            cashboxId: cashbox.id,
            date,
            direction,
            amount: cashAmount,
            rate,
            source: CashSource.PAYMENT,
            paymentId: payment.id,
            note: dto.note ?? null,
            createdById: user.userId,
          },
        });
      }

      // 8/9. inline allocations (also marks transport paid for VEHICLE_OUT / TRANSPORT_DIRECT)
      if (dto.allocations?.length) {
        await this.applyAllocations(tx, payment, dto.allocations, user.userId);
      }

      // 10. audit
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.CREATE,
        entity: 'Payment',
        entityId: payment.id,
        after: plain(payment),
      });

      return tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: detailInclude });
    }, TX_OPTS);
  }

  /** one posting per kind — TRANSPORT_DIRECT posts BOTH sides (client credited, vehicle settled) */
  private async postLedger(tx: Prisma.TransactionClient, p: Payment, userId: string) {
    const base = {
      date: p.date,
      source: LedgerSource.PAYMENT,
      paymentId: p.id,
      createdById: userId,
    };
    switch (p.kind) {
      case PaymentKind.CLIENT_IN:
        await this.ledger.post(tx, { ...base, account: LedgerAccount.CLIENT, clientId: p.clientId, amount: D(p.amount).negated() });
        break;
      case PaymentKind.CLIENT_REFUND:
        await this.ledger.post(tx, { ...base, account: LedgerAccount.CLIENT, clientId: p.clientId, amount: p.amount });
        break;
      case PaymentKind.FACTORY_OUT:
        await this.ledger.post(tx, { ...base, account: LedgerAccount.FACTORY, factoryId: p.factoryId, amount: p.amount });
        break;
      case PaymentKind.FACTORY_REFUND:
        await this.ledger.post(tx, { ...base, account: LedgerAccount.FACTORY, factoryId: p.factoryId, amount: D(p.amount).negated() });
        break;
      case PaymentKind.VEHICLE_OUT:
        await this.ledger.post(tx, { ...base, account: LedgerAccount.VEHICLE, vehicleId: p.vehicleId, amount: p.amount });
        break;
      case PaymentKind.TRANSPORT_DIRECT:
        await this.ledger.post(tx, { ...base, account: LedgerAccount.CLIENT, clientId: p.clientId, amount: D(p.amount).negated() });
        await this.ledger.post(tx, { ...base, account: LedgerAccount.VEHICLE, vehicleId: p.vehicleId, amount: p.amount });
        break;
    }
  }

  // ─────────────────────────── allocations ───────────────────────────

  /** POST /payments/:id/allocations — settlement (CLIENT_IN) or cost finalization (FACTORY_OUT) */
  async allocate(paymentId: string, dto: AllocateDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException("To'lov topilmadi");
      if (payment.voidedAt) throw new BadRequestException("Bekor qilingan to'lov taqsimlanmaydi");
      if (payment.kind !== PaymentKind.CLIENT_IN && payment.kind !== PaymentKind.FACTORY_OUT) {
        throw new BadRequestException(
          "Bu endpoint faqat CLIENT_IN va FACTORY_OUT to'lovlarini taqsimlaydi",
        );
      }

      await this.applyAllocations(tx, payment, dto.allocations, user.userId);

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.CREATE,
        entity: 'PaymentAllocation',
        entityId: payment.id,
        after: plain({ paymentId: payment.id, allocations: dto.allocations }),
        note: `Allocation for payment ${payment.id}`,
      });

      return tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: detailInclude });
    }, TX_OPTS);
  }

  /**
   * Shared allocation engine (endpoint + inline-at-create).
   * CLIENT_IN → aging/settlement rows; FACTORY_OUT → priceKind rows + cost recompute;
   * VEHICLE_OUT / TRANSPORT_DIRECT (create-time only) → marks orders' transport as paid.
   */
  private async applyAllocations(
    tx: Prisma.TransactionClient,
    payment: Payment,
    items: AllocationItemDto[],
    userId: string,
  ) {
    if (!ALLOCATABLE_KINDS.includes(payment.kind)) {
      throw new BadRequestException(`${payment.kind} to'lovi buyurtmalarga taqsimlanmaydi`);
    }

    // serialize allocate-vs-allocate and allocate-vs-void on this payment,
    // then re-read its state from inside the lock
    await tx.$executeRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
    payment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (payment.voidedAt) {
      throw new BadRequestException("Bekor qilingan to'lov taqsimlanmaydi");
    }

    const amounts = items.map((i) => this.positiveMoney(i.amount, 'allocations[].amount'));

    // Σ(active allocations incl. new) must never exceed the payment amount
    const existing = await tx.paymentAllocation.aggregate({
      where: { paymentId: payment.id, voidedAt: null },
      _sum: { amount: true },
    });
    const total = D(existing._sum.amount ?? 0).plus(sum(amounts));
    if (total.greaterThan(D(payment.amount))) {
      throw new BadRequestException("Taqsimotlar yig'indisi to'lov summasidan oshib ketadi");
    }

    // FACTORY_OUT allocations carry the cost basis derived from the payment method
    const priceKind =
      payment.kind === PaymentKind.FACTORY_OUT
        ? FACTORY_CASH_METHODS.includes(payment.method)
          ? PriceKind.FACTORY_CASH
          : PriceKind.FACTORY_BANK
        : null;

    const touchedOrderIds: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const order = await tx.order.findUnique({ where: { id: items[i].orderId } });
      if (!order) throw new BadRequestException(`Buyurtma topilmadi: ${items[i].orderId}`);
      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException(`Bekor qilingan buyurtmaga taqsimlab bo'lmaydi: ${order.orderNo}`);
      }
      this.assertAllocationParty(payment, order);

      try {
        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            orderId: order.id,
            amount: amounts[i],
            priceKind,
            createdById: userId,
          },
        });
      } catch (e) {
        // partial unique index "PaymentAllocation_active_pair": one ACTIVE
        // allocation per (payment, order) — void it first to change the amount
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new BadRequestException(
            `Bu to'lov ${order.orderNo} buyurtmasiga allaqachon taqsimlangan — avval mavjud taqsimotni bekor qiling`,
          );
        }
        throw e;
      }
      if (!touchedOrderIds.includes(order.id)) touchedOrderIds.push(order.id);
    }

    // transport settlement is DERIVED from surviving payments (a 1-so'm allocation
    // must not read as PAID; another payment's settlement must not be clobbered)
    if (payment.kind === PaymentKind.VEHICLE_OUT || payment.kind === PaymentKind.TRANSPORT_DIRECT) {
      for (const orderId of touchedOrderIds) {
        await recomputeTransportStatus(tx, orderId);
      }
    }

    // provisional → PARTIAL/FINAL cost engine
    if (payment.kind === PaymentKind.FACTORY_OUT) {
      for (const orderId of touchedOrderIds) {
        await this.recomputeOrderCost(tx, orderId, userId);
      }
    }
    return touchedOrderIds;
  }

  /** the allocated order must belong to the payment's party */
  private assertAllocationParty(payment: Payment, order: Order) {
    switch (payment.kind) {
      case PaymentKind.CLIENT_IN:
        if (order.clientId !== payment.clientId) {
          throw new BadRequestException(`Buyurtma ${order.orderNo} boshqa mijozga tegishli`);
        }
        break;
      case PaymentKind.FACTORY_OUT:
        if (order.factoryId !== payment.factoryId) {
          throw new BadRequestException(`Buyurtma ${order.orderNo} boshqa zavodga tegishli`);
        }
        break;
      case PaymentKind.VEHICLE_OUT:
        if (!order.vehicleId || order.vehicleId !== payment.vehicleId) {
          throw new BadRequestException(`Buyurtma ${order.orderNo} bu mashinaga tegishli emas`);
        }
        break;
      case PaymentKind.TRANSPORT_DIRECT:
        if (order.clientId !== payment.clientId) {
          throw new BadRequestException(`Buyurtma ${order.orderNo} boshqa mijozga tegishli`);
        }
        if (order.vehicleId && order.vehicleId !== payment.vehicleId) {
          throw new BadRequestException(`Buyurtma ${order.orderNo} bu mashinaga tegishli emas`);
        }
        break;
      default:
        throw new BadRequestException(`${payment.kind} to'lovi buyurtmalarga taqsimlanmaydi`);
    }
  }

  // ─────────────────────────── cost recompute ───────────────────────────

  /**
   * Provisional → final cost engine (owner-locked rule).
   * covered = Σ active allocations from non-voided FACTORY_OUT payments.
   *   covered = 0            → PROVISIONAL (reverting a finalization if needed)
   *   0 < covered < costTotal → PARTIAL (no repricing)
   *   covered ≥ costTotal     → FINAL at the price kind of the LATEST active allocation
   * The provisional→final delta posts as a COST_ADJUSTMENT ledger entry (immutable trail).
   */
  async recomputeOrderCost(tx: Prisma.TransactionClient, orderId: string, userId: string | null) {
    // serialize concurrent recomputes on this order — the COST_ADJUSTMENT posting
    // below happens before any row write would otherwise block, so without this
    // lock two allocations finalizing together double-post the delta
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status === OrderStatus.CANCELLED) return;

    // the finalize threshold is the STABLE provisional cost — comparing against a
    // finalized costTotal would flip FINAL→PARTIAL the moment finalization changes it
    const provisionalTotal = order.items.reduce(
      (acc, item) =>
        acc.plus(
          round2(
            D(item.quantityM3)
              .times(item.costPricePerM3)
              .plus(D(item.palletPrice).times(item.palletCount)),
          ),
        ),
      ZERO,
    );

    const allocs = await tx.paymentAllocation.findMany({
      where: {
        orderId,
        voidedAt: null,
        payment: { kind: PaymentKind.FACTORY_OUT, voidedAt: null },
      },
      orderBy: { createdAt: 'asc' },
    });
    const covered = sum(allocs.map((a) => a.amount));

    if (covered.lessThan(provisionalTotal)) {
      // any drop below the threshold un-finalizes: compensate COST_ADJUSTMENT
      // postings and restore the provisional cost, THEN settle on PARTIAL/PROVISIONAL
      if (order.costStatus === CostStatus.FINAL) {
        const adjustments = await tx.ledgerEntry.findMany({
          where: {
            orderId,
            source: LedgerSource.COST_ADJUSTMENT,
            reversalOfId: null,
            reversedBy: null,
          },
        });
        for (const e of adjustments) {
          await this.ledger.reverse(tx, e.id, 'Tannarx qotirish bekor qilindi', userId);
        }
        for (const item of order.items) {
          const itemCost = round2(
            D(item.quantityM3)
              .times(item.costPricePerM3)
              .plus(D(item.palletPrice).times(item.palletCount)),
          );
          await tx.orderItem.update({
            where: { id: item.id },
            data: { finalCostPricePerM3: null, costTotal: itemCost },
          });
        }
        await tx.order.update({
          where: { id: orderId },
          data: { costTotal: provisionalTotal, costFinalizedAt: null },
        });
        await this.adjustBonusForOrder(tx, orderId, userId);
      }
      const target = covered.lessThanOrEqualTo(0) ? CostStatus.PROVISIONAL : CostStatus.PARTIAL;
      if (order.costStatus !== target) {
        await tx.order.update({ where: { id: orderId }, data: { costStatus: target } });
      }
      return;
    }

    // FINALIZE — deterministic rule: price kind of the LATEST active allocation wins
    const finalKind = allocs[allocs.length - 1].priceKind ?? PriceKind.FACTORY_BANK;
    let newCostTotal = ZERO;
    const itemUpdates: { id: string; finalPrice: Prisma.Decimal; cost: Prisma.Decimal }[] = [];
    for (const item of order.items) {
      // order DATE resolves the price row; the allocation only picks WHICH kind applies
      const finalPrice = await this.pricing.resolveFactoryPrice(tx, item.productId, finalKind, order.date);
      const cost = round2(
        D(item.quantityM3).times(finalPrice).plus(D(item.palletPrice).times(item.palletCount)),
      );
      newCostTotal = newCostTotal.plus(cost);
      itemUpdates.push({ id: item.id, finalPrice, cost });
    }

    const delta = newCostTotal.minus(D(order.costTotal));
    if (!delta.isZero()) {
      await this.ledger.post(tx, {
        date: new Date(),
        account: LedgerAccount.FACTORY,
        source: LedgerSource.COST_ADJUSTMENT,
        amount: delta.negated(), // cost grew ⇒ we owe the factory more (negative posting)
        factoryId: order.factoryId,
        orderId: order.id,
        note: `Tannarx qotirildi (${finalKind})`,
        createdById: userId,
      });
    }
    for (const u of itemUpdates) {
      await tx.orderItem.update({
        where: { id: u.id },
        data: { finalCostPricePerM3: u.finalPrice, costTotal: u.cost },
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: { costTotal: newCostTotal, costStatus: CostStatus.FINAL, costFinalizedAt: new Date() },
    });

    // a completed order's PERCENT bonus was accrued on the then-best-known cost —
    // repricing the purchase reprices the bonus, as a traceable ADJUSTMENT
    await this.adjustBonusForOrder(tx, orderId, userId);

    await this.audit.log({
      tx,
      userId,
      action: AuditAction.COST_FINALIZE,
      entity: 'Order',
      entityId: order.id,
      before: plain({ costTotal: order.costTotal, costStatus: order.costStatus }),
      after: plain({ costTotal: newCostTotal, costStatus: CostStatus.FINAL, finalKind }),
    });
  }

  /**
   * Re-derives a completed order's PERCENT bonus after its purchase cost changed
   * (finalization or un-finalization). The original ACCRUAL is immutable; the
   * difference posts as a BonusTransaction ADJUSTMENT so the wallet always
   * reflects "percent × best-known blocks cost" with a full audit trail.
   */
  private async adjustBonusForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    userId: string | null,
  ) {
    const accrual = await tx.bonusTransaction.findFirst({
      where: { orderId, type: BonusTransactionType.ACCRUAL, reversedBy: null },
      include: { program: true },
    });
    if (!accrual?.program || accrual.program.kind !== BonusProgramKind.PERCENT) return;

    const items = await tx.orderItem.findMany({ where: { orderId } });
    // blocks only — pallet money is not part of the purchase-amount base
    const blocksBase = items.reduce(
      (acc, i) =>
        acc.plus(round2(D(i.quantityM3).times(D(i.finalCostPricePerM3 ?? i.costPricePerM3)))),
      ZERO,
    );
    const expected = round2(blocksBase.times(D(accrual.program.percent ?? 0)).div(100));

    const priorAdjustments = await tx.bonusTransaction.findMany({
      where: { orderId, type: BonusTransactionType.ADJUSTMENT, reversedBy: null },
    });
    const currentNet = D(accrual.amount).plus(sum(priorAdjustments.map((a) => a.amount)));
    const delta = expected.minus(currentNet);
    if (delta.isZero()) return;

    await tx.bonusTransaction.create({
      data: {
        factoryId: accrual.factoryId,
        type: BonusTransactionType.ADJUSTMENT,
        amount: delta,
        orderId,
        programId: accrual.programId,
        baseAmount: blocksBase,
        note: 'Bonus tannarx qotirilishiga moslashtirildi',
        createdById: userId,
      },
    });
  }

  // ─────────────────────────── void ───────────────────────────

  /** Payments are never hard-deleted: void posts compensating rows everywhere. */
  async voidPayment(id: string, dto: VoidPaymentDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      // same lock the allocation engine takes — void-vs-allocate cannot interleave
      await tx.$executeRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
      const payment = await tx.payment.findUnique({
        where: { id },
        include: { allocations: { where: { voidedAt: null } } },
      });
      if (!payment) throw new NotFoundException("To'lov topilmadi");
      if (payment.voidedAt) throw new BadRequestException("To'lov allaqachon bekor qilingan");

      const note = `To'lov bekor qilindi: ${dto.reason}`;

      // 1. compensate every un-reversed ledger posting of this payment
      const entries = await tx.ledgerEntry.findMany({
        where: { paymentId: id, reversalOfId: null, reversedBy: null },
      });
      for (const e of entries) {
        await this.ledger.reverse(tx, e.id, note, user.userId);
      }

      // 2. reverse kassa rows (opposite direction, source REVERSAL, linked)
      const cashRows = await tx.cashTransaction.findMany({
        where: { paymentId: id, reversalOfId: null, reversedBy: null },
      });
      for (const c of cashRows) {
        await tx.cashTransaction.create({
          data: {
            cashboxId: c.cashboxId,
            date: new Date(),
            direction: c.direction === CashDirection.IN ? CashDirection.OUT : CashDirection.IN,
            amount: c.amount,
            rate: c.rate,
            source: CashSource.REVERSAL,
            paymentId: id,
            note,
            createdById: user.userId,
            reversalOfId: c.id,
          },
        });
      }

      // 3. void active allocations; FACTORY_OUT orders get their cost re-derived
      const affectedOrderIds = [...new Set(payment.allocations.map((a) => a.orderId))];
      if (payment.allocations.length) {
        await tx.paymentAllocation.updateMany({
          where: { paymentId: id, voidedAt: null },
          data: { voidedAt: new Date() },
        });
      }
      if (payment.kind === PaymentKind.FACTORY_OUT) {
        for (const orderId of affectedOrderIds) {
          await this.recomputeOrderCost(tx, orderId, user.userId);
        }
      }

      // 4. transport settlement is re-derived from the payments that remain —
      // another standing payment keeps the order PAID; none → UNPAID/NOT_APPLICABLE
      if (payment.kind === PaymentKind.VEHICLE_OUT || payment.kind === PaymentKind.TRANSPORT_DIRECT) {
        for (const orderId of affectedOrderIds) {
          await recomputeTransportStatus(tx, orderId);
        }
      }

      // 5. a voided bonus debt-offset must give the bonus money back to the wallet
      // (the ledger reversal above already restored the factory debt)
      if (payment.method === PaymentMethod.BONUS) {
        const bonusTx = await tx.bonusTransaction.findUnique({ where: { paymentId: id } });
        if (bonusTx && !(await tx.bonusTransaction.findUnique({ where: { reversalOfId: bonusTx.id } }))) {
          await tx.bonusTransaction.create({
            data: {
              factoryId: bonusTx.factoryId,
              type: BonusTransactionType.REVERSAL,
              amount: D(bonusTx.amount).negated(),
              programId: bonusTx.programId,
              note,
              createdById: user.userId,
              reversalOfId: bonusTx.id,
            },
          });
        }
      }

      await tx.payment.update({
        where: { id },
        data: { voidedAt: new Date(), voidReason: dto.reason, voidedById: user.userId },
      });

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.VOID,
        entity: 'Payment',
        entityId: id,
        before: plain(payment),
        after: plain({ voidReason: dto.reason, voidedById: user.userId }),
      });

      return tx.payment.findUniqueOrThrow({ where: { id }, include: detailInclude });
    }, TX_OPTS);
  }

  // ─────────────────────────── reads ───────────────────────────

  async findAll(user: RequestUser, q: PaymentsQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);

    const where: Prisma.PaymentWhereInput = {};
    if (!q.voided) where.voidedAt = null; // voided excluded by default
    if (q.kind) where.kind = q.kind;
    if (q.method) where.method = q.method;
    if (q.clientId) where.clientId = q.clientId;
    if (q.factoryId) where.factoryId = q.factoryId;
    if (q.reconciled !== undefined) where.reconciled = q.reconciled;
    if (q.dateFrom || q.dateTo) {
      where.date = {
        ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}),
      };
    }
    // AGENT sees only CLIENT_IN payments of his own clients — overrides any kind filter
    if (user.role === 'AGENT') {
      where.kind = PaymentKind.CLIENT_IN;
      Object.assign(where, clientAgentScope(user));
    }
    if (q.search) {
      where.OR = [
        { note: { contains: q.search, mode: 'insensitive' } },
        { payerName: { contains: q.search, mode: 'insensitive' } },
        { receiverName: { contains: q.search, mode: 'insensitive' } },
        { client: { name: { contains: q.search, mode: 'insensitive' } } },
        { factory: { name: { contains: q.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: listInclude,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async findOne(id: string, user: RequestUser) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: detailInclude });
    if (!payment) throw new NotFoundException("To'lov topilmadi");
    if (user.role === 'AGENT') {
      if (payment.kind !== PaymentKind.CLIENT_IN) {
        throw new ForbiddenException("Bu ma'lumot sizning agentingizga tegishli emas");
      }
      assertOwnAgent(user, payment.client?.agentId);
    }
    return payment;
  }
}
