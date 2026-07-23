import { CashSource, Prisma } from '@prisma/client';

/**
 * «Kassa balansini tahrirlash» — an owner off-book correction of ONE cashbox's balance
 * (owner rule, 2026-07-23). Unlike the ledger-side OFFBOOK_ADJUSTMENT — which writes no cash
 * row at all — this DOES write a real CashTransaction, because a cashbox balance is nothing
 * but Σ(IN) − Σ(OUT). Exclusion here is therefore a FILTER, not the absence of a row, and the
 * polarity is the opposite of ledger.service.ts: cash defaults to INCLUDING the correction.
 *
 *  • every BALANCE read INCLUDES it — boxBalance(), cashboxes().balance, summary().opening,
 *    dashboard.kassa().balance, the never-below-zero guards in payments/bonus/kassa, and the
 *    import CAPITAL top-up. The corrected balance IS the true balance.
 *  • every kirim/chiqim FLOW figure EXCLUDES it — a correction is not an operation.
 *  • the transactions journal SHOWS it — that is the whole audit trail.
 *
 * A single constant on purpose: the exclusion is spelled out at several call sites across two
 * services, and TRANSFER/CAPITAL already prove how quietly hand-copied source lists drift.
 */
/**
 * CAPITAL sits here for the same reason: «Diller kapitali» is the owner's OWN money put into a
 * box so it never shows a minus (import-commit.service.ts ensureCashboxesNonNegative). It is a
 * funding entry, not a collection. Counting it as kirim overstated the reference import's
 * income by 203 103 300 so'm and made `/kassa` and `/dashboard` disagree by exactly that much
 * — two screens quoting different «kirim» for the same period is how the discrepancy surfaced.
 */
export const CASH_FLOW_EXCLUDED_SOURCES: CashSource[] = [
  CashSource.BALANCE_ADJUSTMENT,
  CashSource.CAPITAL,
];

/** true when this row must NOT count toward any kirim/chiqim figure. */
export const isOffBookCash = (source: CashSource): boolean =>
  CASH_FLOW_EXCLUDED_SOURCES.includes(source);

/** where-fragment for a pure FLOW aggregate (spread into a groupBy/aggregate where). */
export const cashFlowWhere = (): Prisma.CashTransactionWhereInput => ({
  source: { notIn: CASH_FLOW_EXCLUDED_SOURCES },
});
