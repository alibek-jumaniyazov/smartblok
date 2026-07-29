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
  /**
   * col W «Завотга толов» (2026-07-29) — how much of THIS truck's factory cost is already
   * paid. The owner's rule, in his words: «Сумма Приход 15 552 000 va Завотга толов
   * 15 552 000 ⇒ bu buyurtma full zavodga to'langan, qarzdor emasmiz»; «Завотга толов 0 ⇒
   * bu buyurtma zavodga qarzimizga qo'shiladi». Partial amounts are real (r90: 4 109 024 of
   * 13 420 080), so this is a MONEY column, not a paid/unpaid flag.
   *
   * null ⇒ the file predates the column (the whole journal then falls back to the old
   * oldest-order-first settlement of the «Утказилган пул» block).
   */
  factoryPaid: Prisma.Decimal | null;
  /**
   * col X «тўлов тури» — the channel that truck is settled through («Банк» / «Нахт»).
   * It is NOT decoration: it decides the order's factoryPayIntent, which cost-price book the
   * truck is anchored to (naqd is genuinely cheaper — 08.07: bank 593 750 · naqd 517 750),
   * and which side of the Qarzlar page an unpaid truck lands on. '' when the column is absent.
   */
  factoryPayChannel: string;
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
  /**
   * The block header VERBATIM («6-Нахт клент Сардор»). The owner encodes the payment channel
   * in the block name for his walk-in accounts, so it is a second, independent cash signal —
   * a row inside a «Нахт клент …» block is naqd even when its «Примечание» cell only names a
   * person. Without it the classifier depends entirely on one free-text cell.
   */
  blockName: string;
  /** col D verbatim — what the owner actually typed («Нахт», «Клик», «шопр учун барди», a firm name) */
  note: string;
}

/** One factory transfer from the «Утказилган пул» block on «Лист1» (sana + kanal + summa). */
export interface FactoryPaymentRow {
  origin: RowOrigin;
  date: Date | null;
  amount: Prisma.Decimal | null;
  /**
   * The channel word the owner typed next to the date («bank», «naxt», «click») — VERBATIM
   * and un-normalized, exactly like ClientPaymentRow.note. Turning it into a PaymentMethod
   * (and therefore into an ADVANCE_CASH vs ADVANCE_BANK pocket, and into WHICH kassa the
   * money left) is the commit's job, not the parser's.
   *
   * '' when the file uses the older 2-column layout that had no such column — which is
   * precisely that layout's meaning, «bank o'tkazmasi».
   */
  channel: string;
  payer: string; // '' — the block has no payer column (the channel word lives in `channel`)
  receiver: string; // '' — the template has no receiver column
  /**
   * FALSE when the block's own «Жами» cell does not add this row up (2026-07-29: the owner
   * replaced the old `=SUM(L157:L177)` with a hand-typed `=L178+L179+…+L200` chain that skips
   * L195 «Нахт» 6 000 000 and L196 «Клик» 50 000 000 — so his file declares 3 371 089 420,
   * not the 3 427 089 420 the rows add up to).
   *
   * Owner's decision (2026-07-29): «Жами»ga amal qilinadi — a row outside it is NOT money the
   * factory received, so it is not imported. It is never dropped silently: ZAVOD_JAMIDAN_TASHQARI
   * names every excluded row and its som in the review.
   *
   * TRUE for every row when the «Жами» cell is a plain number or its formula cannot be read —
   * the historical behaviour, and the only safe default (a mis-read formula must never delete
   * money).
   */
  inDeclaredTotal: boolean;
}

/**
 * The «Завод» summary block the owner keeps to the right of the agent svodka on «Лист1»:
 *
 *     Завод      Завод
 *     Олинган    Берилган
 *     3 035 493 990   3 371 089 420
 *     335 595 430            ← qolgan (merged over both columns)
 *     Нахт       банк
 *     0          335 595 430  ← qolganning kanal boʼyicha taqsimoti
 *
 * Reconciliation only — never staged. It is the first thing the owner checks, so the import
 * states his own numbers next to the computed ones (ZAVOD_QOLDIGI) instead of leaving him to
 * spot a difference himself.
 */
export interface FactorySummaryDeclared {
  origin: RowOrigin;
  goodsTaken: Prisma.Decimal | null; // «Олинган»
  transferred: Prisma.Decimal | null; // «Берилган»
  remaining: Prisma.Decimal | null; // Берилган − Олинган
  remainingCash: Prisma.Decimal | null; // «Нахт» ulushi (null — fayl bu qatorni yozmagan)
  remainingBank: Prisma.Decimal | null; // «банк» ulushi
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
  /**
   * col N — the per-truck transport fee, present on 27 of 149 delivery rows (Сардор/Темур/Зафар).
   * Reconciliation evidence only: 24 of the 27 match «Лист1» col S to the som, so a mismatch is
   * a real typo on one of the two sheets rather than a modelling question.
   */
  transportN: Prisma.Decimal | null;
  /**
   * col O — the owner's free-text note on WHO funded that truck («Бзадан» = «bizdan», from us).
   * Only «Сардор ога» r57–r60 carry it today, and they agree with the derived split — kept so
   * the evidence is visible instead of inferred.
   */
  fundingWord: string;
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
  /**
   * «Клент шопрга барди:» — the cell the owner added to each agent sheet on 2026-07-29. It is
   * `SUMIFS(C:C, D:D, "шопр учун барди")`: how much of that agent's collections the CLIENT
   * handed straight to the driver instead of into our till.
   *
   * Reconciliation only, never staged — the import classifies each row itself (isDriverHandover,
   * which also catches «Шопир пули 5%» and «Клентни Ози Шовйор», spellings the SUMIFS's literal
   * text filter misses). SHOFYOR_PULI_FARQI reports the two numbers side by side so a future
   * mis-classification shows up as a difference instead of as a quietly wrong kassa.
   *
   * null when that sheet has no such cell (the owner did not add it everywhere).
   */
  driverDeclared: Prisma.Decimal | null;
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
