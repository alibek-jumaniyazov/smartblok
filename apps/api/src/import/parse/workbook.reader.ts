import ExcelJS from 'exceljs';
import { readCell, type RawCell } from './cells';

/** The four fixed sheet roles; the rest are per-client account sheets. */
export const SHEET = {
  factoryPayments: 'Оплата Завод',
  svod: 'Свод Завод',
  clientPayments: 'Оплата',
  goods: 'Товар',
  blankTemplate: '0 (6)',
} as const;

const FIXED = new Set<string>([SHEET.factoryPayments, SHEET.svod, SHEET.clientPayments, SHEET.goods, SHEET.blankTemplate]);

/**
 * Thin wrapper over an exceljs workbook that hands out {@link RawCell}s. Loading
 * uses exceljs because it exposes cell TYPE and cached formula RESULT separately
 * — the one thing this workbook needs (a money column that mixes numbers and
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

  /** Per-client account sheets: everything that isn't one of the fixed roles or the blank template. */
  clientSheetNames(): string[] {
    return this.sheetNames().filter((n) => !FIXED.has(n) && !FIXED.has(n.trim()));
  }

  worksheet(name: string): ExcelJS.Worksheet {
    // exact match first, then trimmed (some tabs carry a trailing space, e.g. «2-Дастон шопир »)
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
