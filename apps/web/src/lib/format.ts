// Formatting for Decimal-as-string money and business values. Display-only —
// arithmetic on money stays server-side.
import dayjs from 'dayjs';
import type { CostStatus, OrderStatus, PaymentKind, PaymentMethod, TransportPaidStatus } from './types';

type Num = string | number | null | undefined;

const toNumber = (n: Num): number => {
  if (n == null || n === '') return 0;
  const v = typeof n === 'string' ? Number(n) : n;
  return Number.isFinite(v) ? v : 0;
};

const MINUS = '−'; // true minus, per 02 §7 — never a hyphen on money
const intMoney = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function fmtUZS(n: Num): string {
  return fmtMoney(n) + " so'm";
}

/** Space-grouped integer so'm; negative renders with a true minus (U+2212). */
export function fmtMoney(n: Num): string {
  const v = Math.round(toNumber(n));
  return (v < 0 ? MINUS : '') + intMoney.format(Math.abs(v));
}

/** Explicit-sign variant for statement amounts: «+ 4 500 000» / «− 4 500 000». */
export function fmtMoneySigned(n: Num): string {
  const v = Math.round(toNumber(n));
  return (v < 0 ? MINUS + ' ' : '+ ') + intMoney.format(Math.abs(v));
}

export function fmtNum(n: Num, digits = 0): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(toNumber(n));
}

export function fmtM3(n: Num): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(toNumber(n)) + ' m³';
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return dayjs(d).format('DD.MM.YYYY');
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return dayjs(d).format('DD.MM.YYYY HH:mm');
}

export function fmtShort(n: Num): string {
  const v = toNumber(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? MINUS : ''; // true minus (U+2212), never a hyphen on money (02 §7)
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + ' mlrd';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' mln';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' ming';
  return sign + String(Math.round(abs));
}

/** |balance| < 1 UZS is float residue from back-solved prices — show settled */
export function isSettled(n: Num): boolean {
  return Math.abs(toNumber(n)) < 1;
}

export const num = toNumber;

// ── label / color maps (AntD Tag colors) ──

export const ORDER_STATUS: Record<OrderStatus, { label: string; color: string }> = {
  NEW: { label: 'Yangi', color: 'default' },
  CONFIRMED: { label: 'Tasdiqlangan', color: 'blue' },
  LOADING: { label: 'Yuklanmoqda', color: 'gold' },
  DELIVERING: { label: 'Yetkazilmoqda', color: 'orange' },
  DELIVERED: { label: 'Yetkazildi', color: 'cyan' },
  COMPLETED: { label: 'Yakunlandi', color: 'green' },
  CANCELLED: { label: 'Bekor qilindi', color: 'red' },
};

export const PAYMENT_KIND: Record<PaymentKind, string> = {
  CLIENT_IN: "Mijozdan to'lov",
  CLIENT_REFUND: 'Mijozga qaytarish',
  FACTORY_OUT: "Zavodga to'lov",
  FACTORY_REFUND: 'Zavoddan qaytim',
  VEHICLE_OUT: "Shofyorga to'lov",
  TRANSPORT_DIRECT: "Mijoz shofyorga to'ladi",
};

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  CASH: 'Naqd',
  BANK: "O'tkazma",
  CLICK: 'Click',
  TERMINAL: 'Terminal',
  CARD: 'Karta',
  USD: 'Valyuta (USD)',
  BONUS: 'Bonus hisobidan',
};

export const COST_STATUS: Record<CostStatus, { label: string; color: string }> = {
  PROVISIONAL: { label: 'Taxminiy tannarx', color: 'default' },
  PARTIAL: { label: "Qisman to'langan", color: 'gold' },
  FINAL: { label: 'Tannarx qotirilgan', color: 'green' },
};

export const TRANSPORT_PAID: Record<TransportPaidStatus, { label: string; color: string }> = {
  NOT_APPLICABLE: { label: '—', color: 'default' },
  UNKNOWN: { label: 'Aniqlanmagan', color: 'default' },
  UNPAID: { label: "To'lanmagan", color: 'red' },
  PAID: { label: "To'langan", color: 'green' },
  PAID_BY_CLIENT: { label: "Mijoz to'lagan", color: 'cyan' },
};
