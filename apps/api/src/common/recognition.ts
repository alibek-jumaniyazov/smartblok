import { PrismaService } from '../prisma/prisma.service';

// SmartBlok recognizes a client/factory/vehicle balance the moment an order is booked.
// A "recognized" (booked) order is any order that has not been cancelled — so an order in
// NEW/CONFIRMED/LOADING/DELIVERING/DELIVERED/COMPLETED all contribute to what is owed.
// CANCELLED orders (including soft-cancelled deletions) contribute nothing.
export const RECOGNIZED_ORDER = { status: { not: 'CANCELLED' } } as const;

// Round money to whole UZS so float artefacts (e.g. 32.8 * 750000 = 24,599,999.999…) do not
// leak phantom sub-tiyin debt/advance rows.
export function roundMoney(n: number): number {
  return Math.round(n ?? 0);
}

// Payments count toward a party's balance unless they are tied to a CANCELLED order.
// Order-less payments (orderId = null, i.e. general on-account) always count.
export async function recognizedPaymentWhere(
  prisma: PrismaService,
  base = {},
) {
  const cancelled = await prisma.order.findMany({
    where: { status: 'CANCELLED' },
    select: { id: true },
  });
  if (!cancelled.length) return base;
  const ids = cancelled.map((c) => c.id);
  return { AND: [base, { OR: [{ orderId: null }, { orderId: { notIn: ids } }] }] };
}
