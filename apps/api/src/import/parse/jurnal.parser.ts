import { Prisma } from '@prisma/client';
import { readDate, readInt, readMoney, readNumber, readText } from './cells';
import { WorkbookReader } from './workbook.reader';
import type { AgentSummaryRow, FactoryPaymentRow, FactorySummaryDeclared, ShipmentRow } from './types';

// «Лист1» journal columns (1-indexed). Header is on row 3; data starts on row 4.
const C = {
  no: 1, supplier: 2, agent: 3, client: 4, date: 5, truck: 6, size: 7, cube: 8,
  costPrice: 9, costSum: 10, palletQty: 11, palletPrice: 12, palletSum: 13,
  purchTotal: 14, salePrice: 15, diff: 16, izoh: 17, saleSum: 18, transport: 19,
  profit: 20, autoPaid: 21, sofFoyda: 22,
} as const;

const DATA_START = 4;
const HEADER_ROW = 3;

/**
 * The two columns the owner added on 2026-07-29 (W «Завотга толов» · X «тўлов тури»).
 *
 * They are located by HEADER TEXT, never by a fixed index — unlike A..V, which have sat in
 * place since the first template, these are new and the owner is still shaping the sheet.
 * A hardcoded W/X would keep reading the same two cells after he inserts one column, and the
 * damage would be silent: every truck would take its neighbour's payment and channel.
 */
// «Завотга толов» — the owner's spelling; «Заводга tўлов» and friends must read too. No other
// header on this sheet carries «завод»/«завот», so the pair is unambiguous.
const PAID_HEADER = /завот|завод/;
const PAID_HEADER_2 = /тол|тўл|тул/;
/** «тўлов тури» — «тури» («type») is the distinguishing word; the money column has none. */
const CHANNEL_HEADER = /тури/;

/** normalize a header cell for matching: lowercase, newlines/spaces collapsed */
const headerKey = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface OrderPayColumns {
  /** col W — «Завотга толов» */
  paidCol: number;
  /** col X — «тўлов тури»; null when the owner added the money column but not the channel one */
  channelCol: number | null;
}

/**
 * Find «Завотга толов» / «тўлов тури» on the header row. Returns null on a file that predates
 * them — which is what switches the commit back to the old block-FIFO settlement, so the owner
 * can still re-import his July files and get the same numbers he got then.
 */
export function locateOrderPayColumns(wb: WorkbookReader): OrderPayColumns | null {
  const ws = wb.worksheet(wb.goodsSheetName());
  let paidCol = 0;
  let channelCol: number | null = null;
  for (let c = 1; c <= 40; c++) {
    const t = headerKey(readText(wb.cell(ws, HEADER_ROW, c)));
    if (!t) continue;
    if (!paidCol && PAID_HEADER.test(t) && PAID_HEADER_2.test(t)) { paidCol = c; continue; }
    // «тўлов тури» must be a header of its OWN — the money column's own text also ends in
    // «толов», so the channel is only accepted once the money column has been claimed
    if (paidCol && channelCol === null && CHANNEL_HEADER.test(t)) channelCol = c;
  }
  return paidCol ? { paidCol, channelCol } : null;
}

// A real «тўлов тури» value is a channel word, not a number or a stray note.
const CHANNEL_SHAPE = /^[\p{L} '’`.\-]{2,20}$/u;

// A real «Размер» value looks like «600x300x200» (Latin or Cyrillic х) — the summary
// blocks below the table put words and counts into this column, which must not parse.
const SIZE_SHAPE = /\d\s*[xх×]\s*\d/i;

/** The «Утказилган пул» block's own SUM-row label, in every spelling the owner has used. */
const TOTAL_LABEL = /жами|jami|итого|всего/i;
/** How many rows under the header are probed to confirm the block AND read its layout. */
const FACTORY_CONFIRM_ROWS = 3;

/** Parse every real delivery line of the journal. A row counts as data if it carries a
 *  cube (numeric col H) or a size-shaped «Размер» — this keeps rows whose client cell is
 *  blank (they are real trucks the owner must name; dropping them would silently
 *  unbalance the factory ledger) while skipping the totals row and the agent-summary /
 *  factory-transfer blocks that live below the table. */
export function parseJurnal(wb: WorkbookReader): ShipmentRow[] {
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);
  const rows: ShipmentRow[] = [];
  const pay = locateOrderPayColumns(wb);

  for (let r = DATA_START; r <= last; r++) {
    const size = readText(wb.cell(ws, r, C.size));
    const cube = readNumber(wb.cell(ws, r, C.cube));
    if (cube === null && !SIZE_SHAPE.test(size)) continue; // totals / summary / empty row

    const no = readInt(wb.cell(ws, r, C.no));
    const clientRaw = readText(wb.cell(ws, r, C.client));
    const truck = readText(wb.cell(ws, r, C.truck));
    // an aggregate row (e.g. a SUM someone added to col H) has no №, no client, no truck,
    // no size — a real half-filled truck row always carries at least one of those
    if (no === null && !clientRaw && !truck && !size) continue;

    const s = wb.cell(ws, r, C.transport);
    const money = readMoney(s);

    // W/X. `null` paid ⇒ «this file has no such column», which is NOT the same as a 0 the
    // owner typed (0 = «bu buyurtma bo'yicha zavodga to'lov qilinmagan»). Keeping the two
    // apart is what lets a legacy file fall back to block-FIFO while this one settles per row.
    const factoryPaid = pay ? readMoney(wb.cell(ws, r, pay.paidCol)).value ?? new Prisma.Decimal(0) : null;
    const channelRaw = pay && pay.channelCol !== null ? readText(wb.cell(ws, r, pay.channelCol)) : '';
    const factoryPayChannel = CHANNEL_SHAPE.test(channelRaw) ? channelRaw : '';

    rows.push({
      origin: { sheetName: ws.name, excelRow: r },
      no,
      supplier: readText(wb.cell(ws, r, C.supplier)),
      agentRaw: readText(wb.cell(ws, r, C.agent)),
      clientRaw,
      date: readDate(wb.cell(ws, r, C.date)),
      truck,
      size,
      cube,
      costPrice: readMoney(wb.cell(ws, r, C.costPrice)).value,
      palletQty: readInt(wb.cell(ws, r, C.palletQty)),
      palletPrice: readMoney(wb.cell(ws, r, C.palletPrice)).value,
      salePrice: readMoney(wb.cell(ws, r, C.salePrice)).value,
      diff: readMoney(wb.cell(ws, r, C.diff)).value,
      saleSum: readMoney(wb.cell(ws, r, C.saleSum)).value,
      transport: money.value,
      transportWord: money.text,
      autoPaid: readText(wb.cell(ws, r, C.autoPaid)),
      izoh: readText(wb.cell(ws, r, C.izoh)),
      factoryPaid,
      factoryPayChannel,
    });
  }
  return rows;
}

/** The journal's own totals row, as the sheet declares it (nulls where the cell is empty). */
export interface JurnalDeclaredTotals {
  excelRow: number;
  cube: Prisma.Decimal | null; // H
  costSum: Prisma.Decimal | null; // J
  palletQty: Prisma.Decimal | null; // K
  saleSum: Prisma.Decimal | null; // R
  transport: Prisma.Decimal | null; // S
  grossProfit: Prisma.Decimal | null; // T «Общая прибль»
  netProfit: Prisma.Decimal | null; // V «Соф фойда»
}

/**
 * Read the SUM row that sits directly under the journal table — the numbers the owner
 * actually looks at when he checks the site against his file.
 *
 * It is found by shape, not by a fixed row: the first row below the data whose «Блок Куб»
 * cell holds a number. Returns null when the file has no totals row at all.
 */
export function parseJurnalDeclaredTotals(wb: WorkbookReader, shipments: ShipmentRow[]): JurnalDeclaredTotals | null {
  if (!shipments.length) return null;
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);
  const start = Math.max(...shipments.map((r) => r.origin.excelRow)) + 1;
  for (let r = start; r <= Math.min(start + 5, last); r++) {
    const cube = readMoney(wb.cell(ws, r, C.cube)).value;
    if (!cube) continue;
    const at = (c: number) => readMoney(wb.cell(ws, r, c)).value;
    return {
      excelRow: r,
      cube,
      costSum: at(C.costSum),
      palletQty: at(C.palletQty),
      saleSum: at(C.saleSum),
      transport: at(C.transport),
      grossProfit: at(C.profit),
      netProfit: at(C.sofFoyda),
    };
  }
  return null;
}

/** Where the «Утказилган пул» block sits and WHICH of its two layouts the file uses. */
interface FactoryBlockLoc {
  headRow: number;
  dateCol: number;
  /** null on the legacy 2-column file that had no channel column */
  channelCol: number | null;
  amountCol: number;
}

/**
 * Locate the «Утказилган пул» block header AND decide its layout. Free text elsewhere
 * (e.g. a journal ИЗОХ note starting with the same words) must not hijack the block, so a
 * candidate is accepted only when it LOOKS like the block: within the next 3 rows there is
 * a row whose header-column cell parses as a date and which has money to its right.
 *
 * TWO layouts must parse — the owner reshaped this block on 2026-07-27:
 *
 *   legacy  J=sana | K=summa
 *   hozirgi J=sana | K=kanal («bank»/«naxt»/«click») | L=summa
 *
 * Both are supported because the owner re-imports his older files and the goldens replay
 * them. The layout is VOTED on rather than taken from the first hit: the neighbour column
 * is the amount when it holds money (2-col), otherwise the amount sits one further right
 * (3-col — the neighbour then holds the channel word, or nothing when he left it blank).
 * A tie goes to the 2-col reading, the historical shape.
 *
 * The header cell is merged (J156:K156) in BOTH files, so exceljs reports the same text in
 * the slave cell K156. Scanning columns left-to-right makes the master (J) win, and the
 * slave can never confirm on its own because K157 holds «bank», not a date.
 */
function locateFactoryBlock(wb: WorkbookReader): FactoryBlockLoc | null {
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);
  for (let r = 1; r <= last; r++) {
    for (let c = 1; c <= 30; c++) {
      const t = readText(wb.cell(ws, r, c)).toLowerCase();
      if (!t.startsWith('утказилган') && !t.startsWith('ўтказилган')) continue;
      let two = 0; // sana | SUMMA
      let three = 0; // sana | kanal | SUMMA
      for (let rr = r + 1; rr <= Math.min(r + FACTORY_CONFIRM_ROWS, last); rr++) {
        if (!readDate(wb.cell(ws, rr, c))) continue;
        if (readMoney(wb.cell(ws, rr, c + 1)).value) two++;
        else if (readMoney(wb.cell(ws, rr, c + 2)).value) three++;
      }
      if (!two && !three) continue; // shape mismatch (a stray note) — keep scanning
      return two >= three
        ? { headRow: r, dateCol: c, channelCol: null, amountCol: c + 1 }
        : { headRow: r, dateCol: c, channelCol: c + 1, amountCol: c + 2 };
    }
  }
  return null;
}

/**
 * TRUE when the «Утказилган пул» header text exists on the journal sheet at all — which is
 * what lets the ZAVOD_BLOKI_OQILMADI rule tell «bu faylda zavod bloki yo'q» apart from
 * «blok bor, lekin o'qilmadi». The 2026-07-27 layout change was 100% SILENT precisely
 * because nothing could tell those two apart: 3 027 089 420 so'm vanished behind a clean,
 * blocker-free preview.
 */
export function factoryBlockHeaderExists(wb: WorkbookReader): boolean {
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);
  for (let r = 1; r <= last; r++) {
    for (let c = 1; c <= 30; c++) {
      const t = readText(wb.cell(ws, r, c)).toLowerCase();
      if (t.startsWith('утказилган') || t.startsWith('ўтказилган')) return true;
    }
  }
  return false;
}

/**
 * Factory transfers: the «Утказилган пул» block below the journal table — date+amount
 * pairs, plus the channel word when the file carries one (see locateFactoryBlock).
 *
 * Termination is defensive: the «Жами» label in EITHER the date or the channel column (the
 * current SUM row is J178=«Жами» K178=«Жами» L178=SUM, and K178 is only a merge slave) OR
 * an amount-only row (the SUM row even if its label was deleted/retyped) ends the block; a
 * single blank spacer row is tolerated, two in a row end it. A half-filled row — a date
 * with no amount, or a channel typed ahead of the numbers — is skipped, never ingested, and
 * does NOT count as blank: swallowing two of those would drop every transfer below them.
 */
export function parseFactoryTransfers(wb: WorkbookReader): FactoryPaymentRow[] {
  return readFactoryBlock(wb).rows;
}

/**
 * The block's own declared total (the «Жами»/SUM row amount), for reconciliation
 * against Σ of the parsed transfers (rule ZAVOD_JAMI_FARQI). null when absent.
 */
export function parseFactoryDeclaredTotal(wb: WorkbookReader): Prisma.Decimal | null {
  return readFactoryBlock(wb).declaredTotal;
}

/** 1-indexed column number → Excel letter ("L"). */
function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = (x - m - 1) / 26; }
  return s;
}

/**
 * Which rows of the amount column a «Жами» formula actually adds up.
 *
 * Two shapes exist in the owner's files and both must read: `=SUM(L157:L177)` (everything)
 * and the hand-typed `=L178+L179+…+L200` chain he switched to on 2026-07-29, which skips two
 * rows. Returns null when nothing recognizable is found — the caller then treats every row as
 * counted, because a formula we failed to understand must never be allowed to delete money.
 */
export function rowsCoveredByFormula(formula: string | undefined, amountCol: number): Set<number> | null {
  if (!formula) return null;
  const letter = colLetter(amountCol);
  const f = formula.toUpperCase().trim();
  // exceljs reports a SHARED-formula slave as `{ sharedFormula: '<master address>' }`, i.e. a
  // bare cell reference. Reading that as «the total adds up exactly row 178» would delete
  // every other transfer, so a lone reference is treated as «unknown coverage».
  if (/^\$?[A-Z]{1,3}\$?\d+$/.test(f)) return null;
  const rows = new Set<number>();
  // ranges first (SUM(L157:L177)), then strip them so their endpoints are not re-counted
  const rangeRe = /\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(f))) {
    if (m[1] !== letter && m[3] !== letter) continue;
    const a = Number(m[2]);
    const b = Number(m[4]);
    for (let r = Math.min(a, b); r <= Math.max(a, b); r++) rows.add(r);
  }
  const single = f.replace(rangeRe, ' ');
  // a bare cell ref: not preceded by a letter/digit (so «SUM(» and sheet names don't match)
  // and not followed by «(» (a function name like LOG10 can never reach here anyway)
  const cellRe = /(?<![A-Z0-9$!])\$?([A-Z]{1,3})\$?(\d+)(?![A-Z0-9(])/g;
  while ((m = cellRe.exec(single))) {
    if (m[1] === letter) rows.add(Number(m[2]));
  }
  return rows.size ? rows : null;
}

/**
 * One pass over the «Утказилган пул» block: the transfer rows, the «Жами» cell, and WHICH
 * rows that cell adds up. Both public readers go through here so they can never disagree
 * about where the block ends — the failure that made a stale declared total look like a
 * parser bug and vice-versa.
 *
 * Termination is defensive: the «Жами» label in EITHER the date or the channel column (the
 * current SUM row is J201=«Жами» K201=«Жами» L201=formula, and K201 is only a merge slave) OR
 * an amount-only row (the SUM row even if its label was deleted/retyped) ends the block; a
 * single blank spacer row is tolerated, two in a row end it. A half-filled row — a date with
 * no amount, or a channel typed ahead of the numbers — is skipped, never ingested, and does
 * NOT count as blank: swallowing two of those would drop every transfer below them.
 */
function readFactoryBlock(wb: WorkbookReader): { rows: FactoryPaymentRow[]; declaredTotal: Prisma.Decimal | null } {
  const loc = locateFactoryBlock(wb);
  if (!loc) return { rows: [], declaredTotal: null };
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);

  const raw: Array<{ row: number; date: Date; amount: Prisma.Decimal; channel: string }> = [];
  let declaredTotal: Prisma.Decimal | null = null;
  let totalFormula: string | undefined;
  let blanks = 0;
  for (let r = loc.headRow + 1; r <= last; r++) {
    const label = readText(wb.cell(ws, r, loc.dateCol));
    // '' on the legacy 2-column file — the commit then reads BANK, exactly as it always did
    const channel = loc.channelCol === null ? '' : readText(wb.cell(ws, r, loc.channelCol));
    const date = readDate(wb.cell(ws, r, loc.dateCol));
    const amountCell = wb.cell(ws, r, loc.amountCol);
    const amount = readMoney(amountCell).value;
    if (TOTAL_LABEL.test(label) || TOTAL_LABEL.test(channel)) { // the block's own SUM row
      declaredTotal = amount;
      totalFormula = amountCell.f;
      break;
    }
    if (date && amount) {
      raw.push({ row: r, date, amount, channel });
      blanks = 0;
    } else if (!date && amount) {
      declaredTotal = amount; // label-less SUM row — never a transfer
      totalFormula = amountCell.f;
      break;
    } else if (date || channel) {
      blanks = 0; // half-filled row (dated but unpriced, or a channel typed ahead) — skip, keep reading
    } else if (++blanks >= 2) {
      break; // two blank rows end the block; one spacer is tolerated
    }
  }

  const covered = rowsCoveredByFormula(totalFormula, loc.amountCol);
  const rows: FactoryPaymentRow[] = raw.map((t) => ({
    origin: { sheetName: ws.name, excelRow: t.row },
    date: t.date,
    amount: t.amount,
    channel: t.channel,
    payer: '',
    receiver: '',
    inDeclaredTotal: covered === null ? true : covered.has(t.row),
  }));
  return { rows, declaredTotal };
}

/** «Олинган»/«Берилган» — the words that head the owner's «Завод» summary block. */
const TAKEN_LABEL = /^олинган$/i;
const GIVEN_LABEL = /^берилган$/i;
const CASH_LABEL = /^(нахт|нақт|нақд|накд|naqd|naxt)$/i;
const BANK_LABEL = /^(банк|bank|ўтказма|утказма)$/i;

/**
 * Read the «Завод» summary block (see FactorySummaryDeclared). Located by its «Олинган» +
 * «Берилган» header pair anywhere on the journal sheet, so it survives the owner moving it —
 * he shifted it from M156 to M177 between two files without changing anything else.
 *
 * Everything is nullable on purpose: this block is the owner's own arithmetic, and the import
 * quotes it back at him rather than trusting it. Its numbers never reach the ledger.
 */
export function parseFactorySummary(wb: WorkbookReader): FactorySummaryDeclared | null {
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);
  for (let r = 1; r <= last; r++) {
    for (let c = 1; c <= 30; c++) {
      if (!TAKEN_LABEL.test(readText(wb.cell(ws, r, c)))) continue;
      if (!GIVEN_LABEL.test(readText(wb.cell(ws, r, c + 1)))) continue;
      const at = (rr: number, cc: number) => readMoney(wb.cell(ws, rr, cc)).value;
      let remainingCash: Prisma.Decimal | null = null;
      let remainingBank: Prisma.Decimal | null = null;
      // «Нахт | банк» yorliqlari qolgan qatorining ostida, 1..3 qator ichida
      for (let rr = r + 2; rr <= Math.min(r + 5, last); rr++) {
        if (CASH_LABEL.test(readText(wb.cell(ws, rr, c))) && BANK_LABEL.test(readText(wb.cell(ws, rr, c + 1)))) {
          remainingCash = at(rr + 1, c);
          remainingBank = at(rr + 1, c + 1);
          break;
        }
      }
      return {
        origin: { sheetName: ws.name, excelRow: r },
        goodsTaken: at(r + 1, c),
        transferred: at(r + 1, c + 1),
        remaining: at(r + 2, c),
        remainingCash,
        remainingBank,
      };
    }
  }
  return null;
}

/**
 * Per-agent summary table below the journal («Агент | Расход | Приход | Ост | Паддон сони»)
 * — reconciliation data only, never staged. Located by its «Агент» header text with the
 * «Расход…» neighbour as a shape check.
 */
export function parseAgentSummary(wb: WorkbookReader): AgentSummaryRow[] {
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);

  let headRow = 0;
  let headCol = 0;
  outer: for (let r = DATA_START; r <= last; r++) {
    for (let c = 1; c <= 15; c++) {
      if (readText(wb.cell(ws, r, c)).toLowerCase() !== 'агент') continue;
      const next = readText(wb.cell(ws, r, c + 1)).toLowerCase();
      if (next.startsWith('расход')) {
        headRow = r;
        headCol = c;
        break outer;
      }
    }
  }
  if (!headRow) return [];

  const rows: AgentSummaryRow[] = [];
  for (let r = headRow + 1; r <= last; r++) {
    const agent = readText(wb.cell(ws, r, headCol));
    if (!agent) break; // the totals row below has an empty agent cell
    rows.push({
      origin: { sheetName: ws.name, excelRow: r },
      agent,
      sales: readMoney(wb.cell(ws, r, headCol + 1)).value,
      paid: readMoney(wb.cell(ws, r, headCol + 2)).value,
      balance: readMoney(wb.cell(ws, r, headCol + 3)).value,
      pallets: readInt(wb.cell(ws, r, headCol + 4)),
    });
  }
  return rows;
}
