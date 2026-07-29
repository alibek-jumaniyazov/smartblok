import { Prisma } from '@prisma/client';
import { round2, ZERO } from './money';

/**
 * «Zavodda qolgan pulimiz» — the ONE factory figure the owner reads, and the only one the
 * screens are allowed to print.
 *
 * His Лист1 «Завод» block states it as a single subtraction:
 *
 *     Олинган   3 035 493 990        ← Σ olingan molning tannarxi
 *     Берилган  3 427 089 420        ← Σ «Утказилган пул»
 *     ─────────────────────────
 *     qolgani     391 595 430        ← Нахт 0 · банк 391 595 430
 *
 * The LEDGER keeps the two halves apart on purpose (owner rule, 2026-07-21: an advance never
 * auto-consumes a goods debt — only an explicit «avansdan yechish» moves value between the
 * buckets), so `advanceBank` on its own reads 489 470 806 while 97 875 376 of naqd goods is
 * still owed. That gross figure is a correct internal quantity and a WRONG thing to show:
 * the owner saw it on the factory card and it did not exist anywhere in his book
 * («489 470 806 bu xato, 391 595 430 to'g'ri», 2026-07-29). Hence one helper, used by every
 * factory surface, so the number cannot drift between screens.
 *
 * Channel split follows the sheet: each channel reports its own remainder FLOORED AT ZERO, and
 * an overdrawn channel leaves its shortfall on the other line — which is exactly why his block
 * reads «Нахт 0 · банк 391 595 430» and not «Нахт −97 875 376 · банк 489 470 806». Nothing is
 * hidden by that: the shortfall keeps its own «Zavodlarga qarzimiz — naqd» card, and by the
 * 2026-07-29 rule it can only ever be settled with naqd money.
 */
export interface FactoryBucketsLike {
  net: Prisma.Decimal;
  advanceCash: Prisma.Decimal;
  advanceBank: Prisma.Decimal;
}

export interface OpenDebtSplit {
  total: Prisma.Decimal;
  cash: Prisma.Decimal;
  bank: Prisma.Decimal;
}

export interface NetAdvance {
  /** = buckets.net when positive — the «Завод» block's bottom line */
  advanceNetTotal: Prisma.Decimal;
  advanceNetCash: Prisma.Decimal;
  advanceNetBank: Prisma.Decimal;
}

export function netAdvance(b: FactoryBucketsLike | undefined, debt?: OpenDebtSplit): NetAdvance {
  if (!b) return { advanceNetTotal: ZERO, advanceNetCash: ZERO, advanceNetBank: ZERO };
  // A factory we owe overall has no advance at all — the debt cards carry that side.
  const total = Prisma.Decimal.max(ZERO, b.net);
  const cash = Prisma.Decimal.min(
    total,
    Prisma.Decimal.max(ZERO, b.advanceCash.minus(debt?.cash ?? ZERO)),
  );
  return {
    advanceNetTotal: round2(total),
    advanceNetCash: round2(cash),
    advanceNetBank: round2(total.minus(cash)),
  };
}
