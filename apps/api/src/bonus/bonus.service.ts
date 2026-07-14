import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  BonusProgramKind,
  BonusTransactionType,
  CashDirection,
  CashSource,
  Currency,
  LedgerAccount,
  LedgerSource,
  PaymentKind,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { assertPositiveMoney, D, round2, round3, sum, ZERO } from '../common/money';
import { pageArgs, Paged, paged } from '../common/pagination';
import { BonusOffsetDto, BonusTxQueryDto, BonusWithdrawDto } from './dto';

/**
 * Factory bonus wallet. Programs are versioned per factory (never retroactive):
 * the program in force at order COMPLETION governs that order's accrual forever.
 * Wallet balance = Σ BonusTransaction.amount (signed). Spends: cash WITHDRAWAL
 * through kassa, or DEBT_OFFSET via the canonical chain
 * Payment(FACTORY_OUT, method=BONUS, no cashbox) → LedgerEntry(BONUS_OFFSET) → BonusTransaction.
 */
@Injectable()
export class BonusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Latest program with effectiveFrom ≤ at; null when none exists or it is kind NONE. */
  async programInForce(tx: Prisma.TransactionClient, factoryId: string, at: Date) {
    const program = await tx.bonusProgram.findFirst({
      where: { factoryId, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!program || program.kind === BonusProgramKind.NONE) return null;
    return program;
  }

  // ── order hooks (called by OrdersService inside ITS transaction) ──

  /** Accrue the completed order's bonus. Idempotent: skips silently if an un-reversed ACCRUAL exists. */
  async accrueForOrder(tx: Prisma.TransactionClient, orderId: string, createdById?: string | null) {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');

    const existing = await tx.bonusTransaction.findFirst({
      where: { orderId, type: BonusTransactionType.ACCRUAL, reversedBy: null },
    });
    if (existing) return null;

    const program = await this.programInForce(tx, order.factoryId, order.completedAt ?? new Date());
    if (!program) return null;

    let amount: Prisma.Decimal;
    let baseAmount: Prisma.Decimal | null = null;
    let baseM3: Prisma.Decimal | null = null;

    if (program.kind === BonusProgramKind.PER_M3) {
      // effective (actual ?? planned) qty — actual loading (entered BEFORE completion)
      // rescales the order, so the bonus must accrue on the real delivered m³.
      baseM3 = round3(sum(order.items.map((i) => i.actualQuantityM3 ?? i.quantityM3)));
      amount = round2(D(program.ratePerM3 ?? 0).times(baseM3));
    } else if (program.kind === BonusProgramKind.PERCENT) {
      // Purchase-amount base is BLOCKS ONLY — pallet money is never part of it.
      // Best-known cost: the finalized price when the allocation engine has fixed
      // it, else the provisional one (later finalization posts a bonus ADJUSTMENT).
      // Effective (actual ?? planned) qty — matches adjustBonusForOrder's blocksBase.
      baseAmount = sum(
        order.items.map((i) =>
          round2(D(i.actualQuantityM3 ?? i.quantityM3).times(D(i.finalCostPricePerM3 ?? i.costPricePerM3))),
        ),
      );
      amount = round2(baseAmount.times(D(program.percent ?? 0)).dividedBy(100));
    } else {
      return null;
    }
    if (amount.lessThanOrEqualTo(0)) return null;

    return tx.bonusTransaction.create({
      data: {
        type: BonusTransactionType.ACCRUAL,
        amount,
        factoryId: order.factoryId,
        orderId,
        programId: program.id,
        baseAmount,
        baseM3,
        createdById: createdById ?? null,
      },
    });
  }

  /**
   * Order un-completed/cancelled: compensating REVERSAL of every un-reversed bonus
   * row attached to the order — the ACCRUAL *and* any PERCENT cost-finalization
   * ADJUSTMENTs (payments.adjustBonusForOrder). Reversing only the ACCRUAL would
   * leave the ADJUSTMENT in the wallet, leaking withdrawable bonus and corrupting
   * the balance. Skips silently when nothing is outstanding.
   */
  async reverseForOrder(tx: Prisma.TransactionClient, orderId: string, createdById?: string | null) {
    const rows = await tx.bonusTransaction.findMany({
      where: {
        orderId,
        type: { in: [BonusTransactionType.ACCRUAL, BonusTransactionType.ADJUSTMENT] },
        reversedBy: null,
      },
    });
    if (rows.length === 0) return null;

    // NEVER-NEGATIVE WALLET. The accrual being reversed may already have been SPENT
    // (cash WITHDRAWAL through the kassa, or a DEBT_OFFSET against the factory). Spends
    // are factory-level, not order-linked, so they cannot be clawed back automatically —
    // reversing anyway would drive the wallet below zero and leak real cash. Block and
    // point the operator at the spend, mirroring the guards on withdraw/offset/kassa.
    const needByFactory = new Map<string, Prisma.Decimal>();
    for (const r of rows) {
      needByFactory.set(r.factoryId, (needByFactory.get(r.factoryId) ?? D(0)).plus(D(r.amount)));
    }
    for (const [factoryId, need] of needByFactory) {
      if (need.lessThanOrEqualTo(0)) continue; // a negative adjustment adds back, never a risk
      const wallet = await this.walletBalance(factoryId, tx);
      if (wallet.lessThan(need)) {
        throw new BadRequestException(
          `Bonus hamyoni yetarli emas (balans ${wallet.toFixed(2)}, qaytarilishi kerak ${need.toFixed(2)}) — ` +
            `bu buyurtmaning bonusi allaqachon sarflangan. Avval bonus yechimini yoki qarzga o'tkazmani bekor qiling.`,
        );
      }
    }

    let last: Awaited<ReturnType<typeof tx.bonusTransaction.create>> | null = null;
    for (const row of rows) {
      last = await tx.bonusTransaction.create({
        data: {
          type: BonusTransactionType.REVERSAL,
          amount: D(row.amount).negated(),
          factoryId: row.factoryId,
          orderId,
          programId: row.programId,
          reversalOfId: row.id,
          createdById: createdById ?? null,
        },
      });
    }
    return last;
  }

  // ── wallet ──

  async walletBalance(factoryId: string, tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
    const db = tx ?? this.prisma;
    const r = await db.bonusTransaction.aggregate({ where: { factoryId }, _sum: { amount: true } });
    return D(r._sum.amount ?? 0);
  }

  async walletBalances(): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.bonusTransaction.groupBy({
      by: ['factoryId'],
      _sum: { amount: true },
    });
    return new Map(rows.map((r) => [r.factoryId, D(r._sum.amount ?? 0)]));
  }

  async wallets() {
    const factories = await this.prisma.factory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, active: true },
    });
    const balances = await this.walletBalances();
    return factories
      .map((factory) => ({ factory, balance: balances.get(factory.id) ?? ZERO }))
      .filter((r) => r.factory.active || !r.balance.isZero());
  }

  async transactions(q: BonusTxQueryDto): Promise<Paged<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.BonusTransactionWhereInput = q.factoryId ? { factoryId: q.factoryId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bonusTransaction.findMany({
        where,
        skip,
        take,
        orderBy: { at: 'desc' },
        include: {
          factory: { select: { id: true, name: true } },
          order: { select: { id: true, orderNo: true } },
          program: { select: { id: true, kind: true, ratePerM3: true, percent: true } },
          payment: { select: { id: true, kind: true, method: true, amount: true, date: true } },
        },
      }),
      this.prisma.bonusTransaction.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  // ── spends (ADMIN/ACCOUNTANT) ──

  /** The factory pays the accrued bonus out in cash — money ENTERS the dealer kassa. */
  async withdraw(dto: BonusWithdrawDto, userId: string) {
    const amount = this.toPositiveMoney(dto.amount, 'amount');
    const date = dto.date ? new Date(dto.date) : new Date();
    return this.prisma.$transaction(async (tx) => {
      // serialize wallet spends per factory — parallel withdraw/offset must not
      // both pass the balance check and drive the wallet negative
      await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${dto.factoryId} FOR UPDATE`;
      const factory = await tx.factory.findUnique({ where: { id: dto.factoryId } });
      if (!factory) throw new NotFoundException('Zavod topilmadi');

      const wallet = await this.walletBalance(dto.factoryId, tx);
      if (wallet.lessThan(amount)) {
        throw new BadRequestException(
          `Bonus hamyonida mablag' yetarli emas (balans: ${wallet.toFixed(2)})`,
        );
      }

      const cashbox = await tx.cashbox.findUnique({ where: { id: dto.cashboxId } });
      if (!cashbox) throw new NotFoundException('Kassa topilmadi');
      if (!cashbox.active) throw new BadRequestException('Kassa faol emas');
      if (cashbox.currency !== Currency.UZS) {
        throw new BadRequestException('Bonus faqat UZS kassaga qabul qilinadi');
      }

      const bonusTx = await tx.bonusTransaction.create({
        data: {
          type: BonusTransactionType.WITHDRAWAL,
          amount: amount.negated(),
          factoryId: dto.factoryId,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      const cashRow = await tx.cashTransaction.create({
        data: {
          cashboxId: dto.cashboxId,
          date,
          direction: CashDirection.IN,
          amount,
          source: CashSource.BONUS_WITHDRAWAL,
          bonusTransactionId: bonusTx.id,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'BonusTransaction',
        entityId: bonusTx.id,
        after: { ...bonusTx, cashTransactionId: cashRow.id },
      });
      return { ...bonusTx, cashTransaction: cashRow };
    });
  }

  /**
   * Apply the wallet against the dealer's debt to the same factory.
   * Canonical chain: Payment(FACTORY_OUT, BONUS, no cashbox) → LedgerEntry(BONUS_OFFSET) → BonusTransaction(DEBT_OFFSET).
   */
  async offsetDebt(dto: BonusOffsetDto, userId: string) {
    const amount = this.toPositiveMoney(dto.amount, 'amount');
    const date = dto.date ? new Date(dto.date) : new Date();
    return this.prisma.$transaction(async (tx) => {
      // same per-factory wallet lock as withdraw()
      await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${dto.factoryId} FOR UPDATE`;
      const factory = await tx.factory.findUnique({ where: { id: dto.factoryId } });
      if (!factory) throw new NotFoundException('Zavod topilmadi');

      const wallet = await this.walletBalance(dto.factoryId, tx);
      if (wallet.lessThan(amount)) {
        throw new BadRequestException(
          `Bonus hamyonida mablag' yetarli emas (balans: ${wallet.toFixed(2)})`,
        );
      }

      // NOT capped at the current factory debt on purpose: a BONUS offset is modelled as
      // a FACTORY_OUT payment funded from the wallet, exactly like a cash one. Paying a
      // factory more than you currently owe simply leaves a prepaid ADVANCE — the same
      // thing an over-paid cash FACTORY_OUT does. No money is minted: the wallet (factory
      // owes us bonus) and the advance (factory holds our money) are both claims on the
      // SAME factory, so this is a transfer between two receivables, fully audited by the
      // Payment → LedgerEntry(BONUS_OFFSET) → BonusTransaction(DEBT_OFFSET) chain. The
      // wallet check above is the only real limit.
      const payment = await tx.payment.create({
        data: {
          kind: PaymentKind.FACTORY_OUT,
          method: PaymentMethod.BONUS,
          amount,
          date,
          factoryId: dto.factoryId,
          cashboxId: null,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      const entry = await this.ledger.post(tx, {
        date,
        account: LedgerAccount.FACTORY,
        source: LedgerSource.BONUS_OFFSET,
        amount, // >0: reduces what the dealer owes the factory
        factoryId: dto.factoryId,
        paymentId: payment.id,
        note: dto.note ?? null,
        createdById: userId,
      });
      const bonusTx = await tx.bonusTransaction.create({
        data: {
          type: BonusTransactionType.DEBT_OFFSET,
          amount: amount.negated(),
          factoryId: dto.factoryId,
          paymentId: payment.id,
          note: dto.note ?? null,
          createdById: userId,
        },
      });
      await this.audit.log({
        tx,
        userId,
        action: AuditAction.CREATE,
        entity: 'BonusTransaction',
        entityId: bonusTx.id,
        after: { ...bonusTx, ledgerEntryId: entry.id },
      });
      return { ...bonusTx, payment };
    });
  }

  /**
   * Reverse a mistaken WITHDRAWAL: the wallet gets the money back and the kassa
   * row is compensated (cash leaves the box again). ACCRUAL/DEBT_OFFSET rows are
   * reversed through their own flows (order lifecycle / payment void).
   */
  async reverseWithdrawal(id: string, reason: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.bonusTransaction.findUnique({
        where: { id },
        include: { cashTransactions: { where: { reversalOfId: null, reversedBy: null } } },
      });
      if (!original) throw new NotFoundException('Bonus operatsiyasi topilmadi');
      if (original.type !== BonusTransactionType.WITHDRAWAL) {
        throw new BadRequestException('Faqat WITHDRAWAL operatsiyasi shu yerda qaytariladi');
      }
      await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${original.factoryId} FOR UPDATE`;
      const already = await tx.bonusTransaction.findUnique({ where: { reversalOfId: id } });
      if (already) throw new BadRequestException('Bu operatsiya allaqachon qaytarilgan');

      const reversal = await tx.bonusTransaction.create({
        data: {
          type: BonusTransactionType.REVERSAL,
          amount: D(original.amount).negated(), // withdrawal is negative ⇒ reversal restores +
          factoryId: original.factoryId,
          note: `Qaytarildi: ${reason}`,
          createdById: userId,
          reversalOfId: original.id,
        },
      });

      // compensate the kassa IN with an OUT — same never-below-zero guard as manual OUTs
      for (const c of original.cashTransactions) {
        await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${c.cashboxId} FOR UPDATE`;
        const sums = await tx.cashTransaction.groupBy({
          by: ['direction'],
          where: { cashboxId: c.cashboxId },
          _sum: { amount: true },
        });
        const balance = D(sums.find((s) => s.direction === CashDirection.IN)?._sum.amount ?? 0).minus(
          D(sums.find((s) => s.direction === CashDirection.OUT)?._sum.amount ?? 0),
        );
        if (balance.lessThan(D(c.amount))) {
          throw new BadRequestException(
            `Kassada mablag' yetarli emas: qoldiq ${balance.toFixed(2)}, qaytarish ${D(c.amount).toFixed(2)}`,
          );
        }
        await tx.cashTransaction.create({
          data: {
            cashboxId: c.cashboxId,
            date: new Date(),
            direction: CashDirection.OUT,
            amount: c.amount,
            rate: c.rate,
            source: CashSource.REVERSAL,
            bonusTransactionId: reversal.id,
            note: `Bonus qaytarildi: ${reason}`,
            createdById: userId,
            reversalOfId: c.id,
          },
        });
      }

      await this.audit.log({
        tx,
        userId,
        action: AuditAction.VOID,
        entity: 'BonusTransaction',
        entityId: id,
        note: reason,
        after: { reversalId: reversal.id },
      });
      return reversal;
    });
  }

  private toPositiveMoney(v: Prisma.Decimal.Value, field: string): Prisma.Decimal {
    try {
      return assertPositiveMoney(v, field);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
