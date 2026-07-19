// Single source of truth for every enum label + status hue (02 §2.5, 03 §12).
// Every screen and print doc reads these maps — raw enums never render.
// Ink hexes are EXACT per 02-design-language.md §2.5; entries without a spec
// color carry label only (render as plain text or neutral chip).
// Enumerations mirror apps/api/prisma/schema.prisma — no omissions.
//
// I18N: har bir `label` — bu getter. U o'zbek lotin manba matnini joriy tilga
// o'giradi (lib/i18n `translate`). Chaqiruv joylari o'zgarmaydi: `STATUS[x].label`
// hamon string qaytaradi, lekin til almashsa qiymat ham o'zgaradi. Til almashganda
// App qayta mount bo'ladi (main.tsx `key={lang}`), shu bois barcha yorliqlar
// yangi tilda o'qiladi.
import { translate } from './i18n';
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
export type CashSource = 'MANUAL' | 'PAYMENT' | 'EXPENSE' | 'BONUS_WITHDRAWAL' | 'REVERSAL' | 'TRANSFER' | 'CAPITAL';
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

// Yorliqni joriy tilga o'giradigan getter'li StatusMeta yasaydi. `uz` — o'zbek
// lotin manba matni (i18n lug'atidagi kalit sifatida ham ishlatiladi).
function mk(uz: string, extra?: Omit<StatusMeta, 'label'>): StatusMeta {
  return {
    ...extra,
    get label() {
      return translate(uz);
    },
  };
}

/** Pick the theme-correct ink; undefined ⇒ no semantic hue (neutral text). */
export function statusInk(meta: StatusMeta, mode: 'light' | 'dark'): string | undefined {
  return mode === 'dark' ? meta.dark : meta.light;
}

// ── Order lifecycle (02 §2.5 exact) ──
export const STATUS: Record<OrderStatus, StatusMeta> = {
  NEW: mk('Yangi', { light: '#64748B', dark: '#94A3B8' }),
  CONFIRMED: mk('Tasdiqlangan', { light: '#2563EB', dark: '#7EA8F2' }),
  LOADING: mk('Yuklanmoqda', { light: '#9A6700', dark: '#D9A94A' }),
  DELIVERING: mk('Yetkazilmoqda', { light: '#C2410C', dark: '#E8926B' }),
  DELIVERED: mk('Yetkazildi', { light: '#0D9488', dark: '#4FB3A9' }),
  COMPLETED: mk('Yakunlandi', { light: '#1A7F37', dark: '#6CC495' }),
  CANCELLED: mk('Bekor qilingan', { light: '#C2413B', dark: '#E8827C', filled: true }),
};

/** The one legal forward path; CANCELLED is reached only via cancel. */
export const STATUS_ORDER: readonly OrderStatus[] = [
  'NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED',
];

// ── Cost lifecycle (02 §2.5) ──
// Reframed from "estimated" to PAYMENT status — the dealer→factory cost is shown as exact
// naqd/bank sums; the state just says whether the factory has been paid (which locks it).
export const COST_STATUS: Record<CostStatus, StatusMeta> = {
  PROVISIONAL: mk("Zavodga to'lanmagan", { light: '#64748B', dark: '#94A3B8' }),
  PARTIAL: mk('Qisman to‘langan', { light: '#9A6700', dark: '#D9A94A' }),
  FINAL: mk("To'langan", { light: '#1A7F37', dark: '#6CC495' }),
};

// ── Transport payment (02 §2.5). UNKNOWN is the reserved-violet owner queue —
// StatusChip must add the `?` glyph; NOT_APPLICABLE renders an em-dash, no chip. ──
export const TRANSPORT_PAID: Record<TransportPaidStatus, StatusMeta> = {
  UNPAID: mk("To'lanmagan", { light: '#C2413B', dark: '#E8827C' }),
  PAID: mk("To'langan", { light: '#1A7F37', dark: '#6CC495' }),
  PAID_BY_CLIENT: mk("Mijoz to'lagan", { light: '#0D9488', dark: '#4FB3A9' }),
  UNKNOWN: mk('Aniqlanmagan', { light: '#6D5BD0', dark: '#9B8CF0', filled: true }),
  NOT_APPLICABLE: mk('—'),
};

// ── Transport mode (no spec hue — informational labels) ──
export const TRANSPORT_MODE: Record<TransportMode, StatusMeta> = {
  CLIENT_OWN: mk("Mijozning o'z moshinasi"),
  DEALER_ABSORBED: mk("O'zimiz to'laymiz"),
  DEALER_CHARGED: mk('Mijoz hisobiga yoziladi'),
};

// ── Payment kinds ──
export const PAYMENT_KIND: Record<PaymentKind, StatusMeta> = {
  CLIENT_IN: mk("Mijozdan to'lov"),
  CLIENT_REFUND: mk('Mijozga qaytarish'),
  FACTORY_OUT: mk("Zavodga to'lov"),
  FACTORY_REFUND: mk('Zavoddan qaytim'),
  VEHICLE_OUT: mk("Shofyorga to'lov"),
  TRANSPORT_DIRECT: mk("Mijoz shofyorga to'lagan"),
};

// ── Payment methods (composer segmented labels, 04 §3.3) ──
export const PAYMENT_METHOD: Record<PaymentMethod, StatusMeta> = {
  CASH: mk('Naqd'),
  BANK: mk('Bank'),
  CLICK: mk('Click'),
  TERMINAL: mk('Terminal'),
  CARD: mk('Karta'),
  USD: mk('USD'),
  BONUS: mk('Bonus hisobidan'),
};

// ── Price kinds (price book, allocation basis lines) ──
export const PRICE_KIND: Record<PriceKind, StatusMeta> = {
  FACTORY_CASH: mk('Zavod naqd'),
  FACTORY_BANK: mk("Zavod o'tkazma"),
  DEALER_SALE: mk('Sotuv narxi'),
};

// ── Ledger sources — statement row labels («Buyurtma savdosi · ORD-000214») ──
export const LEDGER_SOURCE: Record<LedgerSource, StatusMeta> = {
  ORDER_SALE: mk('Buyurtma savdosi'),
  ORDER_COST: mk('Buyurtma tannarxi'),
  COST_ADJUSTMENT: mk('Tannarx farqi'),
  TRANSPORT_CHARGE: mk('Transport haqi'),
  TRANSPORT_COST: mk('Transport xarajati'),
  PAYMENT: mk("To'lov"),
  PAYMENT_VOID: mk("To'lov stornosi"),
  ORDER_CANCEL: mk('Buyurtma bekor qilindi'),
  PALLET_CHARGE: mk("Paddon puli (yo'qolgan)"),
  PALLET_RETURN_CREDIT: mk('Paddon qaytarish krediti'),
  BONUS_OFFSET: mk('Bonusdan yopildi'),
  ADJUSTMENT: mk("Tuzatish (qo'lda)"),
  IMPORT: mk('Import yozuvi'),
};

// ── Ledger accounts (party sides) ──
export const LEDGER_ACCOUNT: Record<LedgerAccount, StatusMeta> = {
  CLIENT: mk('Mijoz'),
  FACTORY: mk('Zavod'),
  VEHICLE: mk('Shofyor'),
};

// ── Roles (03 §1.2 — the raw enum never renders) ──
export const ROLES: Record<Role, StatusMeta> = {
  ADMIN: mk('Administrator'),
  ACCOUNTANT: mk('Buxgalter'),
  AGENT: mk('Agent'),
  CASHIER: mk('Kassir'),
};

// ── Kassa ──
export const CASH_DIRECTION: Record<CashDirection, StatusMeta> = {
  IN: mk('Kirim'),
  OUT: mk('Chiqim'),
};

export const CASH_SOURCE: Record<CashSource, StatusMeta> = {
  MANUAL: mk("Qo'lda kiritilgan"),
  PAYMENT: mk("To'lov"),
  EXPENSE: mk('Xarajat'),
  BONUS_WITHDRAWAL: mk('Bonus yechish'),
  REVERSAL: mk('Storno'),
  TRANSFER: mk("O'tkazma", { light: '#2C6A97', dark: '#6AA8D4' }),
  CAPITAL: mk('Diller kapitali', { light: '#6D5BD0', dark: '#9B8CF0' }),
};

export const CASHBOX_TYPE: Record<CashboxType, StatusMeta> = {
  CASH: mk('Naqd'),
  BANK: mk('Bank'),
  CLICK: mk('Click'),
  TERMINAL: mk('Terminal'),
  CARD: mk('Karta'),
};

export const CURRENCY: Record<Currency, StatusMeta> = {
  UZS: mk("so'm"),
  USD: mk('USD'),
};

// ── Bonus ──
export const BONUS_PROGRAM: Record<BonusProgramKind, StatusMeta> = {
  NONE: mk("Dastur yo'q"),
  PER_M3: mk('Har m³ uchun'),
  PERCENT: mk('Foizli'),
};

export const BONUS_TX: Record<BonusTransactionType, StatusMeta> = {
  ACCRUAL: mk('Hisoblandi'),
  WITHDRAWAL: mk('Naqd yechildi'),
  DEBT_OFFSET: mk("Qarzga o'tkazildi"),
  ADJUSTMENT: mk('Tuzatish'),
  REVERSAL: mk('Storno'),
};

// ── Pallets (in-kind ledger) ──
export const PALLET_TX: Record<PalletTransactionType, StatusMeta> = {
  RECEIVED_FROM_FACTORY: mk('Zavoddan olindi'),
  DELIVERED_TO_CLIENT: mk('Mijozga yuborildi'),
  RETURNED_BY_CLIENT: mk('Mijoz qaytardi'),
  RETURNED_TO_FACTORY: mk('Zavodga qaytarildi'),
  CHARGED_LOST: mk("Pulga o'tkazildi (yo'qolgan)"),
  ADJUSTMENT: mk('Tuzatish'),
  REVERSAL: mk('Storno'),
};

// ── Legal entities ──
export const LEGAL_ENTITY_KIND: Record<LegalEntityKind, StatusMeta> = {
  DEALER: mk('Diler firmasi'),
  FACTORY: mk('Zavod firmasi'),
  THIRD_PARTY: mk('Uchinchi tomon'),
};

// ── Audit log (no UI browser yet — labels reserved) ──
export const AUDIT_ACTION: Record<AuditAction, StatusMeta> = {
  CREATE: mk('Yaratildi'),
  UPDATE: mk("O'zgartirildi"),
  DELETE: mk("O'chirildi"),
  VOID: mk('Bekor qilindi'),
  STATUS_CHANGE: mk("Holat o'zgardi"),
  COST_FINALIZE: mk('Tannarx qotirildi'),
  LOGIN: mk('Kirish'),
  LOGIN_FAILED: mk('Kirish xatosi'),
  IMPORT: mk('Import'),
  EXPORT: mk('Eksport'),
};

// ── Pseudo-status: Payment.reconciled === false (02 §2.5 last row) ──
export const UNRECONCILED: StatusMeta = mk('Tekshirilmagan', { light: '#9A6700', dark: '#D9A94A' });
