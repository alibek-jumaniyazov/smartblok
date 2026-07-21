import { PaymentKind, Prisma, TransportMode, TransportPaidStatus } from '@prisma/client';
import { D, round2, ZERO } from './money';

/** Shape every transport-carve-out rule reads — the three order fields it depends on. */
interface TransportShape {
  transportMode: TransportMode;
  transportCost: Prisma.Decimal | string | number;
  saleTotal: Prisma.Decimal | string | number;
}

/**
 * The slice of saleTotal the client hands straight to the driver — never a dealer receivable.
 *
 * Egasining qoidasi: transport HAR DOIM summa ICHIDA. CLIENT_PAYS_DRIVER rejimida mijoz shu
 * bo'lakni shofyorga o'z qo'li bilan beradi, dillerga esa faqat qolganini — shuning uchun bu
 * pul dillerning qarz kitobiga hech qachon kirmaydi. Boshqa rejimlarda diller pulni to'liq
 * oladi, demak carve-out yo'q (ZERO).
 *
 * Xato kiritilgan transport (saleTotal'dan katta) mijoz qarzini MANFIY qilib yubormasligi
 * uchun saleTotal bilan cheklanadi.
 */
export function clientDirectTransport(p: TransportShape): Prisma.Decimal {
  if (p.transportMode !== TransportMode.CLIENT_PAYS_DRIVER) return ZERO;
  const cost = round2(D(p.transportCost));
  if (cost.lessThanOrEqualTo(0)) return ZERO;
  const sale = round2(D(p.saleTotal));
  if (sale.lessThanOrEqualTo(0)) return ZERO;
  return cost.greaterThan(sale) ? sale : cost;
}

/**
 * What the client actually owes the dealer for an order: saleTotal minus the direct-to-driver
 * slice. BU YAGONA FORMULA — har bir ekran va endpoint shu raqamni ko'rsatishi shart
 * (egasining asosiy shikoyati: bir xil pul turli sahifada turlicha ko'rinardi).
 */
export function clientChargeable(p: TransportShape): Prisma.Decimal {
  const left = round2(round2(D(p.saleTotal)).minus(clientDirectTransport(p)));
  return left.lessThan(0) ? ZERO : left;
}

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
