import { BadRequestException } from '@nestjs/common';
import { PaymentKind, PriceKind, Prisma } from '@prisma/client';
import { D, ONE, ONE_SOM, round2, sum, ZERO } from './money';
import { missingPriceText, PricingService } from './pricing.service';

/** Uzbek name of a settlement channel, as the owner says it. */
export const channelName = (kind: PriceKind): string =>
  kind === PriceKind.FACTORY_CASH ? 'naqd' : "o'tkazma";

/**
 * How much of one order's factory cost has been bought, and at which prices.
 *
 * THE MODEL (owner rule, 2026-07-21). An order is a QUANTITY of goods, not a fixed sum
 * of money, because the same goods cost less in naqd than by o'tkazma. A settlement of
 * A so'm through a channel whose whole-order price is T therefore buys A/T of the order,
 * and the order is done when those shares add up to one:
 *
 *     100 m³ · naqd 600k · bank 625k  →  cash total 60M, bank total 62.5M
 *     30M from the naqd advance  → buys 0.5 of the order
 *     31.25M by o'tkazma         → buys the other 0.5
 *     final cost                 = 61.25M   (neither 60M nor 62.5M)
 *
 * A single full settlement reduces to «price the whole order at that channel's book»,
 * which is exactly what the pre-blend engine did — so historical orders keep their value.
 *
 * Pallets never appear here: they are owed to the factory in COUNT, never in money.
 */
export async function factoryCoverage(
  tx: Prisma.TransactionClient,
  pricing: PricingService,
  orderId: string,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    // the product NAME is loaded so a missing-price refusal can say WHICH product to price
    include: { items: { include: { product: { select: { name: true } } } } },
  });

  const items: {
    id: string;
    qty: Prisma.Decimal;
    cash: Prisma.Decimal;
    bank: Prisma.Decimal;
    provisional: Prisma.Decimal;
  }[] = [];
  /**
   * Products whose OWN book price for a channel is missing (owner rule, 2026-07-26).
   *
   * A channel with no book row used to silently borrow the other channel's price, which is
   * fine for keeping the machine running and WRONG to show to a human: it made «naqd
   * tannarx» and «o'tkazma tannarx» print the same number, so paying naqd looked like it
   * cost the o'tkazma price — which is exactly what it did, because the naqd row does not
   * exist. The borrowing stays (nothing becomes unpayable) but is RECORDED, never hidden:
   * `hasPrice[kind] === false` ⇒ that figure is borrowed. Screens print «—» instead of a
   * twin number, and settling or drawing THROUGH that channel is refused by name.
   */
  const missing: Record<PriceKind, string[]> = {
    [PriceKind.FACTORY_CASH]: [],
    [PriceKind.FACTORY_BANK]: [],
    [PriceKind.DEALER_SALE]: [],
  };
  /**
   * «umuman narx yo'q» ≠ «narx bor, lekin KEYINROQDAN kuchga kiradi».
   *
   * Ikkinchisi egasining haqiqiy holati: narxni bugun kiritadi, buyurtma esa o'tgan oydan.
   * Sanasiz xabar ikkalasini bir xil ko'rsatardi, shuning uchun eng erta narx sanasi ham
   * yig'iladi va rad etish matnida aytiladi.
   */
  const missingSince: Record<PriceKind, (Date | null)[]> = {
    [PriceKind.FACTORY_CASH]: [],
    [PriceKind.FACTORY_BANK]: [],
    [PriceKind.DEALER_SALE]: [],
  };
  for (const item of order.items) {
    /**
     * ANCHOR (2026-07-26). The channel the order was actually priced at is a FACT stored on
     * the item — `costPricePerM3` — not something to re-derive from today's price book.
     *
     * Re-reading the book was the deeper cause of «zavodga to'lov o'tkazma narxiga o'tib
     * qoladi». The importer prices each truck from the JOURNAL (one product legitimately
     * carries two cost prices on the same day, e.g. 625 000 and 545 000) while the book
     * keeps only that day's modal value, ties going to the DEARER price. So for an imported
     * order priced at the cheaper figure, totals[BANK] came out ABOVE order.costTotal: the
     * order read as part-unpaid though it was settled in full, offered a phantom advance
     * draw, and the moment anything recomputed, COST_ADJUSTMENT lifted its cost to the
     * dearer book price — silently eating profit and inflating the PERCENT bonus.
     *
     * Anchoring makes totals[ownKind] === order.costTotal by construction. The OTHER channel
     * still comes from the book (it is genuinely a hypothetical: "what if we paid the other
     * way"). `hasPrice`/`missing` stay driven by the BOOK for both channels — the anchor is
     * about the money math, not about pretending a missing price row exists.
     */
    const anchor = item.provisionalPriceKind;
    const provisional = D(item.costPricePerM3);
    /** the channel's own book row, recording its absence for the screens */
    const bookRow = async (kind: PriceKind) => {
      const own = await pricing.tryBookPrice(tx, item.productId, kind, order.date);
      if (!own) {
        missing[kind].push(item.product.name);
        missingSince[kind].push(await pricing.firstBookDate(tx, item.productId, kind));
      }
      return own;
    };
    const bookCash = await bookRow(PriceKind.FACTORY_CASH);
    const bookBank = await bookRow(PriceKind.FACTORY_BANK);
    items.push({
      id: item.id,
      // effective (actual ?? planned) qty — actual loading moves the provisional cost as
      // an ORDER_COST delta, so coverage must track the same number
      qty: D(item.actualQuantityM3 ?? item.quantityM3),
      // same fallback ladder as order creation (buildOrderItems) for the non-anchored side:
      // own book → the other factory book → the price the order was created with
      cash:
        anchor === PriceKind.FACTORY_CASH ? provisional : (bookCash ?? bookBank ?? provisional),
      bank:
        anchor === PriceKind.FACTORY_BANK ? provisional : (bookBank ?? bookCash ?? provisional),
      provisional,
    });
  }
  const hasPrice: Record<PriceKind, boolean> = {
    [PriceKind.FACTORY_CASH]: missing[PriceKind.FACTORY_CASH].length === 0,
    [PriceKind.FACTORY_BANK]: missing[PriceKind.FACTORY_BANK].length === 0,
    [PriceKind.DEALER_SALE]: true,
  };

  const totalAt = (kind: PriceKind) =>
    items.reduce(
      (acc, p) => acc.plus(round2(p.qty.times(kind === PriceKind.FACTORY_CASH ? p.cash : p.bank))),
      ZERO,
    );
  const totals = {
    [PriceKind.FACTORY_CASH]: totalAt(PriceKind.FACTORY_CASH),
    [PriceKind.FACTORY_BANK]: totalAt(PriceKind.FACTORY_BANK),
    [PriceKind.DEALER_SALE]: ZERO,
  } as Record<PriceKind, Prisma.Decimal>;

  const allocations = await tx.paymentAllocation.findMany({
    where: {
      orderId,
      voidedAt: null,
      payment: { kind: PaymentKind.FACTORY_OUT, voidedAt: null },
    },
    orderBy: { createdAt: 'asc' },
  });

  // An order the price book values at zero cannot be apportioned; treat any money on it
  // as buying the whole thing, which is what the pre-blend engine also did.
  const unpriced =
    totals[PriceKind.FACTORY_CASH].isZero() && totals[PriceKind.FACTORY_BANK].isZero();

  const shareOf = (a: { amount: Prisma.Decimal; priceKind: PriceKind | null }) => {
    if (unpriced) return allocations.length ? ONE.div(allocations.length) : ZERO;
    const t = totals[a.priceKind ?? PriceKind.FACTORY_BANK];
    return t.isZero() ? ZERO : D(a.amount).div(t);
  };

  // legacy rows could be over-allocated; a slice may never exceed the whole order
  const fraction = Prisma.Decimal.min(
    allocations.reduce((acc, a) => acc.plus(shareOf(a)), ZERO),
    ONE,
  );
  const uncoveredShare = Prisma.Decimal.max(ZERO, ONE.minus(fraction));

  const remainingAt = (kind: PriceKind) =>
    round2(Prisma.Decimal.max(ZERO, uncoveredShare.times(totals[kind])));
  const remaining = {
    [PriceKind.FACTORY_CASH]: remainingAt(PriceKind.FACTORY_CASH),
    [PriceKind.FACTORY_BANK]: remainingAt(PriceKind.FACTORY_BANK),
    [PriceKind.DEALER_SALE]: ZERO,
  } as Record<PriceKind, Prisma.Decimal>;

  // «settled» in money, not in floating fractions: under one so'm left to buy is done
  const settled =
    allocations.length > 0 &&
    remaining[PriceKind.FACTORY_CASH].lessThan(ONE_SOM) &&
    remaining[PriceKind.FACTORY_BANK].lessThan(ONE_SOM);

  const paidCash = sum(
    allocations.filter((a) => a.priceKind === PriceKind.FACTORY_CASH).map((a) => a.amount),
  );
  const paidBank = sum(
    allocations.filter((a) => a.priceKind !== PriceKind.FACTORY_CASH).map((a) => a.amount),
  );

  return {
    order,
    items,
    totals,
    /** false ⇒ that channel's total is BORROWED from the other book — never show it as fact */
    hasPrice,
    /** product names whose own book price for that channel is missing (for the error text) */
    missing,
    /** parallel to `missing`: the earliest date that product IS priced at, or null */
    missingSince,
    allocations,
    shareOf,
    fraction,
    uncoveredShare,
    remaining,
    settled,
    paidCash,
    paidBank,
    /** short human tag for the audit trail / ledger note */
    describeMix: () =>
      paidCash.isZero()
        ? 'bank'
        : paidBank.isZero()
          ? 'naqd'
          : `aralash naqd ${paidCash.toFixed(0)} / bank ${paidBank.toFixed(0)}`,
  };
}

export type FactoryCoverage = Awaited<ReturnType<typeof factoryCoverage>>;

/**
 * Gate every MONEY move through a channel on that channel's price actually existing
 * (owner rule, 2026-07-26: «aniq ogohlantirish + naqd to'lovni bloklash»).
 *
 * Without this the borrowed price from `book()` silently priced a naqd settlement at the
 * o'tkazma book — the dealer paid the cheap price and the books recorded the dear one, and
 * nothing on screen hinted why the two candidate costs were identical. Order CREATION is
 * deliberately NOT gated (a missing COST price must never block SELLING — see
 * buildOrderItems); only the settlement itself is.
 */
export function assertChannelPriced(
  cov: Pick<FactoryCoverage, 'hasPrice' | 'missing' | 'missingSince'>,
  kind: PriceKind,
  orderNo: string,
  /** buyurtma sanasi — narx kitobi AYNAN shu kunda o'qiladi, xabar shuni aytishi shart */
  at: Date,
): void {
  if (cov.hasPrice[kind]) return;
  const channel = channelName(kind);
  // eng erta narx sanasi bo'yicha ENG KECHKISI: shu sanadan boshlab hamma mahsulot qamraladi
  const since = cov.missingSince[kind].filter((d): d is Date => !!d);
  const firstFrom = since.length === cov.missing[kind].length && since.length
    ? since.reduce((a, b) => (a > b ? a : b))
    : null;
  const names = [...new Set(cov.missing[kind])].map((n) => `«${n}»`).join(', ');
  throw new BadRequestException(
    `${orderNo}: ${missingPriceText({ who: names, kind, at, firstFrom })} ` +
      `Narxsiz ${channel} bilan hisob-kitob qilinmaydi — aks holda ${channel} puli ` +
      `o'zga kanal narxida yozilib ketardi.`,
  );
}
