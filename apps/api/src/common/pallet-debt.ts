import { Prisma } from '@prisma/client';
import { D, round2, ZERO } from './money';

export const DEFAULT_PALLET_UNIT_PRICE = 130000;
export const MAX_PALLET_UNIT_PRICE = 999999999999;

/** Legacy null/zero settings mean the standard price; money always stays Decimal. */
export function effectivePalletPrice(value: unknown): Prisma.Decimal {
  if (value && typeof value === 'object' && 'amount' in value) value = (value as { amount: unknown }).amount;
  if (typeof value !== 'number' && typeof value !== 'string') return D(DEFAULT_PALLET_UNIT_PRICE);
  try {
    const price = D(value);
    return price.isFinite() && price.gt(0) && price.lte(MAX_PALLET_UNIT_PRICE)
      ? round2(price) : D(DEFAULT_PALLET_UNIT_PRICE);
  } catch { return D(DEFAULT_PALLET_UNIT_PRICE); }
}

export async function currentPalletPrice(db: Pick<Prisma.TransactionClient, 'appSetting'>) {
  const setting = await db.appSetting.findUnique({ where: { key: 'palletPriceDefault' } });
  return effectivePalletPrice(setting?.value);
}

/** Both sides use positive DEBT, negative ADVANCE. Never floor signed pallet corrections. */
export function dualDebt(baseDebt: Prisma.Decimal.Value, quantity: number, unitPrice: Prisma.Decimal.Value) {
  const debtWithoutPallets = round2(baseDebt);
  const palletUnitPrice = round2(unitPrice);
  const palletDebtAmount = round2(palletUnitPrice.mul(quantity));
  return {
    debtWithoutPallets,
    palletDebtQuantity: quantity,
    palletUnitPrice,
    palletDebtAmount,
    debtWithPallets: round2(debtWithoutPallets.plus(palletDebtAmount)),
  };
}

/** A full-filter summary keeps debtors and advances separate, in both valuation views. */
export function summarizeDualDebts(rows: ReturnType<typeof dualDebt>[]) {
  let netWithoutPallets = ZERO, netWithPallets = ZERO, palletDebtAmount = ZERO;
  let debtWithoutPalletsTotal = ZERO, advanceWithoutPalletsTotal = ZERO;
  let debtWithPalletsTotal = ZERO, advanceWithPalletsTotal = ZERO;
  let palletDebtQuantity = 0;
  for (const row of rows) {
    netWithoutPallets = netWithoutPallets.plus(row.debtWithoutPallets);
    netWithPallets = netWithPallets.plus(row.debtWithPallets);
    palletDebtAmount = palletDebtAmount.plus(row.palletDebtAmount);
    palletDebtQuantity += row.palletDebtQuantity;
    if (row.debtWithoutPallets.gt(0)) debtWithoutPalletsTotal = debtWithoutPalletsTotal.plus(row.debtWithoutPallets);
    else advanceWithoutPalletsTotal = advanceWithoutPalletsTotal.minus(row.debtWithoutPallets);
    if (row.debtWithPallets.gt(0)) debtWithPalletsTotal = debtWithPalletsTotal.plus(row.debtWithPallets);
    else advanceWithPalletsTotal = advanceWithPalletsTotal.minus(row.debtWithPallets);
  }
  return { netWithoutPallets, netWithPallets, palletDebtAmount, palletDebtQuantity,
    debtWithoutPalletsTotal, advanceWithoutPalletsTotal, debtWithPalletsTotal, advanceWithPalletsTotal };
}

/**
 * The workbook credits factory-return delivery expenses to the factory settlement.
 * Import preserves a unique sheet/row provenance in both records. Only active cash
 * expenses unambiguously linked to that factory are credited; ordinary expenses are
 * not guessed from their description. OUT is a credit, signed IN reverses it.
 * This is a valuation read: it does not post a second cash or ledger transaction.
 */
export async function factoryReturnExpenseCredits(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  importBatchId?: string,
): Promise<Map<string, Prisma.Decimal>> {
  const rows = await factoryReturnExpenseCreditEntries(db, importBatchId);
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of rows) totals.set(row.factoryId, round2((totals.get(row.factoryId) ?? ZERO).plus(row.amount)));
  return totals;
}

/** Business-dated components of the SAME credit used in factory debt cards. */
export async function factoryReturnExpenseCreditEntries(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  importBatchId?: string,
  before?: Date,
): Promise<Array<{ factoryId: string; date: Date; amount: Prisma.Decimal }>> {
  return db.$queryRaw<Array<{ factoryId: string; date: Date; amount: Prisma.Decimal }>>(Prisma.sql`
    WITH attributed AS (
      SELECT e.id, e.date, MIN(p."factoryId") AS "factoryId"
      FROM "Expense" e
      JOIN "PalletTransaction" p ON p."importBatchId" = e."importBatchId"
        AND p.date = e.date AND (p.type = 'RETURNED_TO_FACTORY'
          OR (p.type = 'REVERSAL' AND p."reversalOfType" = 'RETURNED_TO_FACTORY'))
        AND p."factoryId" IS NOT NULL
        AND (p.note = e.note OR
          (substring(p.note from 'Excel «[^»]+» r[0-9]+') IS NOT NULL AND
           substring(p.note from 'Excel «[^»]+» r[0-9]+') = substring(e.note from 'Excel «[^»]+» r[0-9]+')))
      WHERE e."voidedAt" IS NULL AND e."importBatchId" IS NOT NULL
        ${importBatchId ? Prisma.sql`AND e."importBatchId" = ${importBatchId}` : Prisma.empty}
        ${before ? Prisma.sql`AND e.date < (${before}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty}
      GROUP BY e.id HAVING COUNT(DISTINCT p."factoryId") = 1
    )
    SELECT a."factoryId", a.date, SUM(CASE WHEN t.direction = 'OUT' THEN t.amount ELSE -t.amount END) AS amount
    FROM attributed a JOIN "CashTransaction" t ON t."expenseId" = a.id
    GROUP BY a."factoryId", a.date`);
}
