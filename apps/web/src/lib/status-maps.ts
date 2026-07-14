// Single source of truth for every enum label + status hue (02 §2.5, 03 §12).
// Every screen and print doc reads these maps — raw enums never render.
// Ink hexes are EXACT per 02-design-language.md §2.5; entries without a spec
// color carry label only (render as plain text or neutral chip).
// Enumerations mirror apps/api/prisma/schema.prisma — no omissions.
import type {
  BonusProgramKind,
  BonusTransactionType,
  CashDirection,
  CostStatus,
  OrderStatus,
  PaymentKind,
  PaymentMethod,
  PriceKind,
  Role,
  TransportMode,
  TransportPaidStatus,
} from './types';

// Prisma enums not yet in lib/types.ts — kept local until a page needs them typed.
export type LedgerAccount = 'CLIENT' | 'FACTORY' | 'VEHICLE';
export type LedgerSource =
  | 'ORDER_SALE'
  | 'ORDER_COST'
  | 'COST_ADJUSTMENT'
  | 'TRANSPORT_CHARGE'
  | 'TRANSPORT_COST'
  | 'PAYMENT'
  | 'PAYMENT_VOID'
  | 'ORDER_CANCEL'
  | 'PALLET_CHARGE'
  | 'PALLET_RETURN_CREDIT'
  | 'BONUS_OFFSET'
  | 'ADJUSTMENT'
  | 'IMPORT';
export type PalletTransactionType =
  | 'RECEIVED_FROM_FACTORY'
  | 'DELIVERED_TO_CLIENT'
  | 'RETURNED_BY_CLIENT'
  | 'RETURNED_TO_FACTORY'
  | 'CHARGED_LOST'
  | 'ADJUSTMENT'
  | 'REVERSAL';
export type CashboxType = 'CASH' | 'BANK' | 'CLICK' | 'TERMINAL' | 'CARD';
export type CashSource = 'MANUAL' | 'PAYMENT' | 'EXPENSE' | 'BONUS_WITHDRAWAL' | 'REVERSAL';
export type Currency = 'UZS' | 'USD';
export type LegalEntityKind = 'DEALER' | 'FACTORY' | 'THIRD_PARTY';
export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VOID'
  | 'STATUS_CHANGE'
  | 'COST_FINALIZE'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'IMPORT'
  | 'EXPORT';

export interface StatusMeta {
  label: string;
  /** ink for light theme — present only where 02 §2.5 defines a hue */
  light?: string;
  /** ink for dark theme */
  dark?: string;
  /** render 12%-tint FILLED even in tables (only violet UNKNOWN + danger CANCELLED) */
  filled?: boolean;
}

/** Pick the theme-correct ink; undefined ⇒ no semantic hue (neutral text). */
export function statusInk(meta: StatusMeta, mode: 'light' | 'dark'): string | undefined {
  return mode === 'dark' ? meta.dark : meta.light;
}

// ── Order lifecycle (02 §2.5 exact) ──
export const STATUS: Record<OrderStatus, StatusMeta> = {
  NEW: { label: 'Yangi', light: '#64748B', dark: '#94A3B8' },
  CONFIRMED: { label: 'Tasdiqlangan', light: '#2563EB', dark: '#7EA8F2' },
  LOADING: { label: 'Yuklanmoqda', light: '#9A6700', dark: '#D9A94A' },
  DELIVERING: { label: 'Yetkazilmoqda', light: '#C2410C', dark: '#E8926B' },
  DELIVERED: { label: 'Yetkazildi', light: '#0D9488', dark: '#4FB3A9' },
  COMPLETED: { label: 'Yakunlandi', light: '#1A7F37', dark: '#6CC495' },
  CANCELLED: { label: 'Bekor qilingan', light: '#C2413B', dark: '#E8827C', filled: true },
};

/** The one legal forward path; CANCELLED is reached only via cancel. */
export const STATUS_ORDER: readonly OrderStatus[] = [
  'NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED',
];

// ── Cost lifecycle (02 §2.5) ──
// Reframed from "estimated" to PAYMENT status — the dealer→factory cost is shown as exact
// naqd/bank sums; the state just says whether the factory has been paid (which locks it).
export const COST_STATUS: Record<CostStatus, StatusMeta> = {
  PROVISIONAL: { label: "Zavodga to'lanmagan", light: '#64748B', dark: '#94A3B8' },
  PARTIAL: { label: 'Qisman to‘langan', light: '#9A6700', dark: '#D9A94A' },
  FINAL: { label: "To'langan", light: '#1A7F37', dark: '#6CC495' },
};

// ── Transport payment (02 §2.5). UNKNOWN is the reserved-violet owner queue —
// StatusChip must add the `?` glyph; NOT_APPLICABLE renders an em-dash, no chip. ──
export const TRANSPORT_PAID: Record<TransportPaidStatus, StatusMeta> = {
  UNPAID: { label: "To'lanmagan", light: '#C2413B', dark: '#E8827C' },
  PAID: { label: "To'langan", light: '#1A7F37', dark: '#6CC495' },
  PAID_BY_CLIENT: { label: "Mijoz to'lagan", light: '#0D9488', dark: '#4FB3A9' },
  UNKNOWN: { label: 'Aniqlanmagan', light: '#6D5BD0', dark: '#9B8CF0', filled: true },
  NOT_APPLICABLE: { label: '—' },
};

// ── Transport mode (no spec hue — informational labels) ──
export const TRANSPORT_MODE: Record<TransportMode, StatusMeta> = {
  CLIENT_OWN: { label: "Mijozning o'z moshinasi" },
  DEALER_ABSORBED: { label: "O'zimiz to'laymiz" },
  DEALER_CHARGED: { label: 'Mijoz hisobiga yoziladi' },
};

// ── Payment kinds ──
export const PAYMENT_KIND: Record<PaymentKind, StatusMeta> = {
  CLIENT_IN: { label: "Mijozdan to'lov" },
  CLIENT_REFUND: { label: 'Mijozga qaytarish' },
  FACTORY_OUT: { label: "Zavodga to'lov" },
  FACTORY_REFUND: { label: 'Zavoddan qaytim' },
  VEHICLE_OUT: { label: "Shofyorga to'lov" },
  TRANSPORT_DIRECT: { label: "Mijoz shofyorga to'lagan" },
};

// ── Payment methods (composer segmented labels, 04 §3.3) ──
export const PAYMENT_METHOD: Record<PaymentMethod, StatusMeta> = {
  CASH: { label: 'Naqd' },
  BANK: { label: 'Bank' },
  CLICK: { label: 'Click' },
  TERMINAL: { label: 'Terminal' },
  CARD: { label: 'Karta' },
  USD: { label: 'USD' },
  BONUS: { label: 'Bonus hisobidan' },
};

// ── Price kinds (price book, allocation basis lines) ──
export const PRICE_KIND: Record<PriceKind, StatusMeta> = {
  FACTORY_CASH: { label: 'Zavod naqd' },
  FACTORY_BANK: { label: "Zavod o'tkazma" },
  DEALER_SALE: { label: 'Sotuv narxi' },
};

// ── Ledger sources — statement row labels («Buyurtma savdosi · ORD-000214») ──
export const LEDGER_SOURCE: Record<LedgerSource, StatusMeta> = {
  ORDER_SALE: { label: 'Buyurtma savdosi' },
  ORDER_COST: { label: 'Buyurtma tannarxi' },
  COST_ADJUSTMENT: { label: 'Tannarx farqi' },
  TRANSPORT_CHARGE: { label: 'Transport haqi' },
  TRANSPORT_COST: { label: 'Transport xarajati' },
  PAYMENT: { label: "To'lov" },
  PAYMENT_VOID: { label: "To'lov stornosi" },
  ORDER_CANCEL: { label: 'Buyurtma bekor qilindi' },
  PALLET_CHARGE: { label: "Paddon puli (yo'qolgan)" },
  PALLET_RETURN_CREDIT: { label: 'Paddon qaytarish krediti' },
  BONUS_OFFSET: { label: 'Bonusdan yopildi' },
  ADJUSTMENT: { label: "Tuzatish (qo'lda)" },
  IMPORT: { label: 'Import yozuvi' },
};

// ── Ledger accounts (party sides) ──
export const LEDGER_ACCOUNT: Record<LedgerAccount, StatusMeta> = {
  CLIENT: { label: 'Mijoz' },
  FACTORY: { label: 'Zavod' },
  VEHICLE: { label: 'Shofyor' },
};

// ── Roles (03 §1.2 — the raw enum never renders) ──
export const ROLES: Record<Role, StatusMeta> = {
  ADMIN: { label: 'Administrator' },
  ACCOUNTANT: { label: 'Buxgalter' },
  AGENT: { label: 'Agent' },
  CASHIER: { label: 'Kassir' },
};

// ── Kassa ──
export const CASH_DIRECTION: Record<CashDirection, StatusMeta> = {
  IN: { label: 'Kirim' },
  OUT: { label: 'Chiqim' },
};

export const CASH_SOURCE: Record<CashSource, StatusMeta> = {
  MANUAL: { label: "Qo'lda kiritilgan" },
  PAYMENT: { label: "To'lov" },
  EXPENSE: { label: 'Xarajat' },
  BONUS_WITHDRAWAL: { label: 'Bonus yechish' },
  REVERSAL: { label: 'Storno' },
};

export const CASHBOX_TYPE: Record<CashboxType, StatusMeta> = {
  CASH: { label: 'Naqd' },
  BANK: { label: 'Bank' },
  CLICK: { label: 'Click' },
  TERMINAL: { label: 'Terminal' },
  CARD: { label: 'Karta' },
};

export const CURRENCY: Record<Currency, StatusMeta> = {
  UZS: { label: "so'm" },
  USD: { label: 'USD' },
};

// ── Bonus ──
export const BONUS_PROGRAM: Record<BonusProgramKind, StatusMeta> = {
  NONE: { label: 'Dastur yo\'q' },
  PER_M3: { label: 'Har m³ uchun' },
  PERCENT: { label: 'Foizli' },
};

export const BONUS_TX: Record<BonusTransactionType, StatusMeta> = {
  ACCRUAL: { label: 'Hisoblandi' },
  WITHDRAWAL: { label: 'Naqd yechildi' },
  DEBT_OFFSET: { label: "Qarzga o'tkazildi" },
  ADJUSTMENT: { label: 'Tuzatish' },
  REVERSAL: { label: 'Storno' },
};

// ── Pallets (in-kind ledger) ──
export const PALLET_TX: Record<PalletTransactionType, StatusMeta> = {
  RECEIVED_FROM_FACTORY: { label: 'Zavoddan olindi' },
  DELIVERED_TO_CLIENT: { label: 'Mijozga yuborildi' },
  RETURNED_BY_CLIENT: { label: 'Mijoz qaytardi' },
  RETURNED_TO_FACTORY: { label: 'Zavodga qaytarildi' },
  CHARGED_LOST: { label: "Pulga o'tkazildi (yo'qolgan)" },
  ADJUSTMENT: { label: 'Tuzatish' },
  REVERSAL: { label: 'Storno' },
};

// ── Legal entities ──
export const LEGAL_ENTITY_KIND: Record<LegalEntityKind, StatusMeta> = {
  DEALER: { label: 'Diler firmasi' },
  FACTORY: { label: 'Zavod firmasi' },
  THIRD_PARTY: { label: 'Uchinchi tomon' },
};

// ── Audit log (no UI browser yet — labels reserved) ──
export const AUDIT_ACTION: Record<AuditAction, StatusMeta> = {
  CREATE: { label: 'Yaratildi' },
  UPDATE: { label: "O'zgartirildi" },
  DELETE: { label: "O'chirildi" },
  VOID: { label: 'Bekor qilindi' },
  STATUS_CHANGE: { label: "Holat o'zgardi" },
  COST_FINALIZE: { label: 'Tannarx qotirildi' },
  LOGIN: { label: 'Kirish' },
  LOGIN_FAILED: { label: 'Kirish xatosi' },
  IMPORT: { label: 'Import' },
  EXPORT: { label: 'Eksport' },
};

// ── Pseudo-status: Payment.reconciled === false (02 §2.5 last row) ──
export const UNRECONCILED: StatusMeta = { label: 'Tekshirilmagan', light: '#9A6700', dark: '#D9A94A' };
