import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerAccount, LedgerSource, Prisma } from '@prisma/client';
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
  palletTransactionId?: string | null;
  note?: string | null;
  createdById?: string | null;
  importBatchId?: string | null;
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
    return tx.ledgerEntry.create({
      data: {
        date: input.date,
        account: input.account,
        source: input.source,
        amount,
        clientId: input.clientId ?? null,
        factoryId: input.factoryId ?? null,
        vehicleId: input.vehicleId ?? null,
        orderId: input.orderId ?? null,
        paymentId: input.paymentId ?? null,
        palletTransactionId: input.palletTransactionId ?? null,
        note: input.note ?? null,
        createdById: input.createdById ?? null,
        importBatchId: input.importBatchId ?? null,
      },
    });
  }

  /**
   * Posts the exact opposite of an existing entry, linked via reversalOfId.
   * Idempotent per entry. The reversal carries the ORIGINAL business date so a
   * date-windowed statement nets to zero instead of double-counting a repost;
   * `at` still records when the reversal actually happened.
   */
  async reverse(tx: Prisma.TransactionClient, entryId: string, note: string, createdById?: string | null) {
    const entry = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } });
    const already = await tx.ledgerEntry.findUnique({ where: { reversalOfId: entryId } });
    if (already) return already;
    return tx.ledgerEntry.create({
      data: {
        date: entry.date,
        account: entry.account,
        source: entry.source,
        amount: entry.amount.negated(),
        clientId: entry.clientId,
        factoryId: entry.factoryId,
        vehicleId: entry.vehicleId,
        orderId: entry.orderId,
        paymentId: entry.paymentId,
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

  // ── balances (sums over postings; >0 ⇒ they owe us / our advance) ──

  async clientBalance(clientId: string, tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
    const db = tx ?? this.prisma;
    const r = await db.ledgerEntry.aggregate({
      where: { account: LedgerAccount.CLIENT, clientId },
      _sum: { amount: true },
    });
    return D(r._sum.amount ?? 0);
  }

  async factoryBalance(factoryId: string): Promise<Prisma.Decimal> {
    const r = await this.prisma.ledgerEntry.aggregate({
      where: { account: LedgerAccount.FACTORY, factoryId },
      _sum: { amount: true },
    });
    return D(r._sum.amount ?? 0);
  }

  async vehicleBalance(vehicleId: string): Promise<Prisma.Decimal> {
    const r = await this.prisma.ledgerEntry.aggregate({
      where: { account: LedgerAccount.VEHICLE, vehicleId },
      _sum: { amount: true },
    });
    return D(r._sum.amount ?? 0);
  }

  /** clientId -> balance for a set of clients in one query. */
  async clientBalances(clientIds?: string[]): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['clientId'],
      where: {
        account: LedgerAccount.CLIENT,
        ...(clientIds ? { clientId: { in: clientIds } } : { clientId: { not: null } }),
      },
      _sum: { amount: true },
    });
    return new Map(rows.filter((r) => r.clientId).map((r) => [r.clientId as string, D(r._sum.amount ?? 0)]));
  }

  async factoryBalances(): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['factoryId'],
      where: { account: LedgerAccount.FACTORY, factoryId: { not: null } },
      _sum: { amount: true },
    });
    return new Map(rows.filter((r) => r.factoryId).map((r) => [r.factoryId as string, D(r._sum.amount ?? 0)]));
  }

  async vehicleBalances(): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['vehicleId'],
      where: { account: LedgerAccount.VEHICLE, vehicleId: { not: null } },
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
}
