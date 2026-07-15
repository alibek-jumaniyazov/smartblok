import { Prisma } from '@prisma/client';

/** Where a parsed row came from — carried through to ImportRow for the owner's UI. */
export interface RowOrigin {
  sheetName: string; // exact, including any trailing space
  excelRow: number; // the owner's coordinate
}

/** One «Товар» shipment line (one truck; two size lines on one truck ⇒ two of these, same truck). */
export interface ShipmentRow {
  origin: RowOrigin;
  no: number | null; // col A «В-о»
  supplier: string; // col B
  agentRaw: string; // col C (NOT used for the ledger; agent comes from the client)
  clientRaw: string; // col D  (empty ⇒ MIJOZ_YOQ blocker)
  date: Date | null; // col E
  truck: string; // col F
  size: string; // col G
  cube: number | null; // col H  «Блок Куб» m³
  costPrice: Prisma.Decimal | null; // col I  «Цена Приход»
  palletQty: number | null; // col K
  palletPrice: Prisma.Decimal | null; // col L (130 000)
  salePrice: Prisma.Decimal | null; // col O  «Цена Продажа»
  diff: Prisma.Decimal | null; // col P  «Разница» (the BUGGY unit-margin — read only to flag it)
  saleSum: Prisma.Decimal | null; // col R  «Сумма Продажа» (cached = H×O)
  transport: Prisma.Decimal | null; // col S numeric part «Расход Авто»
  transportWord: string | null; // col S word: «клентдан» | «Бизадан» | «Х»
  autoPaid: string; // col U raw «Авто услу барлдми?»
  izoh: string; // col Q
}

/** One «Оплата» client payment. */
export interface ClientPaymentRow {
  origin: RowOrigin;
  date: Date | null;
  agentRaw: string;
  clientRaw: string;
  transfer: Prisma.Decimal | null; // D «ПР-Сумма» bank
  payer: string; // E «Плателщик»
  cash: Prisma.Decimal | null; // F «Накд»
  click: Prisma.Decimal | null; // L
  terminal: Prisma.Decimal | null; // M
  usd: Prisma.Decimal | null; // N
  rate: Prisma.Decimal | null; // O
  sumCol: Prisma.Decimal | null; // P «Сумма»
  other: Prisma.Decimal | null; // Q «Прочие»
  total: Prisma.Decimal | null; // R «Жами сумма» (cached)
  receiver: string; // S
  note: string; // T
}

/** One «Оплата Завод» factory payment. */
export interface FactoryPaymentRow {
  origin: RowOrigin;
  date: Date | null;
  amount: Prisma.Decimal | null; // B «Сумма»
  payer: string; // C «Платеелшик»
  receiver: string; // D «Получател» (factory entity or card №)
}

/** One per-client account sheet, with its own totals (never trusted as ledger truth). */
export interface ClientSheet {
  origin: RowOrigin; // origin.sheetName is the sheet, excelRow=1
  sheetTitle: string; // the tab name «1-Урганч Тамирлаш» (agent prefix + client)
  agentNo: number | null; // leading digit of the tab name
  displayName: string; // D1 (unreliable — copied wrong on some sheets)
  payTotal: Prisma.Decimal | null; // C5  Σ payments
  goodsTotal: Prisma.Decimal | null; // M5  Σ goods
  palletsDelivered: number | null; // K5
  palletsReturned: number | null; // E5
  balance: Prisma.Decimal | null; // F2 / B2 (payments − goods; negative = client owes)
  shoprGaBardi: Prisma.Decimal | null; // I1 «Клент шопрга барди»
}
