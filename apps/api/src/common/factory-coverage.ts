import { PaymentKind, PriceKind, Prisma } from '@prisma/client';
import { D, ONE, ONE_SOM, round2, sum, ZERO } from './money';
import { otherFactoryKind, PricingService } from './pricing.service';

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
    include: { items: true },
  });

  const items: {
    id: string;
    qty: Prisma.Decimal;
    cash: Prisma.Decimal;
    bank: Prisma.Decimal;
    provisional: Prisma.Decimal;
  }[] = [];
  for (const item of order.items) {
    // Same fallback ladder as order creation (buildOrderItems): requested kind → the
    // other factory kind → the price the order was created with. Throwing here would
    // make an order the price book cannot fully price UNPAYABLE — the allocation
    // transaction would roll back and costStatus would stick on PROVISIONAL forever.
    const book = async (kind: PriceKind) =>
      (await pricing.tryBookPrice(tx, item.productId, kind, order.date)) ??
      (await pricing.tryBookPrice(tx, item.productId, otherFactoryKind(kind), order.date)) ??
      D(item.costPricePerM3);
    items.push({
      id: item.id,
      // effective (actual ?? planned) qty — actual loading moves the provisional cost as
      // an ORDER_COST delta, so coverage must track the same number
      qty: D(item.actualQuantityM3 ?? item.quantityM3),
      cash: await book(PriceKind.FACTORY_CASH),
      bank: await book(PriceKind.FACTORY_BANK),
      provisional: D(item.costPricePerM3),
    });
  }

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
