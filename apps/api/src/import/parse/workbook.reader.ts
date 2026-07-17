import ExcelJS from 'exceljs';
import { readCell, readText, type RawCell } from './cells';

/**
 * «Smart blok.xlsx» template: ONE journal sheet (usually named «Лист1») where each
 * row is a truck delivery, plus one sheet PER AGENT whose tab name is the agent's
 * name and whose body is a stack of client blocks (payments left, deliveries right).
 */
export const SHEET = {
  goods: 'Лист1',
} as const;

// Journal header row — used to recognize the journal sheet even if it is renamed.
const GOODS_HEADER_ROW = 3;
const GOODS_HEADER_MARKS = ['агент', 'клиент'];

/**
 * Thin wrapper over an exceljs workbook that hands out {@link RawCell}s. Loading
 * uses exceljs because it exposes cell TYPE and cached formula RESULT separately
 * — the one thing this workbook needs (money columns that can mix numbers and
 * words; dates stored as both serials and text).
 */
export class WorkbookReader {
  private constructor(private readonly wb: ExcelJS.Workbook) {}

  static async fromBuffer(buf: Buffer): Promise<WorkbookReader> {
    const wb = new ExcelJS.Workbook();
    // cast: Node 22's Buffer<ArrayBufferLike> vs exceljs's older Buffer typing
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    return new WorkbookReader(wb);
  }

  static async fromFile(path: string): Promise<WorkbookReader> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    return new WorkbookReader(wb);
  }

  sheetNames(): string[] {
    return this.wb.worksheets.map((w) => w.name);
  }

  /** The journal sheet: the sheet whose row 3 has the «Агент»+«Клиент» headers; the exact
   *  name «Лист1» wins only when it actually looks like the journal (an empty leftover
   *  sheet that happens to be named Лист1 must not shadow a renamed journal). */
  goodsSheetName(): string {
    const looksLikeJournal = (ws: ExcelJS.Worksheet): boolean => {
      const row = ws.getRow(GOODS_HEADER_ROW);
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (c) => cells.push(readText(readCell(c)).toLowerCase()));
      return GOODS_HEADER_MARKS.every((m) => cells.some((v) => v.includes(m)));
    };
    const exact = this.wb.getWorksheet(SHEET.goods) ?? this.wb.worksheets.find((w) => w.name.trim() === SHEET.goods);
    if (exact && looksLikeJournal(exact)) return exact.name;
    const detected = this.wb.worksheets.find(looksLikeJournal);
    if (detected) return detected.name;
    if (exact) return exact.name; // degenerate workbook: only the empty Лист1 exists
    throw new Error(`Jurnal varag'i topilmadi: «${SHEET.goods}» yo'q va hech bir varaqda «Агент»/«Клиент» sarlavhalari yo'q`);
  }

  /** Per-agent account sheets: every sheet that is not the journal. Tab name = agent name. */
  agentSheetNames(): string[] {
    const goods = this.goodsSheetName();
    return this.sheetNames().filter((n) => n !== goods);
  }

  worksheet(name: string): ExcelJS.Worksheet {
    // exact match first, then trimmed (a tab may carry a trailing space)
    let ws = this.wb.getWorksheet(name);
    if (!ws) ws = this.wb.worksheets.find((w) => w.name.trim() === name.trim());
    if (!ws) throw new Error(`Sheet not found: "${name}"`);
    return ws;
  }

  /** 1-indexed (row, col). col may be a number or a letter ("A"). */
  cell(ws: ExcelJS.Worksheet, row: number, col: number | string): RawCell {
    return readCell(ws.getRow(row).getCell(col as any));
  }

  /** Highest row index exceljs saw content on. */
  lastRow(ws: ExcelJS.Worksheet): number {
    return ws.rowCount;
  }
}
