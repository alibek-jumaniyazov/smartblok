import { BadRequestException, Injectable } from '@nestjs/common';
import { FactoryBucket, LedgerAccount, LedgerSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { D, round2, ZERO } from './money';

export interface PostEntryInput {
  date: Date;
  account: LedgerAccount;
  source: LedgerSource;
  /** signed; >0 = asset for the dealer (they owe us), <0 = our liability */
  amount: Prisma.Decimal.Value;
  clientId?: string | null;
  factoryId?: string | null;
  vehicleId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  /** required for account=FACTORY, forbidden otherwise — SQL CHECK ledger_factory_bucket */
  factoryBucket?: FactoryBucket | null;
  /** ADVANCE_DRAW only: the allocation whose draw this row is half of */
  allocationId?: string | null;
  palletTransactionId?: string | null;
  note?: string | null;
  createdById?: string | null;
  importBatchId?: string | null;
}

/** The dealer's money standing at a factory, split the way the owner reads it. */
export interface FactoryBuckets {
  /** <0 ⇒ we owe the factory for goods; >0 ⇒ the factory owes us back */
  payable: Prisma.Decimal;
  /** naqd money standing at the factory (never auto-spent) */
  advanceCash: Prisma.Decimal;
  /** o'tkazma money standing at the factory */
  advanceBank: Prisma.Decimal;
  /** advanceCash + advanceBank */
  advanceTotal: Prisma.Decimal;
  /** legacy single netted balance — payable + advanceTotal */
  net: Prisma.Decimal;
}

const emptyBuckets = (): FactoryBuckets => ({
  payable: ZERO,
  advanceCash: ZERO,
  advanceBank: ZERO,
  advanceTotal: ZERO,
  net: ZERO,
});

/**
 * «Balansni nazorat qilish» off-book corrections (owner rule, 2026-07-22). They move a SINGLE
 * party's own balance + statement, but must stay OUT of the company-wide dashboard rollups.
 * Per-party reads (clientBalance / factoryBuckets / statement) INCLUDE them so a party page and
 * its statement always tie out; the dashboard passes { includeOffBook: false } to the aggregate
 * helpers, which then filter these sources out. (They never reach the transactions journal at
 * all — an off-book posting writes no CashTransaction.)
 */
const OFFBOOK_SOURCES: LedgerSource[] = [LedgerSource.OFFBOOK_ADJUSTMENT];
const offBookWhere = (includeOffBook: boolean): Prisma.LedgerEntryWhereInput =>
  includeOffBook ? {} : { source: { notIn: OFFBOOK_SOURCES } };

/** aggregate-read option: whether off-book corrections count toward the rollup (default: yes). */
interface AggOpts {
  includeOffBook?: boolean;
}

/**
 * The single write-path for balance-affecting postings. Immutable: corrections
 * are compensating entries via reverse(). Balances are sums, never stored.
 * Must always be called with the surrounding Prisma transaction client so the
 * posting commits or rolls back atomically with its business mutation.
 */
@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  async post(tx: Prisma.TransactionClient, input: PostEntryInput) {
    const amount = round2(input.amount);
    if (amount.isZero()) {
      throw new BadRequestException('Ledger posting amount cannot be zero');
    }
    this.assertPartyMatchesAccount(input);
    this.assertFactoryBucket(input);
    return tx.ledgerEntry.create({
      data: {
        date: input.date,
        account: input.account,
        source: input.source,
        amount,
        factoryBucket: input.account === LedgerAccount.FACTORY ? input.factoryBucket! : null,
        clientId: input.clientId ?? null,
        factoryId: input.factoryId ?? null,
        vehicleId: input.vehicleId ?? null,
        orderId: input.orderId ?? null,
        paymentId: input.paymentId ?? null,
        allocationId: input.allocationId ?? null,
        palletTransactionId: input.palletTransactionId ?? null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        importBatchId: input.importBatchId ?? null,
      },
    });
  }

  /**
   * «Avansdan yechish» — moves value from an advance channel to the order-debt bucket
   * as a ZERO-SUM pair, so the factory's overall balance is untouched while the two
   * displayed numbers change. Both rows carry orderId + allocationId, which is what
   * makes a single draw individually reversible (see reverseAllocationDraw).
   */
  async postAdvanceDraw(
    tx: Prisma.TransactionClient,
    input: {
      date: Date;
      factoryId: string;
      orderId: string;
      allocationId: string;
      paymentId: string;
      bucket: FactoryBucket;
      amount: Prisma.Decimal;
      note?: string | null;
      createdById?: string | null;
    },
  ) {
    if (input.bucket === FactoryBucket.PAYABLE) {
      throw new BadRequestException('Avansdan yechish faqat naqd yoki bank avansidan bo\'ladi');
    }
    const amount = round2(input.amount);
    const base = {
      date: input.date,
      account: LedgerAccount.FACTORY,
      source: LedgerSource.ADVANCE_DRAW,
      factoryId: input.factoryId,
      orderId: input.orderId,
      allocationId: input.allocationId,
      paymentId: input.paymentId,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    };
    // out of the advance channel …
    await this.post(tx, { ...base, factoryBucket: input.bucket, amount: amount.negated() });
    // … and onto the order's debt
    await this.post(tx, { ...base, factoryBucket: FactoryBucket.PAYABLE, amount });
  }

  /** Un-draws one allocation: reverses both halves of every draw pair it funded. */
  async reverseAllocationDraw(
    tx: Prisma.TransactionClient,
    allocationId: string,
    note: string,
    createdById?: string | null,
  ) {
    const rows = await tx.ledgerEntry.findMany({
      where: {
        allocationId,
        source: LedgerSource.ADVANCE_DRAW,
        reversalOfId: null,
        reversedBy: null,
      },
    });
    for (const r of rows) await this.reverse(tx, r.id, note, createdById);
    return rows.length;
  }

  /**
   * Posts the exact opposite of an existing entry, linked via reversalOfId.
   * Idempotent per entry. The reversal carries the ORIGINAL business date so a
   * date-windowed statement nets to zero instead of double-counting a repost;
   * `at` still records when the reversal actually happened.
   */
  async reverse(
    tx: Prisma.TransactionClient,
    entryId: string,
    note: string,
    createdById?: string | null,
    /**
     * PALLET_CHARGE / PALLET_RETURN_CREDIT rows must carry a palletTransactionId (SQL
     * CHECK ledger_pallet_link), but the column is @unique so a reversal cannot reuse
     * the original's. The caller therefore creates the compensating PalletTransaction
     * (type REVERSAL) first and passes its id here. Without this the reversal of any
     * pallet-money row aborts the whole transaction on the CHECK.
     */
    opts?: { palletTransactionId?: string | null },
  ) {
    const entry = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } });
    const already = await tx.ledgerEntry.findUnique({ where: { reversalOfId: entryId } });
    if (already) return already;
    const palletLinked =
      entry.source === LedgerSource.PALLET_CHARGE || entry.source === LedgerSource.PALLET_RETURN_CREDIT;
    if (palletLinked && !opts?.palletTransactionId) {
      throw new BadRequestException(
        'Poddon puli yozuvini bekor qilish uchun teskari poddon harakati kerak (palletTransactionId)',
      );
    }
    return tx.ledgerEntry.create({
      data: {
        date: entry.date,
        account: entry.account,
        source: entry.source,
        amount: entry.amount.negated(),
        // the pair must land in the SAME bucket or the two halves would not net out
        factoryBucket: entry.factoryBucket,
        clientId: entry.clientId,
        factoryId: entry.factoryId,
        vehicleId: entry.vehicleId,
        orderId: entry.orderId,
        paymentId: entry.paymentId,
        allocationId: entry.allocationId,
        palletTransactionId: opts?.palletTransactionId ?? null,
        importBatchId: entry.importBatchId,
        note,
        createdById: createdById ?? null,
        reversalOfId: entry.id,
      },
    });
  }

  /** Reverses every non-reversed entry attached to an order (soft-cancel). */
  async reverseAllForOrder(tx: Prisma.TransactionClient, orderId: string, note: string, createdById?: string | null) {
    const entries = await tx.ledgerEntry.findMany({
      where: { orderId, reversalOfId: null, reversedBy: null },
    });
    for (const e of entries) {
      await this.reverse(tx, e.id, note, createdById);
    }
    return entries.length;
  }

  /**
   * Reverses only the order's non-reversed entries in the given accounts. Used to
   * un-post the supply side (FACTORY / VEHICLE) when an order is pulled back out of
   * LOADING — the client side stays untouched.
   */
  async reverseOrderByAccounts(
    tx: Prisma.TransactionClient,
    orderId: string,
    accounts: LedgerAccount[],
    note: string,
    createdById?: string | null,
  ) {
    const entries = await tx.ledgerEntry.findMany({
      where: { orderId, account: { in: accounts }, reversalOfId: null, reversedBy: null },
    });
    for (const e of entries) {
      await this.reverse(tx, e.id, note, createdById);
    }
    return entries.length;
  }

  // ── balances (sums over postings; >0 ⇒ they owe us / our advance) ──

  async clientBalance(clientId: string, tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
    const db = tx ?? this.prisma;
    const r = await db.ledgerEntry.aggregate({
      where: { account: LedgerAccount.CLIENT, clientId },
      _sum: { amount: true },
    });
    return D(r._sum.amount ?? 0);
  }

  /**
   * Legacy single netted figure — still exactly Σ over all three buckets, so every
   * caller written before the split keeps its value. Accepts a transaction client
   * because the advance-draw gate has to read its own uncommitted writes.
   */
  async factoryBalance(factoryId: string, tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
    const db = tx ?? this.prisma;
    const r = await db.ledgerEntry.aggregate({
      where: { account: LedgerAccount.FACTORY, factoryId },
      _sum: { amount: true },
    });
    return D(r._sum.amount ?? 0);
  }

  /**
   * The owner's three numbers for one factory: open order debt, naqd advance, bank
   * advance. A prepayment never nets against an order here — that only happens when
   * someone presses «avansdan yechish», which posts an ADVANCE_DRAW pair.
   */
  async factoryBuckets(factoryId: string, tx?: Prisma.TransactionClient): Promise<FactoryBuckets> {
    const db = tx ?? this.prisma;
    const rows = await db.ledgerEntry.groupBy({
      by: ['factoryBucket'],
      where: { account: LedgerAccount.FACTORY, factoryId },
      _sum: { amount: true },
    });
    return this.foldBuckets(rows);
  }

  /** factoryId → buckets, for list screens. */
  async factoryBucketsMap(opts: AggOpts = {}): Promise<Map<string, FactoryBuckets>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['factoryId', 'factoryBucket'],
      where: { account: LedgerAccount.FACTORY, factoryId: { not: null }, ...offBookWhere(opts.includeOffBook ?? true) },
      _sum: { amount: true },
    });
    const byFactory = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.factoryId) continue;
      const list = byFactory.get(r.factoryId) ?? [];
      list.push(r);
      byFactory.set(r.factoryId, list);
    }
    return new Map([...byFactory].map(([id, list]) => [id, this.foldBuckets(list)]));
  }

  private foldBuckets(
    rows: { factoryBucket: FactoryBucket | null; _sum: { amount: Prisma.Decimal | null } }[],
  ): FactoryBuckets {
    const out = emptyBuckets();
    for (const r of rows) {
      const amount = D(r._sum.amount ?? 0);
      if (r.factoryBucket === FactoryBucket.ADVANCE_CASH) out.advanceCash = out.advanceCash.plus(amount);
      else if (r.factoryBucket === FactoryBucket.ADVANCE_BANK) out.advanceBank = out.advanceBank.plus(amount);
      else out.payable = out.payable.plus(amount);
    }
    out.advanceTotal = out.advanceCash.plus(out.advanceBank);
    out.net = out.payable.plus(out.advanceTotal);
    return out;
  }

  async vehicleBalance(vehicleId: string): Promise<Prisma.Decimal> {
    const r = await this.prisma.ledgerEntry.aggregate({
      where: { account: LedgerAccount.VEHICLE, vehicleId },
      _sum: { amount: true },
    });
    return D(r._sum.amount ?? 0);
  }

  /** clientId -> balance for a set of clients in one query. */
  async clientBalances(clientIds?: string[], opts: AggOpts = {}): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['clientId'],
      where: {
        account: LedgerAccount.CLIENT,
        ...(clientIds ? { clientId: { in: clientIds } } : { clientId: { not: null } }),
        ...offBookWhere(opts.includeOffBook ?? true),
      },
      _sum: { amount: true },
    });
    return new Map(rows.filter((r) => r.clientId).map((r) => [r.clientId as string, D(r._sum.amount ?? 0)]));
  }

  async factoryBalances(opts: AggOpts = {}): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['factoryId'],
      where: { account: LedgerAccount.FACTORY, factoryId: { not: null }, ...offBookWhere(opts.includeOffBook ?? true) },
      _sum: { amount: true },
    });
    return new Map(rows.filter((r) => r.factoryId).map((r) => [r.factoryId as string, D(r._sum.amount ?? 0)]));
  }

  async vehicleBalances(opts: AggOpts = {}): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['vehicleId'],
      where: { account: LedgerAccount.VEHICLE, vehicleId: { not: null }, ...offBookWhere(opts.includeOffBook ?? true) },
      _sum: { amount: true },
    });
    return new Map(rows.filter((r) => r.vehicleId).map((r) => [r.vehicleId as string, D(r._sum.amount ?? 0)]));
  }

  /**
   * Total outstanding debt of an agent's clients (only debts count: negative
   * client balances — prepayments — do not offset other clients' debts).
   * Used by the agent debt-limit gate. Run inside the order-creation transaction.
   */
  async agentOutstandingDebt(tx: Prisma.TransactionClient, agentId: string): Promise<Prisma.Decimal> {
    const rows = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(bal), 0) AS total FROM (
        SELECT SUM(le."amount") AS bal
        FROM "LedgerEntry" le
        JOIN "Client" c ON c."id" = le."clientId"
        WHERE le."account" = 'CLIENT' AND c."agentId" = ${agentId}
        GROUP BY le."clientId"
        HAVING SUM(le."amount") > 0
      ) debts`;
    return D(rows[0]?.total ?? 0);
  }

  /** Statement: running history for one party. */
  async statement(account: LedgerAccount, partyId: string, from?: Date, to?: Date) {
    const partyWhere =
      account === LedgerAccount.CLIENT
        ? { clientId: partyId }
        : account === LedgerAccount.FACTORY
          ? { factoryId: partyId }
          : { vehicleId: partyId };
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { account, ...partyWhere, ...(from || to ? { date: { gte: from, lte: to } } : {}) },
      orderBy: [{ date: 'asc' }, { at: 'asc' }],
      include: { order: { select: { orderNo: true } }, payment: { select: { kind: true, method: true } } },
    });
    let running = ZERO;
    return entries.map((e) => {
      running = running.plus(e.amount);
      return { ...e, running };
    });
  }

  private assertPartyMatchesAccount(i: PostEntryInput) {
    const ok =
      (i.account === LedgerAccount.CLIENT && i.clientId && !i.factoryId && !i.vehicleId) ||
      (i.account === LedgerAccount.FACTORY && i.factoryId && !i.clientId && !i.vehicleId) ||
      (i.account === LedgerAccount.VEHICLE && i.vehicleId && !i.clientId && !i.factoryId);
    if (!ok) {
      throw new BadRequestException(`Ledger party does not match account ${i.account}`);
    }
  }

  /** mirrors SQL CHECK ledger_factory_bucket — required for FACTORY, forbidden elsewhere */
  private assertFactoryBucket(i: PostEntryInput) {
    if (i.account === LedgerAccount.FACTORY) {
      if (!i.factoryBucket) {
        throw new BadRequestException(
          `FACTORY posting needs a factoryBucket (source ${i.source})`,
        );
      }
    } else if (i.factoryBucket) {
      throw new BadRequestException(`factoryBucket is only valid on FACTORY postings`);
    }
  }
}
