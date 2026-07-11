import { PaymentKind, Prisma, TransportMode, TransportPaidStatus } from '@prisma/client';
import { D, ZERO } from './money';

/**
 * Derives an order's transportPaidStatus from the surviving transport payments,
 * instead of blindly flipping flags (a void or edit must not clobber another
 * payment's settlement, and a partial allocation must not read as PAID).
 *
 * Rules:
 *  - CLIENT_OWN mode or transportCost = 0 → NOT_APPLICABLE
 *  - Σ active allocations from non-voided VEHICLE_OUT / TRANSPORT_DIRECT
 *    payments ≥ transportCost → PAID (VEHICLE_OUT latest) / PAID_BY_CLIENT
 *    (TRANSPORT_DIRECT latest); ties broken by the latest payment date
 *  - otherwise UNPAID — except an imported UNKNOWN with no payments is preserved
 */
export async function recomputeTransportStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      transportMode: true,
      transportCost: true,
      transportPaidStatus: true,
    },
  });
  if (!order) return;

  const cost = D(order.transportCost);
  if (order.transportMode === TransportMode.CLIENT_OWN || cost.lessThanOrEqualTo(0)) {
    if (order.transportPaidStatus !== TransportPaidStatus.NOT_APPLICABLE) {
      await tx.order.update({
        where: { id: orderId },
        data: { transportPaidStatus: TransportPaidStatus.NOT_APPLICABLE, transportPaidAt: null },
      });
    }
    return;
  }

  const allocs = await tx.paymentAllocation.findMany({
    where: {
      orderId,
      voidedAt: null,
      payment: {
        voidedAt: null,
        kind: { in: [PaymentKind.VEHICLE_OUT, PaymentKind.TRANSPORT_DIRECT] },
      },
    },
    include: { payment: { select: { kind: true, date: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const covered = allocs.reduce((acc, a) => acc.plus(D(a.amount)), ZERO);

  if (covered.greaterThanOrEqualTo(cost) && allocs.length) {
    const latest = allocs[allocs.length - 1];
    await tx.order.update({
      where: { id: orderId },
      data: {
        transportPaidStatus:
          latest.payment.kind === PaymentKind.VEHICLE_OUT
            ? TransportPaidStatus.PAID
            : TransportPaidStatus.PAID_BY_CLIENT,
        transportPaidAt: latest.payment.date,
      },
    });
    return;
  }

  // preserve imported UNKNOWN when no payment evidence exists at all
  if (!allocs.length && order.transportPaidStatus === TransportPaidStatus.UNKNOWN) return;

  if (order.transportPaidStatus !== TransportPaidStatus.UNPAID) {
    await tx.order.update({
      where: { id: orderId },
      data: { transportPaidStatus: TransportPaidStatus.UNPAID, transportPaidAt: null },
    });
  }
}
