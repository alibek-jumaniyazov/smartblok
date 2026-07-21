import { PaymentKind, Prisma, TransportMode } from '@prisma/client';
import { D, round2, ZERO } from './money';
import { clientChargeable } from './transport';

/**
 * FIFO auto-settlement of CLIENT money against a client's own orders.
 *
 * The owner's rule (2026-07-20): money coming from a client closes his OLDEST open order
 * first and keeps going down the list; whatever is left over stays as an advance. There is
 * no manual «taqsimlash» step for client money any more — it is derived, not chosen.
 *
 * IMPORTANT — this moves no money. A client's balance is the plain sum of his CLIENT
 * LedgerEntry rows (see LedgerService.clientBalance), and that credit is posted when the
 * PAYMENT is created, independent of any allocation. These rows only record WHICH orders
 * the money answered for, which is what drives the per-order "still owed" figures.
 * That is precisely why re-running this over historical payments cannot disturb any
 * balance the owner has already reconciled.
 *
 * FACTORY_OUT is deliberately NOT auto-allocated: it finalizes an order's cost at the
 * paying method's price (naqd vs bank) and re-derives the factory bonus, so the operator
 * still chooses those deliberately.
 */

/**
 * Payment kinds whose allocations reduce a CLIENT order's outstanding balance.
 *
 * TRANSPORT_DIRECT is deliberately NOT here. Under CLIENT_PAYS_DRIVER the driver's slice is
 * already carved out of the client's debt the moment the order is created (clientChargeable),
 * so counting the payment as a settlement too would deduct the same money twice — 22M would
 * read as 18M owed instead of 20M. TRANSPORT_DIRECT is now a RECORD of the driver getting
 * his cash, nothing more.
 */
export const CLIENT_SETTLING_KINDS: PaymentKind[] = [PaymentKind.CLIENT_IN];

export interface AutoAllocation {
  orderId: string;
  orderNo: string;
  amount: Prisma.Decimal;
}

/** The order fields the outstanding formula needs — every `select` feeding it must load all four. */
export interface ClientOutstandingOrder {
  id: string;
  saleTotal: Prisma.Decimal;
  transportMode: TransportMode;
  transportCost: Prisma.Decimal;
}

/**
 * How much of `orderId` the client still owes the DEALER:
 * clientChargeable(order) − Σ active settling allocations.
 */
export async function orderClientOutstanding(
  tx: Prisma.TransactionClient,
  order: ClientOutstandingOrder,
): Promise<Prisma.Decimal> {
  const allocs = await tx.paymentAllocation.aggregate({
    where: {
      orderId: order.id,
      voidedAt: null,
      payment: { voidedAt: null, kind: { in: CLIENT_SETTLING_KINDS } },
    },
    _sum: { amount: true },
  });
  const settled = D(allocs._sum.amount ?? 0);
  const left = round2(clientChargeable(order).minus(settled));
  return left.lessThan(0) ? ZERO : left;
}

/**
 * Spread `available` across the client's open orders, oldest first, and write the
 * allocation rows. Returns what it actually placed (the caller decides what to do with
 * the unplaced remainder — for client money it simply stays as an advance).
 *
 * Ordering is date → orderNo so that same-day orders settle in the sequence they were
 * booked, which is what «eng boshidagi buyurtmadan» means in practice.
 *
 * The caller MUST have locked the payment row; orders are locked here so two concurrent
 * payments for the same client cannot both see the same order as open and over-allocate it.
 */
export async function autoAllocateClientPayment(
  tx: Prisma.TransactionClient,
  payment: { id: string; clientId: string | null; amount: Prisma.Decimal; kind: PaymentKind },
  userId: string | null,
  opts: { alreadyPlaced?: Prisma.Decimal } = {},
): Promise<AutoAllocation[]> {
  if (!payment.clientId) return [];
  if (payment.kind !== PaymentKind.CLIENT_IN) return []; // transport money targets its own trip

  let remaining = round2(D(payment.amount).minus(opts.alreadyPlaced ?? ZERO));
  if (remaining.lessThanOrEqualTo(0)) return [];

  // Serialize with concurrent settlements on the same client's book.
  await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${payment.clientId} FOR UPDATE`;

  const orders = await tx.order.findMany({
    where: {
      clientId: payment.clientId,
      status: { not: 'CANCELLED' },
    },
    // transportMode/transportCost feed clientChargeable — omitting them would make Prisma
    // hand orderClientOutstanding `undefined` and silently settle against the GROSS total
    select: { id: true, orderNo: true, saleTotal: true, transportMode: true, transportCost: true },
    orderBy: [{ date: 'asc' }, { orderNo: 'asc' }],
  });

  const placed: AutoAllocation[] = [];
  for (const order of orders) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const outstanding = await orderClientOutstanding(tx, order);
    if (outstanding.lessThanOrEqualTo(0)) continue;

    // One ACTIVE allocation per (payment, order) — the partial unique index
    // PaymentAllocation_active_pair enforces it, so top up an existing row rather than
    // inserting a second one (happens when an advance later meets the order it belongs to).
    const existing = await tx.paymentAllocation.findFirst({
      where: { paymentId: payment.id, orderId: order.id, voidedAt: null },
      select: { id: true, amount: true },
    });

    const take = outstanding.lessThan(remaining) ? outstanding : remaining;
    if (take.lessThanOrEqualTo(0)) continue;

    if (existing) {
      await tx.paymentAllocation.update({
        where: { id: existing.id },
        data: { amount: round2(D(existing.amount).plus(take)) },
      });
    } else {
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, orderId: order.id, amount: take, createdById: userId },
      });
    }
    placed.push({ orderId: order.id, orderNo: order.orderNo, amount: take });
    remaining = round2(remaining.minus(take));
  }
  return placed;
}

/**
 * The client's unspent money: Σ non-voided CLIENT_IN payments − Σ their active allocations.
 * Used to pull a standing advance onto a newly booked order, so «avtomatik yechib oladi»
 * holds even when the money arrived before the order did.
 */
export async function clientUnallocatedPayments(
  tx: Prisma.TransactionClient,
  clientId: string,
): Promise<Array<{ id: string; amount: Prisma.Decimal; allocated: Prisma.Decimal; free: Prisma.Decimal }>> {
  const payments = await tx.payment.findMany({
    where: { clientId, kind: PaymentKind.CLIENT_IN, voidedAt: null },
    select: {
      id: true,
      amount: true,
      date: true,
      allocations: { where: { voidedAt: null }, select: { amount: true } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  return payments
    .map((p) => {
      const allocated = p.allocations.reduce((a, x) => a.plus(D(x.amount)), ZERO);
      return { id: p.id, amount: D(p.amount), allocated, free: round2(D(p.amount).minus(allocated)) };
    })
    .filter((p) => p.free.greaterThan(0));
}
