/**
 * ═══════════════ ENUM YORLIQLARI ═══════════════
 *
 * Faylda XOM enum (`CLIENT_IN`, `ADVANCE_DRAW`) hech qachon ko'rinmasligi kerak —
 * egasi «PALLET_CHARGE» ni emas, «Паддон пули (йўқолган)» ni o'qiydi.
 *
 * Matnlar apps/web/src/lib/status-maps.ts dagi yorliqlar bilan AYNAN bir xil, chunki
 * fayl saytdagi ekranning nusxasi bo'lishi kerak: ikkalasida bitta hodisa boshqacha
 * atalsa, hisobotni ekran bilan solishtirib bo'lmaydi. U yerdagi matn o'zgarsa, shu
 * yerni ham yangilang.
 *
 * Bu yerda lotin o'zbekcha turadi — faylga yozilishdan oldin `cyr()` kirillga o'giradi.
 */
import type {
  AuditAction,
  BonusProgramKind,
  BonusTransactionType,
  CashboxType,
  CashDirection,
  CashSource,
  CostStatus,
  Currency,
  FactoryBucket,
  FactoryPayIntent,
  LedgerAccount,
  LedgerSource,
  LegalEntityKind,
  OrderStatus,
  PalletTransactionType,
  PaymentKind,
  PaymentMethod,
  PriceKind,
  Role,
  TransportMode,
  TransportPaidStatus,
} from '@prisma/client';

export const ORDER_STATUS: Record<OrderStatus, string> = {
  NEW: 'Yangi',
  CONFIRMED: 'Tasdiqlangan',
  LOADING: 'Yuklanmoqda',
  DELIVERING: 'Yetkazilmoqda',
  DELIVERED: 'Yetkazildi',
  COMPLETED: 'Yakunlandi',
  CANCELLED: 'Bekor qilingan',
};

export const COST_STATUS: Record<CostStatus, string> = {
  PROVISIONAL: "Zavodga to'lanmagan",
  PARTIAL: "Qisman to'langan",
  FINAL: "To'langan",
};

export const FACTORY_PAY_INTENT: Record<FactoryPayIntent, string> = {
  CASH: 'Naqd',
  BANK: "O'tkazma",
  UNKNOWN: 'Aniqlanmagan',
};

export const FACTORY_BUCKET: Record<FactoryBucket, string> = {
  PAYABLE: 'Mol qarzi',
  ADVANCE_CASH: 'Naqd avans',
  ADVANCE_BANK: 'Bank avansi',
};

export const TRANSPORT_MODE: Record<TransportMode, string> = {
  CLIENT_OWN: "Mijozning o'z moshinasi",
  DEALER_ABSORBED: "Shofyorga diller to'laydi",
  CLIENT_PAYS_DRIVER: "Shofyorga mijoz to'laydi",
  DEALER_CHARGED: "Summa ustiga qo'shilgan (eski)",
};

export const TRANSPORT_PAID: Record<TransportPaidStatus, string> = {
  UNPAID: "To'lanmagan",
  PAID: "To'langan",
  PAID_BY_CLIENT: "Mijoz to'lagan",
  UNKNOWN: 'Aniqlanmagan',
  NOT_APPLICABLE: '—',
};

export const PAYMENT_KIND: Record<PaymentKind, string> = {
  CLIENT_IN: "Mijozdan to'lov",
  CLIENT_REFUND: 'Mijozga qaytarish',
  FACTORY_OUT: "Zavodga to'lov",
  FACTORY_REFUND: 'Zavoddan qaytim',
  VEHICLE_OUT: "Shofyorga to'lov",
  TRANSPORT_DIRECT: "Mijoz shofyorga to'lagan",
};

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  CASH: 'Naqd',
  BANK: 'Bank',
  CLICK: '{Click}',
  TERMINAL: 'Terminal',
  CARD: 'Karta',
  USD: '{USD}',
  BONUS: 'Bonus hisobidan',
};

export const PRICE_KIND: Record<PriceKind, string> = {
  FACTORY_CASH: 'Zavod naqd',
  FACTORY_BANK: "Zavod o'tkazma",
  DEALER_SALE: 'Sotuv narxi',
};

export const LEDGER_ACCOUNT: Record<LedgerAccount, string> = {
  CLIENT: 'Mijoz',
  FACTORY: 'Zavod',
  VEHICLE: 'Shofyor',
};

export const LEDGER_SOURCE: Record<LedgerSource, string> = {
  ORDER_SALE: 'Buyurtma savdosi',
  ORDER_COST: 'Buyurtma tannarxi',
  COST_ADJUSTMENT: 'Tannarx farqi',
  TRANSPORT_CHARGE: 'Transport haqi',
  TRANSPORT_COST: 'Transport xarajati',
  TRANSPORT_CLIENT_DIRECT: "Shofyorga mijoz to'laydi (summa ichidan)",
  PAYMENT: "To'lov",
  PAYMENT_VOID: "To'lov stornosi",
  ORDER_CANCEL: 'Buyurtma bekor qilindi',
  PALLET_CHARGE: "Paddon puli (yo'qolgan)",
  PALLET_RETURN_CREDIT: 'Paddon qaytarish krediti',
  BONUS_OFFSET: 'Bonusdan yopildi',
  ADVANCE_DRAW: 'Avansdan yechildi',
  ADJUSTMENT: "Tuzatish (qo'lda)",
  OFFBOOK_ADJUSTMENT: 'Balans tuzatildi (hisobotdan tashqari)',
  IMPORT: 'Import yozuvi',
};

export const PALLET_TX: Record<PalletTransactionType, string> = {
  RECEIVED_FROM_FACTORY: 'Zavoddan olindi',
  DELIVERED_TO_CLIENT: 'Mijozga yuborildi',
  RETURNED_BY_CLIENT: 'Mijoz qaytardi',
  RETURNED_TO_FACTORY: 'Zavodga qaytarildi',
  CHARGED_LOST: "Pulga o'tkazildi (yo'qolgan)",
  ADJUSTMENT: 'Tuzatish',
  REVERSAL: 'Storno',
};

export const CASH_DIRECTION: Record<CashDirection, string> = {
  IN: 'Kirim',
  OUT: 'Chiqim',
};

export const CASH_SOURCE: Record<CashSource, string> = {
  MANUAL: "Qo'lda kiritilgan",
  PAYMENT: "To'lov",
  EXPENSE: 'Xarajat',
  BONUS_WITHDRAWAL: 'Bonus yechish',
  REVERSAL: 'Storno',
  TRANSFER: "O'tkazma",
  CAPITAL: 'Diller kapitali',
  BALANCE_ADJUSTMENT: 'Balans tuzatildi',
};

export const CASHBOX_TYPE: Record<CashboxType, string> = {
  CASH: 'Naqd',
  BANK: 'Bank',
  CLICK: '{Click}',
  TERMINAL: 'Terminal',
  CARD: 'Karta',
};

export const CURRENCY: Record<Currency, string> = {
  UZS: "so'm",
  USD: '{USD}',
};

export const BONUS_PROGRAM: Record<BonusProgramKind, string> = {
  NONE: "Dastur yo'q",
  PER_M3: 'Har m³ uchun',
  PERCENT: 'Foizli',
};

export const BONUS_TX: Record<BonusTransactionType, string> = {
  ACCRUAL: 'Hisoblandi',
  WITHDRAWAL: 'Naqd yechildi',
  DEBT_OFFSET: "Qarzga o'tkazildi",
  ADJUSTMENT: 'Tuzatish',
  REVERSAL: 'Storno',
};

export const LEGAL_ENTITY_KIND: Record<LegalEntityKind, string> = {
  DEALER: 'Diler firmasi',
  FACTORY: 'Zavod firmasi',
  THIRD_PARTY: 'Uchinchi tomon',
};

export const ROLES: Record<Role, string> = {
  ADMIN: 'Administrator',
  ACCOUNTANT: 'Buxgalter',
  AGENT: 'Agent',
  CASHIER: 'Kassir',
};

export const AUDIT_ACTION: Record<AuditAction, string> = {
  CREATE: 'Yaratildi',
  UPDATE: "O'zgartirildi",
  DELETE: "O'chirildi",
  VOID: 'Bekor qilindi',
  STATUS_CHANGE: "Holat o'zgardi",
  COST_FINALIZE: 'Tannarx qotirildi',
  LOGIN: 'Kirish',
  LOGIN_FAILED: 'Kirish xatosi',
  IMPORT: 'Import',
  EXPORT: 'Eksport',
};

/**
 * ═══ KIRILLGA O'GIRISH CHEGARASI ═══
 *
 * Faylda ikki xil matn bor va ular BOSHQACHA muomala talab qiladi:
 *
 *   • DASTUR MATNI (sarlavha, enum yorlig'i, «Ha/Yo'q», «Faol») — kirillga o'giriladi.
 *   • SAQLANGAN MATN (mijoz nomi, izoh, davlat raqami) — hech qachon o'girilmaydi.
 *     Ism — bu identifikator; uni o'girish uni boshqa satrga aylantiradi va faylni
 *     bazaga qaytarib solishtirib bo'lmay qoladi.
 *
 * Shuning uchun o'girish shu quyidagi funksiyalar ichida, ya'ni FAQAT dastur matnida
 * sodir bo'ladi. Varaq yozuvchilar xom qatorlarni to'g'ridan-to'g'ri yozadi.
 */
import { cyr } from '../../common/translit';

/** Kod ichidagi yakka lotin yorlig'ini kirillga o'giradi. */
export const L = (latin: string): string => cyr(latin);

export const YES_NO = (v: boolean | null | undefined): string => cyr(v ? 'Ha' : "Yo'q");
export const ACTIVE = (v: boolean | null | undefined): string => cyr(v ? 'Faol' : 'Nofaol');

/** Xarita bo'yicha yorliq; noma'lum qiymat kelsa xom enum qaytadi (yo'qolib ketmasin). */
export const label = <K extends string>(map: Record<K, string>, key: K | null | undefined): string | null =>
  key == null ? null : cyr(map[key] ?? String(key));

/** Xaritadagi yorliqning kirillcha ko'rinishi — Excel formulasidagi shart uchun kerak. */
export const labelOf = <K extends string>(map: Record<K, string>, key: K): string => cyr(map[key]);
