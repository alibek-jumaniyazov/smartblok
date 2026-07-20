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
  CashboxType,
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
import { otherFactoryKind, PricingService } from '../common/pricing.service';
import { autoAllocateClientPayment } from '../common/auto-allocate';
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

/** the 4 settlement channels a user may pick in the drawer (USD/CARD retired, BONUS internal). */
const KASSA_METHODS: readonly PaymentMethod[] = [PaymentMethod.CASH, PaymentMethod.CLICK];
const BANK_METHODS: readonly PaymentMethod[] = [PaymentMethod.TERMINAL, PaymentMethod.BANK];
const ENTRY_METHODS: readonly PaymentMethod[] = [...KASSA_METHODS, ...BANK_METHODS];
/** cashbox types each method family may settle into. */
const KASSA_BOX_TYPES: readonly CashboxType[] = [CashboxType.CASH, CashboxType.CLICK];
const BANK_BOX_TYPES: readonly CashboxType[] = [CashboxType.TERMINAL, CashboxType.BANK];

/**
 * Payment methods that settle a FACTORY_OUT at the factory's CASH (discount) price
 * (everything else → BANK/official price). CASH + CLICK are the live cash-family
 * channels (user decision 2026-07-13: Click = cash-equivalent); CARD/USD are retired
 * from entry but kept here for historical FACTORY_OUT rows (also cash-equivalent).
 */
const FACTORY_CASH_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.CLICK,
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
  usdCashbox: { select: { id: true, name: true, type: true, currency: true } },
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
  usdCashbox: { select: { id: true, name: true, type: true, currency: true } },
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
    // Only the 4 live channels are accepted for entry (CARD/USD are retired — kept in
    // the enum for historical rows only; USD is now a currency mode of naqd, not a method).
    if (!ENTRY_METHODS.includes(dto.method)) {
      throw new BadRequestException(
        "Faqat naqd, click, terminal yoki bank to'lov usullari qabul qilinadi",
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

      // 2. amount: som part + optional USD part (naqd only). Stored `amount` is the
      //    UZS-equivalent (som + usd×rate) the debt ledger consumes.
      const amountUzs = dto.amount == null ? ZERO : D(dto.amount);
      if (amountUzs.isNaN() || amountUzs.isNegative()) {
        throw new BadRequestException("amount noto'g'ri (manfiy bo'lmasin)");
      }
      let usdAmount = ZERO;
      let rate = ZERO;
      const hasUsd = dto.usdAmount != null && !D(dto.usdAmount).isZero();
      if (hasUsd) {
        if (dto.method !== PaymentMethod.CASH) {
          throw new BadRequestException("Dollar/aralash valyuta faqat naqd to'lovda bo'ladi");
        }
        usdAmount = this.positiveMoney(dto.usdAmount, 'usdAmount');
        rate = this.positiveMoney(dto.rate, 'rate');
      }
      const amount = round2(amountUzs.plus(usdAmount.times(rate)));
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException("To'lov summasi noldan katta bo'lishi kerak");
      }

      // 3. cashbox routing by method — naqd/click → kassa box; terminal/bank → bank box.
      //    TRANSPORT_DIRECT never touches dealer cash. A mixed naqd payment uses TWO
      //    boxes: som → `cashbox` (UZS), dollar → `usdCashbox` (USD).
      let cashbox: Cashbox | null = null;
      let usdCashbox: Cashbox | null = null;
      if (dto.kind === PaymentKind.TRANSPORT_DIRECT) {
        if (dto.cashboxId || dto.usdCashboxId) {
          throw new BadRequestException(
            "TRANSPORT_DIRECT to'lovi kassadan o'tmaydi — kassa yuborilmasin",
          );
        }
      } else {
        const allowedTypes = KASSA_METHODS.includes(dto.method) ? KASSA_BOX_TYPES : BANK_BOX_TYPES;
        if (amountUzs.greaterThan(0)) {
          if (!dto.cashboxId) throw new BadRequestException("So'm qismi uchun kassa majburiy");
          cashbox = await tx.cashbox.findUnique({ where: { id: dto.cashboxId } });
          if (!cashbox || !cashbox.active) throw new BadRequestException('Kassa topilmadi yoki faol emas');
          if (!allowedTypes.includes(cashbox.type)) {
            throw new BadRequestException("Tanlangan kassa turi bu to'lov usuliga to'g'ri kelmaydi");
          }
          if (cashbox.currency !== Currency.UZS) {
            throw new BadRequestException("So'm qismi UZS kassaga tushishi kerak");
          }
        }
        if (usdAmount.greaterThan(0)) {
          if (!dto.usdCashboxId) throw new BadRequestException('Dollar qismi uchun valyuta kassasi majburiy');
          usdCashbox = await tx.cashbox.findUnique({ where: { id: dto.usdCashboxId } });
          if (!usdCashbox || !usdCashbox.active) {
            throw new BadRequestException('Valyuta kassasi topilmadi yoki faol emas');
          }
          if (!KASSA_BOX_TYPES.includes(usdCashbox.type)) {
            throw new BadRequestException("Dollar qismi naqd (kassa) turidagi hisobga tushishi kerak");
          }
          if (usdCashbox.currency !== Currency.USD) {
            throw new BadRequestException('Dollar qismi USD kassaga tushishi kerak');
          }
        }
        if (!cashbox && !usdCashbox) {
          throw new BadRequestException(`${dto.kind} to'lovi uchun kassa majburiy`);
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
          usdCashboxId: usdCashbox?.id ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          note: dto.note ?? null,
          createdById: user.userId,
        },
      });

      // ledger postings (sign convention: >0 = asset for the dealer)
      await this.postLedger(tx, payment, user.userId);

      // 7. kassa rows (TRANSPORT_DIRECT skips the kassa entirely). A mixed naqd payment
      //    writes TWO rows: som → UZS box, dollar → USD box. Both same direction.
      if (payment.kind !== PaymentKind.TRANSPORT_DIRECT) {
        const direction = CASH_IN_KINDS.includes(payment.kind) ? CashDirection.IN : CashDirection.OUT;
        if (cashbox && amountUzs.greaterThan(0)) {
          await this.writeCashRow(tx, cashbox, direction, amountUzs, ZERO, payment.id, date, dto.note ?? null, user.userId);
        }
        if (usdCashbox && usdAmount.greaterThan(0)) {
          await this.writeCashRow(tx, usdCashbox, direction, usdAmount, rate, payment.id, date, dto.note ?? null, user.userId);
        }
      }

      // 8/9. inline allocations (also marks transport paid for VEHICLE_OUT / TRANSPORT_DIRECT)
      if (dto.allocations?.length) {
        await this.applyAllocations(tx, payment, dto.allocations, user.userId);
      }

      // 9b. CLIENT money settles itself, oldest order first — there is no manual
      // «taqsimlash» step for it any more. Runs AFTER any inline allocations so an
      // explicitly targeted amount keeps its order and only the rest flows down the queue.
      if (payment.kind === PaymentKind.CLIENT_IN) {
        const placedInline = dto.allocations?.length
          ? await tx.paymentAllocation
              .aggregate({ where: { paymentId: payment.id, voidedAt: null }, _sum: { amount: true } })
              .then((r) => D(r._sum.amount ?? 0))
          : ZERO;
        await autoAllocateClientPayment(tx, payment, user.userId, { alreadyPlaced: placedInline });
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

  /** Write one PAYMENT kassa row, enforcing never-below-zero on OUT (row-locked). */
  private async writeCashRow(
    tx: Prisma.TransactionClient,
    box: Cashbox,
    direction: CashDirection,
    amount: Prisma.Decimal,
    rate: Prisma.Decimal,
    paymentId: string,
    date: Date,
    note: string | null,
    userId: string,
  ) {
    if (direction === CashDirection.OUT) {
      // serialize concurrent OUTs; enforce the never-below-zero rule the manual-kassa
      // and expense paths already apply
      await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${box.id} FOR UPDATE`;
      const sums = await tx.cashTransaction.groupBy({
        by: ['direction'],
        where: { cashboxId: box.id },
        _sum: { amount: true },
      });
      const inSum = D(sums.find((s) => s.direction === CashDirection.IN)?._sum.amount ?? 0);
      const outSum = D(sums.find((s) => s.direction === CashDirection.OUT)?._sum.amount ?? 0);
      const balance = inSum.minus(outSum);
      if (balance.lessThan(amount)) {
        throw new BadRequestException(
          `Kassada mablag' yetarli emas: qoldiq ${balance.toFixed(2)}, so'ralgan ${amount.toFixed(2)}`,
        );
      }
    }
    await tx.cashTransaction.create({
      data: {
        cashboxId: box.id,
        date,
        direction,
        amount,
        rate,
        source: CashSource.PAYMENT,
        paymentId,
        note,
        createdById: userId,
      },
    });
  }

  // ─────────────────────────── allocations ───────────────────────────

  /**
   * POST /payments/:id/allocations — FACTORY_OUT cost finalization ONLY.
   *
   * CLIENT_IN is deliberately refused: client money settles itself oldest-order-first
   * (see common/auto-allocate.ts). Leaving a manual door open would let the two rules
   * disagree about the same payment, and the per-order "still owed" figures are derived
   * from these rows — a hand-edit would silently contradict the automatic pass.
   */
  async allocate(paymentId: string, dto: AllocateDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException("To'lov topilmadi");
      if (payment.voidedAt) throw new BadRequestException("Bekor qilingan to'lov taqsimlanmaydi");
      if (payment.kind === PaymentKind.CLIENT_IN) {
        throw new BadRequestException(
          "Mijoz to'lovi avtomatik taqsimlanadi (eng eski buyurtmadan) — qo'lda taqsimlanmaydi. " +
            "Tuzatish kerak bo'lsa to'lovni bekor qilib, qaytadan kiriting.",
        );
      }
      if (payment.kind !== PaymentKind.FACTORY_OUT) {
        throw new BadRequestException("Bu endpoint faqat zavodga to'lovni taqsimlaydi");
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
    // a bonus debt-offset (FACTORY_OUT, method=BONUS) settles the whole factory debt
    // through the wallet chain — it must not be re-allocated to an order (which would
    // finalize that order's cost at BANK price off non-cash money).
    if (payment.kind === PaymentKind.FACTORY_OUT && payment.method === PaymentMethod.BONUS) {
      throw new BadRequestException("Bonus hisobidan qilingan to'lov buyurtma tannarxiga taqsimlanmaydi");
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
      // the dealer→factory cost debt is only posted once the truck leaves the factory
      // (LOADING+). Paying the factory for an order still in NEW/CONFIRMED would finalize
      // a cost with no ORDER_COST base on the ledger — block it.
      if (
        payment.kind === PaymentKind.FACTORY_OUT &&
        (order.status === OrderStatus.NEW || order.status === OrderStatus.CONFIRMED)
      ) {
        throw new BadRequestException(
          `Buyurtma ${order.orderNo} hali zavoddan chiqmagan — zavod tannarxi yuklashda yoziladi, avval yuklashni boshlang`,
        );
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
            // effective (actual ?? planned) qty — actual loading adjusts the provisional
            // cost as an ORDER_COST delta, so the finalize threshold must track it too
            D(item.actualQuantityM3 ?? item.quantityM3)
              .times(item.costPricePerM3)
              .plus(D(item.palletPrice).times(item.actualPalletCount ?? item.palletCount)),
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

    // The finalize threshold is the cost AT THE PAYMENT METHOD of the latest allocation:
    // paying the (cheaper) CASH cost finalizes at cash; paying the BANK cost finalizes at
    // bank. Using the fixed bank provisional as the threshold would make a full CASH
    // payment (cash < bank) never reach the bar, so it could never finalize at cash.
    // finalTotal doubles as the finalized cost so the FINALIZE branch reuses it (no re-resolve).
    const finalKind = allocs.length
      ? (allocs[allocs.length - 1].priceKind ?? PriceKind.FACTORY_BANK)
      : PriceKind.FACTORY_BANK;
    const itemFinal: { id: string; finalPrice: Prisma.Decimal; cost: Prisma.Decimal }[] = [];
    let finalTotal = ZERO;
    for (const item of order.items) {
      // Same fallback ladder as order creation (buildOrderItems): requested kind → the
      // other factory kind → the price the order was created with. Throwing here would
      // make an order that the price book could not fully price UNPAYABLE — the whole
      // allocation transaction rolls back and costStatus is stuck on PROVISIONAL forever.
      const finalPrice =
        (await this.pricing.tryBookPrice(tx, item.productId, finalKind, order.date)) ??
        (await this.pricing.tryBookPrice(tx, item.productId, otherFactoryKind(finalKind), order.date)) ??
        D(item.costPricePerM3);
      const cost = round2(
        D(item.actualQuantityM3 ?? item.quantityM3)
          .times(finalPrice)
          .plus(D(item.palletPrice).times(item.actualPalletCount ?? item.palletCount)),
      );
      finalTotal = finalTotal.plus(cost);
      itemFinal.push({ id: item.id, finalPrice, cost });
    }

    // An empty allocation set is never "finalized" — route it into the un-finalize/settle
    // branch. Also guards the degenerate finalTotal=0 case (e.g. a zero factory price)
    // that would otherwise fall through and deref allocs[last].priceKind.
    if (allocs.length === 0 || covered.lessThan(finalTotal)) {
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
            D(item.actualQuantityM3 ?? item.quantityM3)
              .times(item.costPricePerM3)
              .plus(D(item.palletPrice).times(item.actualPalletCount ?? item.palletCount)),
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

    // FINALIZE at finalKind — reuse itemFinal/finalTotal computed above (price kind of
    // the LATEST active allocation, resolved at the order date).
    const newCostTotal = finalTotal;
    const itemUpdates = itemFinal;

    const delta = newCostTotal.minus(D(order.costTotal));
    if (!delta.isZero()) {
      await this.ledger.post(tx, {
        // business date = the order's date so the cost and its finalization land in
        // the same period; wall-clock stays on the immutable `at` audit timestamp.
        date: order.date,
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
        acc.plus(round2(D(i.actualQuantityM3 ?? i.quantityM3).times(D(i.finalCostPricePerM3 ?? i.costPricePerM3)))),
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

      // 2. reverse kassa rows (opposite direction, source REVERSAL, linked). Reversing
      //    an incoming payment posts an OUT — if that cash was already spent it would
      //    drive the box below zero; block unless the caller explicitly forces it.
      const cashRows = await tx.cashTransaction.findMany({
        where: { paymentId: id, reversalOfId: null, reversedBy: null },
      });
      for (const c of cashRows) {
        const reverseDir = c.direction === CashDirection.IN ? CashDirection.OUT : CashDirection.IN;
        if (reverseDir === CashDirection.OUT && !dto.force) {
          await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${c.cashboxId} FOR UPDATE`;
          const sums = await tx.cashTransaction.groupBy({
            by: ['direction'],
            where: { cashboxId: c.cashboxId },
            _sum: { amount: true },
          });
          const inSum = D(sums.find((s) => s.direction === CashDirection.IN)?._sum.amount ?? 0);
          const outSum = D(sums.find((s) => s.direction === CashDirection.OUT)?._sum.amount ?? 0);
          const balance = inSum.minus(outSum);
          if (balance.lessThan(D(c.amount))) {
            throw new BadRequestException(
              `Bekor qilish kassa qoldig'ini manfiy qiladi (qoldiq ${balance.toFixed(2)}, ` +
                `qaytariladigan ${D(c.amount).toFixed(2)}). Baribir davom etish uchun tasdiqlang.`,
            );
          }
        }
        await tx.cashTransaction.create({
          data: {
            cashboxId: c.cashboxId,
            date: new Date(),
            direction: reverseDir,
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
    // office filter; for AGENT users clientAgentScope below still restricts every
    // row to his own clients, so ?agentId= can never leak another agent's data
    if (q.agentId) where.agentId = q.agentId;
    if (q.factoryId) where.factoryId = q.factoryId;
    if (q.reconciled !== undefined) where.reconciled = q.reconciled;
    if (q.dateFrom || q.dateTo) {
      where.date = {
        ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}),
      };
    }
    // AGENT sees his own clients' money BOTH ways — overrides any kind filter. CLIENT_REFUND
    // must be included: a deduction booked against a client (e.g. «Шопир пули 5%») is netted
    // out of the agent's «Yigʼilgan toʼlovlar» KPI, so hiding the row would leave him unable
    // to reconcile his own card. (Creating a refund stays office-only — see create().)
    if (user.role === 'AGENT') {
      where.kind = { in: [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND] };
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
      // same two kinds the list exposes — his clients' money in and money handed back
      if (payment.kind !== PaymentKind.CLIENT_IN && payment.kind !== PaymentKind.CLIENT_REFUND) {
        throw new ForbiddenException("Bu ma'lumot sizning agentingizga tegishli emas");
      }
      assertOwnAgent(user, payment.client?.agentId);
    }
    return payment;
  }
}
