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
  FactoryBucket,
  LedgerAccount,
  LedgerSource,
  Order,
  OrderStatus,
  Payment,
  PaymentKind,
  PaymentMethod,
  PriceKind,
  Prisma,
  TransportMode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { PricingService } from '../common/pricing.service';
import { factoryCoverage } from '../common/factory-coverage';
import { autoAllocateClientPayment } from '../common/auto-allocate';
import { assertPositiveMoney, D, ONE, ONE_SOM, round2, round6, sum, ZERO } from '../common/money';
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
// Bekor qilishdagi pul rejimi buyurtma DTO'sida yashaydi (buyurtmaning amali, to'lovniki emas).
import { CancelMoneyMode } from '../orders/dto';

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
        // `status` — bekor qilingan buyurtmaning to'lovini peek'da ajratib ko'rsatish uchun
        select: { id: true, orderNo: true, status: true, costStatus: true, transportPaidStatus: true },
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
        // Bu to'lov endi balansga ta'sir qilmaydi — u faqat SHU reysning shofyori pulini
        // olganini qayd etadi. Buyurtmasiz yozilsa, hech qaysi reysga bog'lanmagan «osilgan»
        // yozuv bo'lib qoladi va transportPaidStatus'ni ham harakatga keltirmaydi.
        if (!dto.allocations?.length) {
          throw new BadRequestException("TRANSPORT_DIRECT to'lovi buyurtmaga bog'lanishi shart");
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

  /**
   * One posting per kind — TRANSPORT_DIRECT posts NOTHING.
   *
   * Under the owner's model the driver's slice is already carved out of the client's debt at
   * ORDER CREATE (LedgerSource.TRANSPORT_CLIENT_DIRECT). Crediting the client again here would
   * double-deduct (22M → 18M instead of 20M), and crediting VEHICLE would invent a phantom
   * advance to a driver the dealer never owed. The payment survives as a RECORD that the
   * driver got his cash, and it still drives transportPaidStatus via recomputeTransportStatus.
   */
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
        // Money sent to the factory becomes STANDING ADVANCE in its own channel — it
        // does NOT pay off any order until someone presses «avansdan yechish» (which
        // creates the allocation + its ADVANCE_DRAW pair). Owner rule, 2026-07-21.
        await this.ledger.post(tx, {
          ...base,
          account: LedgerAccount.FACTORY,
          factoryId: p.factoryId,
          factoryBucket: this.advanceBucketFor(p.method),
          amount: p.amount,
        });
        break;
      case PaymentKind.FACTORY_REFUND:
        await this.postFactoryRefund(tx, p, base);
        break;
      case PaymentKind.VEHICLE_OUT:
        await this.ledger.post(tx, { ...base, account: LedgerAccount.VEHICLE, vehicleId: p.vehicleId, amount: p.amount });
        break;
      case PaymentKind.TRANSPORT_DIRECT:
        break; // hech narsa yozilmaydi — carve-out buyurtma yaratilganda bo'lib bo'lingan
    }
  }

  /**
   * Which advance channel a factory payment lands in. The channel is what later
   * decides that portion's cost basis (naqd → FACTORY_CASH, o'tkazma → FACTORY_BANK),
   * so this classifier and priceKindFor below must always agree.
   * BONUS never becomes advance — a wallet offset settles debt directly.
   */
  private advanceBucketFor(method: PaymentMethod): FactoryBucket {
    if (method === PaymentMethod.BONUS) return FactoryBucket.PAYABLE;
    return FACTORY_CASH_METHODS.includes(method)
      ? FactoryBucket.ADVANCE_CASH
      : FactoryBucket.ADVANCE_BANK;
  }

  /** naqd channel ⇒ factory cash price, o'tkazma channel ⇒ factory bank price */
  private priceKindFor(method: PaymentMethod): PriceKind {
    return FACTORY_CASH_METHODS.includes(method) ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;
  }

  private bucketPriceKind(bucket: FactoryBucket): PriceKind {
    return bucket === FactoryBucket.ADVANCE_CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;
  }

  /**
   * A channel may never be spent below zero — an "advance" that went negative would be
   * money the dealer never parked. Locks the factory row first so two settlements racing
   * for the same last so'm cannot both pass.
   */
  private async assertChannelHas(
    tx: Prisma.TransactionClient,
    factoryId: string,
    bucket: FactoryBucket,
    amount: Prisma.Decimal,
  ) {
    await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${factoryId} FOR UPDATE`;
    const buckets = await this.ledger.factoryBuckets(factoryId, tx);
    const standing = round2(
      bucket === FactoryBucket.ADVANCE_CASH ? buckets.advanceCash : buckets.advanceBank,
    );
    const channel = bucket === FactoryBucket.ADVANCE_CASH ? 'naqd' : "o'tkazma";
    if (amount.minus(standing).greaterThan(ONE_SOM)) {
      throw new BadRequestException(
        `Zavoddagi ${channel} avansi ${standing.toFixed(2)} so'm — bundan ko'p sarflab bo'lmaydi ` +
          `(so'ralgan ${amount.toFixed(2)})`,
      );
    }
  }

  /**
   * WHERE a factory payment's money actually sits — read from its own ledger row, not
   * guessed from its method.
   *
   * The two can disagree. Imported settlements are deliberately booked straight to
   * PAYABLE (the workbook has no notion of a standing prepayment), yet they are ordinary
   * FACTORY_OUT/BANK payments. Deriving the bucket from the method alone would let a draw
   * debit ADVANCE_BANK for money that was never there — inventing advance out of thin air
   * and pushing the channel negative.
   */
  private async paymentMoneyBucket(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ): Promise<FactoryBucket | null> {
    const row = await tx.ledgerEntry.findFirst({
      where: {
        paymentId,
        account: LedgerAccount.FACTORY,
        source: LedgerSource.PAYMENT,
        reversalOfId: null,
        reversedBy: null,
      },
      select: { factoryBucket: true },
    });
    return row?.factoryBucket ?? null;
  }

  /**
   * Money coming BACK from the factory. It first eats the advance standing in the same
   * channel (that is the money being returned); anything beyond that is the factory
   * repaying an overpayment on goods, which belongs on PAYABLE. Splitting it here keeps
   * an advance bucket from going negative, which would read as nonsense on screen.
   */
  private async postFactoryRefund(
    tx: Prisma.TransactionClient,
    p: Payment,
    base: { date: Date; source: LedgerSource; paymentId: string; createdById: string },
  ) {
    const buckets = await this.ledger.factoryBuckets(p.factoryId!, tx);
    // Drain the channel the money came back THROUGH first, then the other one, then the
    // payable. The refund's own method says how the factory sent it, NOT where the dealer's
    // advance is parked — a bank advance returned in cash must still shrink the bank
    // channel, or the books grow a phantom advance on one side and a phantom debt on the
    // other. Ordering by the method first keeps the common case intuitive.
    const preferred = this.advanceBucketFor(p.method);
    const order: FactoryBucket[] =
      preferred === FactoryBucket.ADVANCE_CASH
        ? [FactoryBucket.ADVANCE_CASH, FactoryBucket.ADVANCE_BANK]
        : [FactoryBucket.ADVANCE_BANK, FactoryBucket.ADVANCE_CASH];

    let left = D(p.amount);
    for (const bucket of order) {
      if (left.lessThanOrEqualTo(0)) break;
      const standing =
        bucket === FactoryBucket.ADVANCE_CASH ? buckets.advanceCash : buckets.advanceBank;
      const take = Prisma.Decimal.max(ZERO, Prisma.Decimal.min(standing, left));
      if (take.lessThanOrEqualTo(0)) continue;
      await this.ledger.post(tx, {
        ...base,
        account: LedgerAccount.FACTORY,
        factoryId: p.factoryId,
        factoryBucket: bucket,
        amount: take.negated(),
      });
      left = left.minus(take);
    }
    // Anything past the parked advance is the factory repaying an overpayment on goods.
    if (left.greaterThan(0)) {
      await this.ledger.post(tx, {
        ...base,
        account: LedgerAccount.FACTORY,
        factoryId: p.factoryId,
        factoryBucket: FactoryBucket.PAYABLE,
        amount: left.negated(),
      });
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
   * POST /payments/:id/allocations/:allocationId/void — undo ONE settlement.
   *
   * Previously the only way back was voiding the whole payment, which is wrong when a
   * payment was spread over several orders and only one of them was a mistake. The
   * money returns to the advance channel it came from and the order's cost re-blends
   * without that slice; the row itself is kept (voidedAt) so history stays intact.
   */
  async voidAllocation(
    paymentId: string,
    allocationId: string,
    dto: VoidPaymentDto,
    user: RequestUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
      const allocation = await tx.paymentAllocation.findUnique({
        where: { id: allocationId },
        include: { order: { select: { orderNo: true } } },
      });
      if (!allocation || allocation.paymentId !== paymentId) {
        throw new NotFoundException('Taqsimot topilmadi');
      }
      if (allocation.voidedAt) throw new BadRequestException('Taqsimot allaqachon bekor qilingan');

      // FACTORY_OUT only. CLIENT_IN allocations are owned by the FIFO engine (voiding one
      // by hand would leave the order reading unpaid while the client ledger says settled,
      // and the next auto-pass would silently undo it); VEHICLE_OUT / TRANSPORT_DIRECT
      // allocations are what recomputeTransportStatus and the leaving-LOADING guard read,
      // so removing one here would invent a driver advance. Those are corrected by voiding
      // the whole payment, exactly as before.
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.kind !== PaymentKind.FACTORY_OUT) {
        throw new BadRequestException(
          "Faqat zavodga to'lov taqsimoti alohida bekor qilinadi — boshqasini to'lovning o'zini bekor qilib tuzating",
        );
      }

      const note = `Taqsimot bekor qilindi: ${dto.reason}`;
      // give the money back to its advance channel (both halves of the draw pair)
      await this.ledger.reverseAllocationDraw(tx, allocation.id, note, user.userId);

      await tx.paymentAllocation.update({
        where: { id: allocation.id },
        data: { voidedAt: new Date(), voidReason: dto.reason, voidedById: user.userId },
      });

      await this.recomputeOrderCost(tx, allocation.orderId, user.userId);

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.VOID,
        entity: 'PaymentAllocation',
        entityId: allocation.id,
        before: plain(allocation),
        after: plain({ voidReason: dto.reason, voidedById: user.userId }),
      });

      return tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: detailInclude });
    }, TX_OPTS);
  }

  /**
   * MONEY side of order cancel (egasi qoidasi, 2026-07-22 kechqurun — SHU KUNGI ikkala
   * oldingi qoidani ham almashtiradi).
   *
   * Buyurtmaning O'Z ledgeri (savdo, transport carve-out, tannarx, avansdan yechishlar)
   * chaqiruvchi tomonidan allaqachon teskari yozilgan. Bu metod PUL harakatini yakunlaydi.
   * IKKALA rejimda ham kassa buyurtmadan OLDINGI holatiga qaytadi — mijozning puli ham,
   * zavodga to'langani ham kassada qolmaydi. Farq faqat mijozda nima qolishida:
   *
   *   • REFUND   — mijoz BIZGA to'lagani unga NAQD qaytariladi (CLIENT_REFUND, kassadan
   *                chiqim), shofyorga bergani esa balansida KREDIT bo'lib qoladi (diller
   *                transportni o'z zimmasiga oladi). Yakuniy mijoz balansi = −(shofyorga
   *                bergani). Ya'ni to'lagan har bir so'm qaytadi: qismi naqd, qismi kredit.
   *   • VOID_ALL — hech qanday iz qolmaydi: mijozning to'lovi ham, shofyorga bergani ham
   *                bekor qilinadi, balansi 0 ga tushadi. Buyurtma umuman berilmagandek.
   *
   * TARTIB MUHIM: zavod puli avval kassaga QAYTARILADI, keyin mijozga chiqim yoziladi —
   * aks holda puli zavodga ketgan buyurtmada kassa vaqtincha bo'shab, «Kassada mablag'
   * yetarli emas» xatosi bekordan-bekorga chiqib qolardi.
   *
   * Taqsimotlar VOID qilinishidan OLDIN ishlaydi (ularni o'qib summa oladi) va bir nechta
   * buyurtmaga ulashilgan to'lovda faqat SHU buyurtmaning ulushiga tegadi.
   */
  async refundOrderOnCancel(
    tx: Prisma.TransactionClient,
    orderId: string,
    userId: string,
    mode: CancelMoneyMode = CancelMoneyMode.REFUND,
  ) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { date: true, clientId: true },
    });

    const sumByPayment = (
      allocs: { paymentId: string; amount: Prisma.Decimal; payment: Payment }[],
    ) => {
      const m = new Map<string, { payment: Payment; amount: Prisma.Decimal }>();
      for (const a of allocs) {
        const cur = m.get(a.paymentId);
        if (cur) cur.amount = cur.amount.plus(a.amount);
        else m.set(a.paymentId, { payment: a.payment, amount: D(a.amount) });
      }
      return [...m.values()];
    };

    /** To'lov BUTUNLAY shu buyurtmagami (ulashilgan bo'lsa — to'liq bekor qilib bo'lmaydi). */
    const belongsSolelyToThisOrder = (allocations: { orderId: string; amount: Prisma.Decimal }[]) => {
      const activeTotal = round2(sum(allocations.map((a) => a.amount)));
      const toThisOrder = round2(
        sum(allocations.filter((a) => a.orderId === orderId).map((a) => a.amount)),
      );
      return activeTotal.minus(toThisOrder).abs().lessThanOrEqualTo(ONE_SOM);
    };

    // ── 1) ZAVOD — to'langanini kassaga QAYTARAMIZ (kirim). Mijozga chiqimdan OLDIN. ──
    const factoryAllocs = await tx.paymentAllocation.findMany({
      where: { orderId, voidedAt: null, payment: { kind: PaymentKind.FACTORY_OUT, voidedAt: null } },
      include: { payment: true },
    });
    for (const { payment, amount } of sumByPayment(factoryAllocs)) {
      const refund = round2(amount);
      if (refund.lessThanOrEqualTo(0) || payment.method === PaymentMethod.BONUS) continue;
      await this.postCancelRefund(tx, {
        kind: PaymentKind.FACTORY_REFUND,
        factoryId: payment.factoryId,
        method: payment.method,
        cashboxId: payment.cashboxId,
        amount: refund,
        date: new Date(),
        note: "Buyurtma bekor qilindi — zavod to'lovi qaytarildi",
        userId,
      });
    }

    // ── 2) MIJOZ BIZGA to'lagani — kassadan CHIQADI (ikkala rejimda ham) ──
    // REFUND'da bu «mijozga qaytardik» degan hujjatli CLIENT_REFUND; VOID_ALL'da esa
    // to'lovning o'zi butunlay teskari yoziladi va bekor qilinadi (iz qolmaydi).
    const clientAllocs = await tx.paymentAllocation.findMany({
      where: { orderId, voidedAt: null, payment: { kind: PaymentKind.CLIENT_IN, voidedAt: null } },
      include: { payment: { include: { allocations: { where: { voidedAt: null } } } } },
    });
    const handledClient = new Set<string>();
    for (const alloc of clientAllocs) {
      const payment = alloc.payment;
      if (handledClient.has(payment.id)) continue;
      handledClient.add(payment.id);
      const portion = round2(
        sum(payment.allocations.filter((a) => a.orderId === orderId).map((a) => a.amount)),
      );
      if (portion.lessThanOrEqualTo(0)) continue;

      if (mode === CancelMoneyMode.VOID_ALL && belongsSolelyToThisOrder(payment.allocations)) {
        // butunlay shu buyurtmaniki ⇒ to'lovni butunlay o'chiramiz (kassa + ledger + void)
        await this.reversePaymentInTx(
          tx,
          payment.id,
          "Buyurtma bekor qilindi — to'lov butunlay bekor qilindi",
          userId,
        );
      } else {
        // ulashilgan to'lov (yoki REFUND rejimi) ⇒ faqat SHU buyurtmaning ulushi qaytariladi
        await this.postCancelRefund(tx, {
          kind: PaymentKind.CLIENT_REFUND,
          clientId: payment.clientId,
          method: payment.method,
          cashboxId: payment.cashboxId,
          amount: portion,
          date: new Date(),
          note: "Buyurtma bekor qilindi — mijozning to'lagan puli qaytarildi",
          userId,
        });
      }
    }

    // ── 3) MIJOZ SHOFYORGA bergan puli (TRANSPORT_DIRECT) ──
    // Bu pul bizning kassamizdan o'tmagan — u to'g'ridan-to'g'ri haydovchiga ketgan.
    //   REFUND   ⇒ mijoz balansiga KREDIT (diller transportni o'z zimmasiga oladi).
    //   VOID_ALL ⇒ hujjatning o'zi bekor qilinadi, kredit ham yozilmaydi (mijoz balansi 0).
    const transportAllocs = await tx.paymentAllocation.findMany({
      where: { orderId, voidedAt: null, payment: { kind: PaymentKind.TRANSPORT_DIRECT, voidedAt: null } },
      include: { payment: { include: { allocations: { where: { voidedAt: null } } } } },
    });
    if (mode === CancelMoneyMode.REFUND) {
      const transportPaid = round2(sum(transportAllocs.map((a) => a.amount)));
      if (transportPaid.greaterThan(0) && order.clientId) {
        await this.ledger.post(tx, {
          date: order.date,
          account: LedgerAccount.CLIENT,
          source: LedgerSource.ORDER_CANCEL,
          clientId: order.clientId,
          amount: transportPaid.negated(), // <0 ⇒ shu pulni mijozga qarzdormiz
          orderId,
          note: "Buyurtma bekor qilindi — mijoz shofyorga bergan transport puli balansiga qaytarildi",
          createdById: userId,
        });
      }
    } else {
      const voidedTransport = new Set<string>();
      for (const alloc of transportAllocs) {
        const payment = alloc.payment;
        if (voidedTransport.has(payment.id)) continue;
        voidedTransport.add(payment.id);
        if (!belongsSolelyToThisOrder(payment.allocations)) continue;
        // TRANSPORT_DIRECT na kassaga, na ledgerga yozadi — bekor qilish = hujjatni yopish
        await this.reversePaymentInTx(
          tx,
          payment.id,
          "Buyurtma bekor qilindi — shofyorga to'lov hujjati bekor qilindi",
          userId,
        );
      }
    }

    // ── 4) SHOFYOR (VEHICLE_OUT — dillerning o'zi to'lagani) ──
    // `reverseAllForOrder` TRANSPORT_COST oyog'ini allaqachon teskari yozgan; to'lov oyog'i
    // yolg'iz qolsa fantom «shofyor avansi» bo'lib ko'rinadi. Faqat BUTUNLAY shu buyurtmaga
    // tegishli bo'lsa to'liq teskari yoziladi (1 reys = 1 to'lov).
    const vehicleAllocs = await tx.paymentAllocation.findMany({
      where: { orderId, voidedAt: null, payment: { kind: PaymentKind.VEHICLE_OUT, voidedAt: null } },
      include: { payment: { include: { allocations: { where: { voidedAt: null } } } } },
    });
    const reclaimed = new Set<string>();
    for (const alloc of vehicleAllocs) {
      const payment = alloc.payment;
      if (reclaimed.has(payment.id)) continue;
      reclaimed.add(payment.id);
      if (!belongsSolelyToThisOrder(payment.allocations)) continue;
      await this.reversePaymentInTx(
        tx,
        payment.id,
        "Buyurtma bekor qilindi — shofyor to'lovi qaytarildi",
        userId,
      );
    }
  }

  /**
   * Bitta to'lovni BUTUNLAY orqaga qaytarish (ledger + kassa qatorlari) va uni bekor
   * qilish — bekor qilish tranzaksiyasi ichida. Har qanday `kind` uchun ishlaydi:
   * shofyorga to'lov, mijozning to'lovi (VOID_ALL rejimi), transport hujjati.
   * Kassa qatori bo'lmagan to'lovda (TRANSPORT_DIRECT) faqat void bo'ladi.
   */
  private async reversePaymentInTx(
    tx: Prisma.TransactionClient,
    paymentId: string,
    note: string,
    userId: string,
  ) {
    const entries = await tx.ledgerEntry.findMany({
      where: { paymentId, reversalOfId: null, reversedBy: null },
    });
    for (const e of entries) await this.ledger.reverse(tx, e.id, note, userId);
    const cashRows = await tx.cashTransaction.findMany({
      where: { paymentId, reversalOfId: null, reversedBy: null },
    });
    for (const c of cashRows) {
      const dir = c.direction === CashDirection.IN ? CashDirection.OUT : CashDirection.IN;
      // Kirim qatorini teskari yozish = kassadan CHIQIM (mijozning to'lovini butunlay bekor
      // qilganda shunday bo'ladi). Kassa hech qachon manfiyga tushmaydi degan qoida shu
      // yo'lda ham amal qilishi kerak — aks holda pul allaqachon sarflangan bo'lsa qoldiq
      // jimgina manfiyga tushib ketardi. Shofyor/zavod to'lovini bekor qilish esa KIRIM,
      // shuning uchun bu tekshiruv ularga umuman tegmaydi.
      if (dir === CashDirection.OUT) {
        await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${c.cashboxId} FOR UPDATE`;
        const sums = await tx.cashTransaction.groupBy({
          by: ['direction'],
          where: { cashboxId: c.cashboxId },
          _sum: { amount: true },
        });
        const inSum = D(sums.find((x) => x.direction === CashDirection.IN)?._sum.amount ?? 0);
        const outSum = D(sums.find((x) => x.direction === CashDirection.OUT)?._sum.amount ?? 0);
        const balance = inSum.minus(outSum);
        if (balance.lessThan(D(c.amount))) {
          const box = await tx.cashbox.findUnique({ where: { id: c.cashboxId }, select: { name: true } });
          throw new BadRequestException(
            `«${box?.name ?? 'Kassa'}» kassasida mablag' yetarli emas: qoldiq ${balance.toFixed(2)}, ` +
              `bekor qilish uchun ${D(c.amount).toFixed(2)} kerak. Bu pul allaqachon sarflangan — ` +
              `avval kassaga mablag' kiriting yoki o'sha chiqimni bekor qiling.`,
          );
        }
      }
      await tx.cashTransaction.create({
        data: {
          cashboxId: c.cashboxId,
          date: new Date(),
          direction: dir,
          amount: c.amount,
          rate: c.rate,
          source: CashSource.REVERSAL,
          paymentId,
          note,
          createdById: userId,
          reversalOfId: c.id,
        },
      });
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { voidedAt: new Date(), voidReason: note, voidedById: userId },
    });
  }

  /** One refund posting (Payment + ledger + kassa) inside the cancel transaction. */
  private async postCancelRefund(
    tx: Prisma.TransactionClient,
    p: {
      kind: PaymentKind;
      clientId?: string | null;
      factoryId?: string | null;
      method: PaymentMethod;
      cashboxId: string | null;
      amount: Prisma.Decimal;
      date: Date;
      note: string;
      userId: string;
    },
  ) {
    if (!p.cashboxId) {
      throw new BadRequestException(
        "Bekor qilishda qaytarish uchun kassa aniqlanmadi (to'lov naqd kassaga tushmagan) — qo'lda qaytaring",
      );
    }
    const box = await tx.cashbox.findUnique({ where: { id: p.cashboxId } });
    if (!box) throw new BadRequestException('Qaytarish kassasi topilmadi');

    const payment = await tx.payment.create({
      data: {
        date: p.date,
        kind: p.kind,
        method: p.method,
        amount: p.amount,
        clientId: p.clientId ?? null,
        factoryId: p.factoryId ?? null,
        cashboxId: box.id,
        note: p.note,
        createdById: p.userId,
      },
    });
    // CLIENT_REFUND ⇒ client ledger +amount (advance cleared); FACTORY_REFUND ⇒ factory
    // advance drained — the same postLedger the normal refund flow uses.
    await this.postLedger(tx, payment, p.userId);
    const direction = CASH_IN_KINDS.includes(p.kind) ? CashDirection.IN : CashDirection.OUT;
    // OUT enforces never-below-zero — a client refund that the box cannot cover fails here
    // with a clear message rather than driving the kassa negative.
    await this.writeCashRow(tx, box, direction, round2(p.amount), ZERO, payment.id, p.date, p.note, p.userId);
    return payment;
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

    // FACTORY_OUT allocations carry the cost basis of the CHANNEL the money came from:
    // naqd money buys at the factory's naqd price, o'tkazma money at its bank price.
    // One payment has one method, hence one basis — a cash/bank MIX on a single order
    // therefore always arrives as two separate payments, which is why the
    // «one active allocation per (payment, order)» index needs no relaxing.
    const isFactory = payment.kind === PaymentKind.FACTORY_OUT;
    const priceKind = isFactory ? this.priceKindFor(payment.method) : null;
    const drawBucket = isFactory ? this.advanceBucketFor(payment.method) : null;

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

      // «o'sha buyurtma pulidan ko'p yechilmasligi kerak» — a settlement may never buy
      // more of the order than is left. The ceiling is expressed in the money of THIS
      // channel, because the same order costs a different amount at each basis.
      if (isFactory) {
        const cov = await this.factoryCoverage(tx, order.id);
        const room = cov.remaining[priceKind!];
        if (amounts[i].minus(room).greaterThan(ONE_SOM)) {
          throw new BadRequestException(
            `Buyurtma ${order.orderNo} uchun bu narxda ko'pi bilan ${room.toFixed(2)} so'm yopiladi ` +
              `(so'ralgan ${amounts[i].toFixed(2)}). Ortiqcha pulni boshqa buyurtmaga taqsimlang.`,
          );
        }
      }

      let allocation;
      try {
        allocation = await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            orderId: order.id,
            amount: amounts[i],
            priceKind,
            fromAdvance: isFactory,
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

      // The factory money was booked as standing advance when the payment was created;
      // attaching it to an order is the DRAW. The zero-sum pair moves it out of the
      // channel bucket and onto this order's debt, leaving a reversible trail.
      //
      // Read WHERE the money is instead of assuming the method decided it: an imported
      // settlement is a FACTORY_OUT/BANK payment whose money went straight to PAYABLE, so
      // drawing it would debit an advance channel that never received it. When the money
      // is already on PAYABLE the allocation alone is the whole story — no draw is due.
      if (isFactory) {
        const moneyBucket = await this.paymentMoneyBucket(tx, payment.id);
        if (moneyBucket && moneyBucket !== FactoryBucket.PAYABLE) {
          await this.assertChannelHas(tx, payment.factoryId!, moneyBucket, amounts[i]);
          await this.ledger.postAdvanceDraw(tx, {
            date: payment.date,
            factoryId: payment.factoryId!,
            orderId: order.id,
            allocationId: allocation.id,
            paymentId: payment.id,
            bucket: moneyBucket,
            amount: amounts[i],
            note: `Avansdan yechildi — ${order.orderNo}`,
            createdById: userId,
          });
        }
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
        // TRANSPORT_DIRECT tekshiruvining KO'ZGUSI. CLIENT_PAYS_DRIVER'da shofyorga
        // mijoz o'zi to'laydi, shuning uchun postOrderSupplyLedger bu buyurtmaga VEHICLE
        // qarzini UMUMAN yozmaydi. Diller ustidan yana to'lasa, moshina hisobida qarzsiz
        // to'lov qoladi — ya'ni yo'qdan paydo bo'lgan avans. Bunday to'lov TRANSPORT_DIRECT
        // sifatida kiritilishi kerak.
        if (order.transportMode === TransportMode.CLIENT_PAYS_DRIVER) {
          throw new BadRequestException(
            `Bu buyurtmada shofyorga mijoz to'laydi — diller to'lovi (VEHICLE_OUT) taqsimlanmaydi (${order.orderNo}). «Mijoz shofyorga to'ladi» to'lovini kiriting`,
          );
        }
        break;
      case PaymentKind.TRANSPORT_DIRECT:
        if (order.clientId !== payment.clientId) {
          throw new BadRequestException(`Buyurtma ${order.orderNo} boshqa mijozga tegishli`);
        }
        if (order.vehicleId && order.vehicleId !== payment.vehicleId) {
          throw new BadRequestException(`Buyurtma ${order.orderNo} bu mashinaga tegishli emas`);
        }
        // Faqat CLIENT_PAYS_DRIVER'da mijoz shofyorga o'zi to'laydi. DEALER_ABSORBED'da
        // shofyorga dillerning o'zi to'laydi — u yerda VEHICLE_OUT ishlatiladi, aks holda
        // buyurtmaning transporti to'langan bo'lib ko'rinadi-yu, diller qarzi qolib ketadi.
        if (order.transportMode !== TransportMode.CLIENT_PAYS_DRIVER) {
          throw new BadRequestException(
            `TRANSPORT_DIRECT faqat «Shofyorga mijoz to'laydi» rejimidagi buyurtmaga kiritiladi (${order.orderNo})`,
          );
        }
        break;
      default:
        throw new BadRequestException(`${payment.kind} to'lovi buyurtmalarga taqsimlanmaydi`);
    }
  }

  // ─────────────────────────── cost recompute ───────────────────────────

  /**
   * Blended cost engine (owner rule, 2026-07-21 — supersedes «latest allocation wins»).
   *
   * An order's factory cost is not one number until it is paid for, because naqd and
   * o'tkazma buy the same goods at different prices. Each settlement buys the share of
   * the order its money covers AT ITS OWN CHANNEL'S PRICE, and whatever is still open
   * stays at the provisional price the ORDER_COST row was posted at:
   *
   *   cost = Σ over settlements (share × goods at that settlement's price)
   *          + remaining share × goods at the provisional price
   *
   *   nothing settled            → PROVISIONAL
   *   partly settled             → PARTIAL  (and the cost already moves — that is the point)
   *   under 1 so'm left to buy   → FINAL
   *
   * Every move posts one append-only COST_ADJUSTMENT delta, so voiding a settlement is
   * just the opposite delta and needs no special un-finalize path.
   */
  async recomputeOrderCost(tx: Prisma.TransactionClient, orderId: string, userId: string | null) {
    // serialize concurrent recomputes on this order — the COST_ADJUSTMENT posting
    // below happens before any row write would otherwise block, so without this
    // lock two allocations finalizing together double-post the delta
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.status === OrderStatus.CANCELLED) return;

    const cov = await this.factoryCoverage(tx, orderId);

    // Blend: every settlement buys a SLICE of the order at its own channel's price, and
    // whatever is still unsettled stays at the provisional price the ledger was posted
    // at. Fully cash-settled ⇒ cost = the cash total; fully bank ⇒ the bank total;
    // half and half ⇒ exactly half of each. With one full settlement this reduces to
    // the old «reprice everything at that kind», so historical orders keep their value.
    const itemUpdates: { id: string; finalPrice: Prisma.Decimal | null; cost: Prisma.Decimal }[] = [];
    let newCostTotal = ZERO;
    for (const p of cov.items) {
      let cost = ZERO;
      for (const a of cov.allocations) {
        const share = cov.shareOf(a);
        if (share.isZero()) continue;
        const price = a.priceKind === PriceKind.FACTORY_CASH ? p.cash : p.bank;
        cost = cost.plus(p.qty.times(price).times(share));
      }
      cost = round2(cost.plus(p.qty.times(p.provisional).times(cov.uncoveredShare)));
      newCostTotal = newCostTotal.plus(cost);
      itemUpdates.push({
        id: p.id,
        // a blended per-m³ price only exists once something has actually been settled
        finalPrice: cov.fraction.isZero() || p.qty.isZero() ? null : round6(cost.div(p.qty)),
        cost,
      });
    }

    const status = cov.fraction.lessThanOrEqualTo(0)
      ? CostStatus.PROVISIONAL
      : cov.settled
        ? CostStatus.FINAL
        : CostStatus.PARTIAL;

    // ONE append-only delta drives every direction — settling, re-settling and voiding
    // all go through here, so an un-draw simply posts the opposite delta instead of
    // needing a bespoke un-finalize branch. Guarded on the cost actually being on the
    // books: before LOADING there is no ORDER_COST row to adjust.
    const delta = newCostTotal.minus(D(order.costTotal));
    if (!delta.isZero() && (await this.orderCostPosted(tx, orderId))) {
      await this.ledger.post(tx, {
        // business date = the order's date so the cost and its adjustment land in
        // the same period; wall-clock stays on the immutable `at` audit timestamp.
        date: order.date,
        account: LedgerAccount.FACTORY,
        source: LedgerSource.COST_ADJUSTMENT,
        factoryBucket: FactoryBucket.PAYABLE,
        amount: delta.negated(), // cost grew ⇒ we owe the factory more (negative posting)
        factoryId: order.factoryId,
        orderId: order.id,
        note: `Tannarx aniqlandi (${cov.describeMix()})`,
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
      data: {
        costTotal: newCostTotal,
        costStatus: status,
        costFinalizedAt: status === CostStatus.FINAL ? (order.costFinalizedAt ?? new Date()) : null,
      },
    });

    // a completed order's PERCENT bonus was accrued on the then-best-known cost —
    // repricing the purchase reprices the bonus, as a traceable ADJUSTMENT
    await this.adjustBonusForOrder(tx, orderId, userId);

    if (order.costStatus !== status || !delta.isZero()) {
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.COST_FINALIZE,
        entity: 'Order',
        entityId: order.id,
        before: plain({ costTotal: order.costTotal, costStatus: order.costStatus }),
        after: plain({ costTotal: newCostTotal, costStatus: status, mix: cov.describeMix() }),
      });
    }
  }

  /** Has the dealer→factory debt actually been posted yet (LOADING+)? */
  private async orderCostPosted(tx: Prisma.TransactionClient, orderId: string) {
    const row = await tx.ledgerEntry.findFirst({
      where: { orderId, source: LedgerSource.ORDER_COST, reversalOfId: null, reversedBy: null },
      select: { id: true },
    });
    return !!row;
  }

  /** see common/factory-coverage.ts — shared with the order screen so both agree */
  factoryCoverage(tx: Prisma.TransactionClient, orderId: string) {
    return factoryCoverage(tx, this.pricing, orderId);
  }

  /**
   * Spends standing factory advance from ONE channel onto ONE order, oldest money first.
   *
   * The caller (orders.drawFactoryAdvance) has already checked the two ceilings — what
   * the channel holds and what the order still needs. Here we only decide WHICH stored
   * payments the money comes out of, so the advance ages FIFO instead of leaving old
   * prepayments stranded forever.
   */
  async drawFromAdvance(
    tx: Prisma.TransactionClient,
    p: {
      factoryId: string;
      orderId: string;
      bucket: FactoryBucket;
      amount: Prisma.Decimal;
      date: Date;
      note: string | null;
      userId: string;
    },
  ) {
    const priceKind = this.bucketPriceKind(p.bucket);

    // Source ONLY from payments whose money is genuinely standing in this channel. The
    // filter is on the payment's own FACTORY ledger row, not on its method, for two
    // reasons: imported settlements are FACTORY_OUT/BANK yet were booked to PAYABLE (they
    // would otherwise be "drawn" from an advance that never existed), and retired methods
    // (CARD/USD) still hold real historical advance that a method whitelist would strand
    // as permanently un-drawable.
    const candidates = await tx.payment.findMany({
      where: {
        factoryId: p.factoryId,
        kind: PaymentKind.FACTORY_OUT,
        voidedAt: null,
        ledgerEntries: {
          some: {
            account: LedgerAccount.FACTORY,
            source: LedgerSource.PAYMENT,
            factoryBucket: p.bucket,
            reversalOfId: null,
            reversedBy: null,
          },
        },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { allocations: { where: { voidedAt: null } } },
    });

    let left = p.amount;
    const used: { paymentId: string; amount: Prisma.Decimal }[] = [];
    for (const pay of candidates) {
      if (left.lessThanOrEqualTo(0)) break;
      const spent = sum(pay.allocations.map((a) => a.amount));
      const free = round2(D(pay.amount).minus(spent));
      if (free.lessThanOrEqualTo(0)) continue;

      const take = round2(Prisma.Decimal.min(free, left));
      const existing = pay.allocations.find((a) => a.orderId === p.orderId);

      // One ACTIVE allocation per (payment, order) is a partial unique index, so a second
      // draw from the same payment TOPS UP the existing row rather than inserting.
      const allocation = existing
        ? await tx.paymentAllocation.update({
            where: { id: existing.id },
            data: { amount: round2(D(existing.amount).plus(take)), priceKind, fromAdvance: true },
          })
        : await tx.paymentAllocation.create({
            data: {
              paymentId: pay.id,
              orderId: p.orderId,
              amount: take,
              priceKind,
              fromAdvance: true,
              createdById: p.userId,
            },
          });

      await this.ledger.postAdvanceDraw(tx, {
        date: p.date,
        factoryId: p.factoryId,
        orderId: p.orderId,
        allocationId: allocation.id,
        paymentId: pay.id,
        bucket: p.bucket,
        amount: take,
        note: p.note,
        createdById: p.userId,
      });

      used.push({ paymentId: pay.id, amount: take });
      left = round2(left.minus(take));
    }

    if (left.greaterThan(ONE_SOM)) {
      // the bucket balance said the money was there but no un-spent payment carries it —
      // that means advance arrived through a path with no Payment row (e.g. an import
      // adjustment). Refuse rather than silently drawing less than asked.
      throw new BadRequestException(
        `Avansning ${left.toFixed(2)} so'mi aniq to'lovga bog'lanmagan — uni buyurtmaga biriktirib bo'lmadi`,
      );
    }

    await this.recomputeOrderCost(tx, p.orderId, p.userId);
    return used;
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

    // «Bekor qilingan buyurtma» belgisi (egasi talabi): buyurtma bekor qilinganda uning
    // taqsimotlari VOID bo'ladi, shuning uchun `listInclude.allocations` (faqat tirik
    // taqsimotlar) bunday to'lovni BO'SH ko'rsatadi — ro'yxatda u oddiy, taqsimlanmagan
    // to'lovdek o'qilardi. Shu sabab bekor qilingan buyurtmalarning raqamlari ALOHIDA
    // o'qiladi (voided taqsimotlar ham hisobga olinadi) va qatorga qo'shib beriladi.
    const ids = items.map((p) => p.id);
    const cancelledAllocs = ids.length
      ? await this.prisma.paymentAllocation.findMany({
          where: { paymentId: { in: ids }, order: { status: OrderStatus.CANCELLED } },
          select: { paymentId: true, order: { select: { orderNo: true } } },
        })
      : [];
    const cancelledByPayment = new Map<string, Set<string>>();
    for (const a of cancelledAllocs) {
      const set = cancelledByPayment.get(a.paymentId) ?? new Set<string>();
      set.add(a.order.orderNo);
      cancelledByPayment.set(a.paymentId, set);
    }

    const rows = items.map((p) => ({
      ...p,
      /** shu to'lov tegishli bo'lgan BEKOR QILINGAN buyurtmalar raqamlari (bo'sh = yo'q) */
      cancelledOrderNos: [...(cancelledByPayment.get(p.id) ?? [])].sort(),
    }));
    return paged(rows, total, page, pageSize);
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
