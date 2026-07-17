import { Prisma } from '@prisma/client';

/** Where a parsed row came from — carried through to ImportRow for the owner's UI. */
export interface RowOrigin {
  sheetName: string; // exact, including any trailing space
  excelRow: number; // the owner's coordinate
}

/** One «Лист1» journal line (one truck delivery; columns A–V, identical to the old «Товар»). */
export interface ShipmentRow {
  origin: RowOrigin;
  no: number | null; // col A «В-о»
  supplier: string; // col B «Поставшик» (really the product family, e.g. «Газоблок»)
  agentRaw: string; // col C «Агент» (cross-checked against the agent sheet that lists the client)
  clientRaw: string; // col D «Клиент» (empty ⇒ MIJOZ_YOQ blocker)
  date: Date | null; // col E
  truck: string; // col F «№ авто»
  size: string; // col G «Размер»
  cube: number | null; // col H «Блок Куб» m³
  costPrice: Prisma.Decimal | null; // col I «Цена Приход»
  palletQty: number | null; // col K «Поддон Шт»
  palletPrice: Prisma.Decimal | null; // col L (130 000)
  salePrice: Prisma.Decimal | null; // col O «Цена Продажа»
  diff: Prisma.Decimal | null; // col P «Разница» (the historically-buggy unit margin — read only to flag)
  saleSum: Prisma.Decimal | null; // col R «Сумма Продажа» (cached = H×O)
  transport: Prisma.Decimal | null; // col S numeric part «Расход Авто»
  transportWord: string | null; // col S word, when the money column holds text
  autoPaid: string; // col U raw «Авто услу барлдми?» («Туланди» ⇒ driver already paid)
  izoh: string; // col Q «ИЗОХ»
}

/**
 * One client payment from an AGENT sheet's client block (left columns A–E:
 * № / Дата / Сумма / Примечание / Возврат паддон).
 */
export interface ClientPaymentRow {
  origin: RowOrigin;
  no: number | null; // col A «№» inside the block
  date: Date | null; // col B «Дата»
  agentRaw: string; // the agent SHEET name the block lives on
  agentNo: number | null; // the digit prefix of the block header «4-Рустам Шпик»
  clientRaw: string; // the block header client name
  total: Prisma.Decimal | null; // col C «Сумма»
  payer: string; // col D «Примечание» — the paying legal entity
  palletReturn: number | null; // col E «Возврат паддон» — pallets returned in kind
  note: string; // reserved (no note column in this template)
}

/** One factory transfer from the «Утказилган пул» block on «Лист1» (date + amount pairs). */
export interface FactoryPaymentRow {
  origin: RowOrigin;
  date: Date | null;
  amount: Prisma.Decimal | null;
  payer: string; // '' — the template has no payer column
  receiver: string; // '' — the template has no receiver column
}

/** One delivery line from the RIGHT side of a client block (F–M) — reconciliation only, never staged. */
export interface LedgerDelivery {
  origin: RowOrigin;
  refNo: number | null; // col F «№» (unreliable — sometimes local, sometimes the Лист1 row no)
  date: Date | null; // col G
  truck: string; // col H «Авто»
  size: string; // col I «Размер»
  cube: number | null; // col J «Блок Куб»
  palletQty: number | null; // col K «Поддон Шт»
  price: Prisma.Decimal | null; // col L «От» (sale price per m³)
  total: Prisma.Decimal | null; // col M «Сумма» (cached = J×L)
}

/** One client block of an agent sheet: header «{agentNo}-{client}», payments left, deliveries right. */
export interface LedgerClientBlock {
  origin: RowOrigin; // the block header row
  agentNo: number | null; // digit prefix of the header (the owner's agent number)
  clientRaw: string; // client name from the header
  payments: ClientPaymentRow[];
  deliveries: LedgerDelivery[];
}

/** One per-agent account sheet (tab name = agent name). */
export interface AgentLedger {
  sheetName: string;
  agentName: string; // trimmed tab name
  clients: LedgerClientBlock[];
}

/** One row of the per-agent summary table on «Лист1» (reconciliation only, never staged). */
export interface AgentSummaryRow {
  origin: RowOrigin;
  agent: string; // «Агент»
  sales: Prisma.Decimal | null; // «Расход» — Σ sales through this agent
  paid: Prisma.Decimal | null; // «Приход» — Σ client payments collected
  balance: Prisma.Decimal | null; // «Ост» — sales − paid
  pallets: number | null; // «Паддон сони»
}
