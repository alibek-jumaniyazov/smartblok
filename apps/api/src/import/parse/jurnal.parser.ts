import { Prisma } from '@prisma/client';
import { readDate, readInt, readMoney, readNumber, readText } from './cells';
import { WorkbookReader } from './workbook.reader';
import type { AgentSummaryRow, FactoryPaymentRow, ShipmentRow } from './types';

// «Лист1» journal columns (1-indexed). Header is on row 3; data starts on row 4.
const C = {
  no: 1, supplier: 2, agent: 3, client: 4, date: 5, truck: 6, size: 7, cube: 8,
  costPrice: 9, costSum: 10, palletQty: 11, palletPrice: 12, palletSum: 13,
  purchTotal: 14, salePrice: 15, diff: 16, izoh: 17, saleSum: 18, transport: 19,
  profit: 20, autoPaid: 21, sofFoyda: 22,
} as const;

const DATA_START = 4;

// A real «Размер» value looks like «600x300x200» (Latin or Cyrillic х) — the summary
// blocks below the table put words and counts into this column, which must not parse.
const SIZE_SHAPE = /\d\s*[xх×]\s*\d/i;

/** Parse every real delivery line of the journal. A row counts as data if it carries a
 *  cube (numeric col H) or a size-shaped «Размер» — this keeps rows whose client cell is
 *  blank (they are real trucks the owner must name; dropping them would silently
 *  unbalance the factory ledger) while skipping the totals row and the agent-summary /
 *  factory-transfer blocks that live below the table. */
export function parseJurnal(wb: WorkbookReader): ShipmentRow[] {
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);
  const rows: ShipmentRow[] = [];

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

/**
 * Locate the «Утказилган пул» block header. Free text elsewhere (e.g. a journal ИЗОХ
 * note starting with the same words) must not hijack the block, so a candidate is
 * accepted only when it LOOKS like the block: within the next 3 rows there is a row
 * whose header-column cell parses as a date and whose right neighbour is money.
 */
function locateFactoryBlock(wb: WorkbookReader): { headRow: number; headCol: number } | null {
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);
  for (let r = 1; r <= last; r++) {
    for (let c = 1; c <= 30; c++) {
      const t = readText(wb.cell(ws, r, c)).toLowerCase();
      if (!t.startsWith('утказилган') && !t.startsWith('ўтказилган')) continue;
      for (let rr = r + 1; rr <= Math.min(r + 3, last); rr++) {
        if (readDate(wb.cell(ws, rr, c)) && readMoney(wb.cell(ws, rr, c + 1)).value) {
          return { headRow: r, headCol: c };
        }
      }
      // shape mismatch (a stray note) — keep scanning
    }
  }
  return null;
}

/**
 * Factory transfers: the «Утказилган пул» block below the journal table — date+amount
 * pairs. Termination is defensive: the «Жами» label OR an amount-only row (the SUM row
 * even if its label was deleted/retyped) ends the block; a single blank spacer row is
 * tolerated, two in a row end it. A date-only row is skipped, never ingested.
 */
export function parseFactoryTransfers(wb: WorkbookReader): FactoryPaymentRow[] {
  const loc = locateFactoryBlock(wb);
  if (!loc) return [];
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);

  const rows: FactoryPaymentRow[] = [];
  let blanks = 0;
  for (let r = loc.headRow + 1; r <= last; r++) {
    const label = readText(wb.cell(ws, r, loc.headCol));
    if (/жами|jami|итого|всего/i.test(label)) break; // the block's own SUM row
    const date = readDate(wb.cell(ws, r, loc.headCol));
    const amount = readMoney(wb.cell(ws, r, loc.headCol + 1)).value;
    if (date && amount) {
      rows.push({ origin: { sheetName: ws.name, excelRow: r }, date, amount, payer: '', receiver: '' });
      blanks = 0;
    } else if (!date && amount) {
      break; // an amount without a date = the SUM row (its label was removed) — never a transfer
    } else if (date && !amount) {
      blanks = 0; // a dated row missing its amount — skip it, keep reading
    } else if (++blanks >= 2) {
      break; // two blank rows end the block; one spacer is tolerated
    }
  }
  return rows;
}

/**
 * The block's own declared total (the «Жами»/SUM row amount), for reconciliation
 * against Σ of the parsed transfers (rule ZAVOD_JAMI_FARQI). null when absent.
 */
export function parseFactoryDeclaredTotal(wb: WorkbookReader): Prisma.Decimal | null {
  const loc = locateFactoryBlock(wb);
  if (!loc) return null;
  const ws = wb.worksheet(wb.goodsSheetName());
  const last = wb.lastRow(ws);

  let blanks = 0;
  for (let r = loc.headRow + 1; r <= last; r++) {
    const label = readText(wb.cell(ws, r, loc.headCol));
    const date = readDate(wb.cell(ws, r, loc.headCol));
    const amount = readMoney(wb.cell(ws, r, loc.headCol + 1)).value;
    if (/жами|jami|итого|всего/i.test(label)) return amount;
    if (!date && amount) return amount; // label-less SUM row
    if (!date && !amount) { if (++blanks >= 2) break; } else blanks = 0;
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
