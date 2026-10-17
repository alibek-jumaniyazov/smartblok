import type { FactoryPalletShipment, FactoryPalletShipmentStatus } from './types';

export const SHIPMENT_STATUS: Record<FactoryPalletShipmentStatus, { label: string; color: string }> = {
  IN_TRANSIT: { label: 'Yo‘lda', color: 'blue' },
  INSPECTING: { label: 'Tekshiruv kutilmoqda', color: 'gold' },
  AWAITING_RETURN: { label: 'Rad etilganlar qaytishi kutilmoqda', color: 'orange' },
  COMPLETED: { label: 'Yakunlangan', color: 'green' },
  CANCELLED: { label: 'Bekor qilingan', color: 'default' },
};

export function canCancelShipment(s: FactoryPalletShipment): boolean {
  return s.status === 'IN_TRANSIT' && !s.arrivedAt && s.acceptedQty === 0 && s.rejectedQty === 0 && s.returnedQty === 0;
}

/** Preserve tiyin and large decimal strings; generic money cells intentionally round to whole so'm. */
export function formatAcceptanceValue(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return '—';
  const whole = BigInt(match[1]).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return fraction === '00' ? whole : `${whole}.${fraction}`;
}

/** Preview uses integer tiyin so a multi-price receipt never displays a rounded floating-point total. */
export function inspectionPreview(
  lines: { qty?: number | null; unitPrice?: string | number | null }[],
  rejected: number | undefined | null,
  available: number,
) {
  let acceptedQty = 0;
  let amount = 0n;
  let validLines = true;
  for (const line of lines) {
    const qty = Number(line?.qty);
    const price = String(line?.unitPrice ?? '').trim();
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 2147483647 || !/^\d{1,12}(\.\d{1,2})?$/.test(price)) {
      validLines = false;
      continue;
    }
    const [whole, fraction = ''] = price.split('.');
    amount += (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * BigInt(qty);
    acceptedQty += qty;
  }
  const rejectedQty = Number(rejected ?? 0);
  const totalQty = acceptedQty + rejectedQty;
  const valid = validLines && lines.length <= 100 && amount <= 999999999999999999n && Number.isSafeInteger(rejectedQty) && rejectedQty >= 0 && totalQty > 0 && totalQty <= available;
  return {
    acceptedQty,
    rejectedQty,
    totalQty,
    remainingQty: available - totalQty,
    amount: `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`,
    valid,
  };
}
