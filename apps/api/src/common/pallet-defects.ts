import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Shared with factory returns and return reversals: there is one usable stock pool. */
export const PALLET_STOCK_LOCK = 748923;

/** Usable dealer stock; defective stock is retained separately and cannot be returned. */
export const palletStockDeltaSql = Prisma.sql`CASE
  WHEN pt.type = 'RETURNED_BY_CLIENT' THEN pt.qty
  WHEN pt.type::text IN ('RETURNED_TO_FACTORY', 'DEFECTIVE_FROM_FACTORY') THEN -pt.qty
  WHEN pt.type = 'REVERSAL' AND src.type = 'RETURNED_BY_CLIENT' THEN -pt.qty
  WHEN pt.type = 'REVERSAL' AND COALESCE(src.type::text, pt."reversalOfType"::text)
    IN ('RETURNED_TO_FACTORY', 'DEFECTIVE_FROM_FACTORY') THEN pt.qty
  WHEN pt.type = 'ADJUSTMENT' AND pt."clientId" IS NULL AND pt."factoryId" IS NULL THEN pt.qty
  WHEN pt.type = 'REVERSAL' AND src.type = 'ADJUSTMENT'
    AND pt."clientId" IS NULL AND pt."factoryId" IS NULL
    AND src."clientId" IS NULL AND src."factoryId" IS NULL THEN pt.qty
  ELSE 0 END`;

/**
 * Run inside the stock lock after changes. Neither a backdated defect nor a later
 * cancellation/import rollback may remove receipts or usable stock supporting a
 * live defect. Legacy warehouse damage is a separate obligation and stays signed.
 * Daily buckets use the same Tashkent business days and source-dated cancellations
 * as the reports. We check every subsequent day, not only today's net balance.
 */
export async function assertFactoryDefectsSupported(tx: Prisma.TransactionClient): Promise<void> {
  const defects = await tx.palletTransaction.findMany({
    where: { type: 'DEFECTIVE_FROM_FACTORY' },
    select: { factoryId: true, date: true, qty: true, reversals: { select: { qty: true } } },
  });
  const firstDay = new Map<string, string>();
  const businessDay = (date: Date) => new Date(date.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  for (const row of defects) {
    if (!row.factoryId || row.qty - row.reversals.reduce((s, r) => s + r.qty, 0) <= 0) continue;
    const day = businessDay(row.date);
    if (!firstDay.has(row.factoryId) || day < firstDay.get(row.factoryId)!) firstDay.set(row.factoryId, day);
  }
  if (firstDay.size === 0) return;
  const stockSince = [...firstDay.values()].sort()[0];
  const [stock, factories] = await Promise.all([
    tx.$queryRaw<Array<{ day: string; delta: number }>>(Prisma.sql`
      SELECT to_char(COALESCE(src.date, pt.date) + interval '5 hours', 'YYYY-MM-DD') AS day,
        COALESCE(SUM(${palletStockDeltaSql}), 0)::int AS delta
      FROM "PalletTransaction" pt LEFT JOIN "PalletTransaction" src ON src.id = pt."reversalOfId"
      GROUP BY 1 ORDER BY 1`),
    tx.$queryRaw<Array<{ factoryId: string; day: string; delta: number }>>(Prisma.sql`
      SELECT pt."factoryId", to_char(COALESCE(src.date, pt.date) + interval '5 hours', 'YYYY-MM-DD') AS day,
        COALESCE(SUM(CASE
          WHEN pt.type = 'RECEIVED_FROM_FACTORY' THEN pt.qty
          WHEN pt.type::text IN ('RETURNED_TO_FACTORY', 'DEFECTIVE_FROM_FACTORY') THEN -pt.qty
          WHEN pt.type IN ('ADJUSTMENT', 'REVERSAL') THEN pt.qty ELSE 0 END), 0)::int AS delta
      FROM "PalletTransaction" pt LEFT JOIN "PalletTransaction" src ON src.id = pt."reversalOfId"
      WHERE pt."factoryId" IN (${Prisma.join([...firstDay.keys()])})
      GROUP BY 1, 2 ORDER BY 2, 1`),
  ]);
  let usable = 0;
  for (const event of stock) {
    usable += event.delta;
    if (event.day >= stockSince && usable < 0) {
      throw new BadRequestException(`${event.day} sanasida yaroqli poddon zaxirasi ${usable} dona bo‘lib qoladi. ` +
        'Yaroqsiz poddon sanasi yoki miqdorini tekshiring; bog‘liq qaytarish/buyurtmani o‘zgartirishdan oldin yaroqsiz poddon yozuvini bekor qiling.');
    }
  }
  const balances = new Map<string, number>();
  for (const event of factories) {
    const balance = (balances.get(event.factoryId) ?? 0) + event.delta;
    balances.set(event.factoryId, balance);
    if (event.day >= firstDay.get(event.factoryId)! && balance < 0) {
      throw new BadRequestException(`${event.day} sanasida zavodning poddon qarzi ${balance} dona bo‘lib qoladi. ` +
        'Avval shu zavod bo‘yicha yaroqsiz poddon yozuvini bekor qiling yoki miqdor/sanani tuzating.');
    }
  }
}
