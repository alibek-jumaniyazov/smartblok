import { Prisma } from '@prisma/client';
import type { Cell, ValueType } from 'exceljs';

const D = Prisma.Decimal;

/**
 * A cell read WITHOUT coercion. The workbook mixes data types inside a single
 * column (the journal's transport column holds numbers AND words like
 * «клентдан»/«Туланди»; dates appear both as Excel serials and as "dd.mm.yyyy"
 * text). Every reader below preserves the distinction the raw sheet makes — a
 * word in a money column becomes `{ value: null, text: "клентдан" }`, never a
 * silent 0.
 */
export interface RawCell {
  /** underlying value: number | string | Date | boolean | null */
  v: number | string | Date | boolean | null;
  /** 'n' number · 's' string · 'd' date · 'b' bool · 'null' empty */
  t: 'n' | 's' | 'd' | 'b' | 'null';
  /** the original formula text, if this was a formula cell */
  f?: string;
}

// exceljs ValueType enum values (avoids importing the runtime enum object)
const VT = { Null: 0, Merge: 1, Number: 2, String: 3, Date: 4, Hyperlink: 5, Formula: 6, SharedString: 7, RichText: 8, Boolean: 9, Error: 10 } as const;

/** Normalize an exceljs Cell into a RawCell, unwrapping formula cells to their cached result. */
export function readCell(cell: Cell | undefined | null): RawCell {
  if (!cell) return { v: null, t: 'null' };
  const type = cell.type as ValueType as number;

  if (type === VT.Formula) {
    const val = cell.value as any;
    const f = typeof val?.formula === 'string' ? val.formula
      : typeof val?.sharedFormula === 'string' ? val.sharedFormula
      : undefined;
    const r = (cell as any).result;
    return { ...classify(r), f };
  }
  if (type === VT.RichText) {
    const parts = (cell.value as any)?.richText ?? [];
    const text = parts.map((p: any) => p.text ?? '').join('');
    return { v: text, t: 's' };
  }
  if (type === VT.Hyperlink) {
    const text = (cell.value as any)?.text ?? '';
    return { v: String(text), t: 's' };
  }
  return classify(cell.value);
}

function classify(v: unknown): RawCell {
  if (v === null || v === undefined || v === '') return { v: null, t: 'null' };
  if (v instanceof Date) return { v, t: 'd' };
  if (typeof v === 'number') return { v, t: 'n' };
  if (typeof v === 'boolean') return { v, t: 'b' };
  if (typeof v === 'object') {
    const o = v as any;
    if ('error' in o) return { v: null, t: 'null' }; // #REF! etc.
    if ('result' in o) return classify(o.result);
    if ('richText' in o) return { v: (o.richText ?? []).map((p: any) => p.text ?? '').join(''), t: 's' };
    if ('text' in o) return { v: String(o.text), t: 's' };
  }
  return { v: String(v), t: 's' };
}

/** Excel serial date (1900 system, with the Lotus leap-year bug) → UTC Date.
 *  floor, not round: a serial with a time-of-day fraction (≥12:00) must not shift a day. */
export function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
}

/**
 * Excel serial, JS Date, or "dd.mm.yyyy" text → Date. Returns null for anything
 * that isn't a plausible date — and NEVER today(). A bare small integer (e.g. the
 * "14" some sheets put in a date column) is rejected, not turned into 1900-01-14.
 */
export function readDate(c: RawCell): Date | null {
  if (c.t === 'd') return c.v as Date;
  if (c.t === 'n') {
    const s = Number(c.v);
    if (s < 20_000 || s > 80_000) return null; // ~1954..2119; excludes stray small ints
    return serialToDate(s);
  }
  if (c.t === 's') {
    const m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(String(c.v).trim());
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  }
  return null;
}

export interface Money {
  /** null when the cell was empty OR held a non-numeric word */
  value: Prisma.Decimal | null;
  /** the literal word when a money column held text (⇒ PUL_USTUNIDA_MATN rule) */
  text: string | null;
}

/** A money cell. A number → Decimal (via String, never the JS double). A word → text, value=null. */
export function readMoney(c: RawCell): Money {
  if (c.t === 'null') return { value: null, text: null };
  if (c.t === 'n') return { value: new D(String(c.v)), text: null };
  const s = String(c.v).trim();
  if (!s) return { value: null, text: null };
  let clean = s.replace(/[\s ']/g, '');
  // text-typed amounts: "130,000" / "262,014,900" are THOUSANDS groups (never ÷1000!);
  // only a lone comma with a non-3-digit tail ("1,5") is a decimal point
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) clean = clean.replace(/,/g, '');
  else clean = clean.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(clean)
    ? { value: new D(clean), text: null }
    : { value: null, text: s };
}

/** Plain number (m³, counts). Text is NOT coerced — returns null. */
export function readNumber(c: RawCell): number | null {
  if (c.t === 'n') return Number(c.v);
  return null;
}

/** Integer (pallet counts). Rounds a numeric cell; text → null. */
export function readInt(c: RawCell): number | null {
  const n = readNumber(c);
  return n === null ? null : Math.round(n);
}

/** Trimmed text of any cell (numbers become their string form). '' when empty. */
export function readText(c: RawCell): string {
  if (c.t === 'null') return '';
  if (c.v instanceof Date) return c.v.toISOString().slice(0, 10);
  return String(c.v).trim();
}
