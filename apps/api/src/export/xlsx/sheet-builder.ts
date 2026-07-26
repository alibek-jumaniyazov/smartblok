/**
 * ═══════════════ VARAQ YOZUVCHI ═══════════════
 *
 * Kitobdagi HAR BIR jadval shu yerdan chiqadi. Sabab oddiy: 25 ta varaqni qo'lda
 * bezasa, ular albatta bir-biridan farq qila boshlaydi — bittasida sarlavha muzlatilgan,
 * boshqasida yo'q; birida pul 2 kasrda, boshqasida 0 da. Bu yerda esa bitta ta'rif:
 *
 *   sarlavha lentasi → izoh qatori → jadval sarlavhasi → ma'lumot → JAMI qatori
 *   + muzlatilgan sarlavha + avtofiltr + ustun kengliklari + chop etish sozlamasi
 *
 * Ustun ta'rifi ma'lumotni ham, formatini ham, JAMI qatorini ham o'zi biladi, shuning
 * uchun yangi ustun qo'shish = bitta obyekt qo'shish.
 */
import type { Column as ExcelColumn, Row, Worksheet, Workbook } from 'exceljs';
import { Prisma } from '@prisma/client';
import { cyr } from '../../common/translit';
import { D, round2 } from '../../common/money';
import { COLOR, FONT, NUMFMT, THIN_BORDER, fill, type NumFmt } from './theme';

// ── qiymat o'giruvchilar ────────────────────────────────────────────────────

export type CellValue = string | number | Date | null;

/**
 * Decimal → number. Excel raqamni raqam sifatida ko'rishi SHART, aks holda
 * foydalanuvchi ustunni ajratganda pastda yig'indi chiqmaydi va saralash alifbo
 * bo'yicha ketadi. Eng katta summa ~10¹² so'm, JS butun sonlarni 9·10¹⁵ gacha
 * aniq saqlaydi — yo'qotish yo'q.
 */
export const num = (v: Prisma.Decimal | string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
};

/** Nolni ham raqam sifatida qoldiradi, lekin null/undefined ni 0 qiladi. */
export const num0 = (v: Prisma.Decimal | string | number | null | undefined): number => num(v) ?? 0;

type Val = Prisma.Decimal | string | number | null | undefined;

/**
 * ═══ PUL ARIFMETIKASI DECIMAL'DA ═══
 *
 * `num0(a) - num0(b)` yozish oson, lekin natija yolg'on chiqadi:
 * 22 784 999.99 − 15 552 000 JS da 7 232 999.989999998 beradi. Bitta katakda buni
 * format yashiradi, ammo 150 ta shunday qator qo'shilganda tiyinlik farq to'planib
 * qoladi va JAMI qatori bazadagi son bilan mos kelmaydi.
 *
 * Shuning uchun ayirish va ko'paytirish Decimal'da bajariladi, 2 xonaga yaxlitlanadi
 * va FAQAT SHUNDAN KEYIN songa aylantiriladi — bazadagi round2 bilan bir xil qoida.
 */
export const minus = (a: Val, ...subtract: Val[]): number =>
  num0(round2(subtract.reduce<Prisma.Decimal>((acc, v) => acc.minus(D(v ?? 0)), D(a ?? 0))));

/** Ko'paytma (masalan dona × narx) — xuddi shu sababdan Decimal'da. */
export const times = (a: Val, b: Val): number => num0(round2(D(a ?? 0).times(D(b ?? 0))));

export const dt = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Bo'sh matnni null qiladi — «—» ko'rinishida chiqsin, bo'sh katak emas. */
export const txt = (v: string | null | undefined): string | null => {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
};

// ── ustun ta'rifi ───────────────────────────────────────────────────────────

export type Tone = 'success' | 'danger' | 'amber' | 'violet' | 'slate' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  success: COLOR.success,
  danger: COLOR.danger,
  amber: COLOR.amber,
  violet: COLOR.violet,
  slate: COLOR.slate,
  muted: COLOR.fgMuted,
};

export interface Col<T> {
  /** Lotin o'zbekchada yoziladi — faylga kirillda tushadi (cyr). */
  header: string;
  /** Katak qiymati. null ⇒ format bo'yicha «—». */
  value: (row: T, index: number) => CellValue;
  fmt?: NumFmt;
  width?: number;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  /** JAMI qatorida shu ustun nima qilsin. */
  total?: 'sum' | 'count';
  /** Katakni rangga bo'yash (masalan qarz — qizil, avans — yashil). */
  tone?: (row: T, value: CellValue) => Tone | undefined;
}

/** Pul ustuni uchun tayyor qoida: musbat = qizil qarz, manfiy = yashil avans. */
export const debtTone = (_row: unknown, v: CellValue): Tone | undefined => {
  if (typeof v !== 'number' || v === 0) return undefined;
  return v > 0 ? 'danger' : 'success';
};

/** Kirim/foyda ustuni: musbat = yashil, manfiy = qizil. */
export const profitTone = (_row: unknown, v: CellValue): Tone | undefined => {
  if (typeof v !== 'number' || v === 0) return undefined;
  return v > 0 ? 'success' : 'danger';
};

// ── varaq nomi ──────────────────────────────────────────────────────────────

const FORBIDDEN = /[\\/?*[\]:]/g;

/**
 * Excel varaq nomi: 31 belgidan uzun bo'lmaydi va []:*?/\ belgilarini qabul
 * qilmaydi. Nom takrorlansa ExcelJS jimgina xato beradi — shuning uchun
 * takrorlanishni ham shu yerda hal qilamiz.
 */
export function sheetName(wb: Workbook, latin: string): string {
  const base = cyr(latin).replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  let name = base || 'Варақ';
  let i = 2;
  while (wb.getWorksheet(name)) {
    const suffix = ` ${i}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  return name;
}

// ── sarlavha lentasi ────────────────────────────────────────────────────────

/** Jadval ma'lumoti qaysi qatordan boshlanadi (lenta 1, izoh 2, oraliq 3, sarlavha 4). */
export const HEADER_ROW = 4;
export const FIRST_DATA_ROW = HEADER_ROW + 1;

interface BandOpts {
  title: string;
  subtitle?: string;
  colCount: number;
  bandColor?: string;
}

/** Varaq tепасидаги rangli lenta + kulrang izoh qatori. */
export function titleBand(ws: Worksheet, opts: BandOpts): void {
  const last = Math.max(1, opts.colCount);
  const lastCol = colLetter(last);

  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = cyr(opts.title);
  t.font = { ...FONT.title };
  t.fill = fill(opts.bandColor ?? COLOR.brand);
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell('A2');
  s.value = opts.subtitle ? cyr(opts.subtitle) : null;
  s.font = { ...FONT.subtitle };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 16;

  ws.getRow(3).height = 6;
}

/** A, B, … Z, AA, AB … — ExcelJS manzil satri uchun. */
export function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || 'A';
}

// ── jadval ──────────────────────────────────────────────────────────────────

export interface TableOpts<T> {
  title: string;
  subtitle?: string;
  columns: Col<T>[];
  rows: T[];
  /** Chapdan nechta ustun gorizontal siljiganda ham qotib tursin (odatda 1–2). */
  freezeCols?: number;
  /** JAMI qatori kerakmi (ustunlarda `total` bo'lsa avtomatik chiqadi). */
  totals?: boolean;
  /** Jadval ostidagi tushuntirish matni (lotin — kirillga o'giriladi). */
  footnote?: string;
  /** Ma'lumot bo'lmasa shu matn chiqadi. */
  emptyText?: string;
  bandColor?: string;
  /**
   * Ikkinchi JAMI qatori — shartli.
   *
   * Nima uchun kerak: bekor qilingan buyurtma o'z summalarini SAQLAB qoladi (ular
   * tarixiy fakt), lekin hech qaysi haqiqiy jamiga kirmasligi kerak. Yuqoridagi JAMI
   * qatori SUBTOTAL ishlatadi — u FILTRGA bo'ysunadi, ya'ni foydalanuvchi bekorlarni
   * filtrlab tashlasa o'zi to'g'rilanadi. Bu qator esa filtrdan qat'i nazar to'g'ri
   * javobni beradi, shuning uchun faylni ochgan zahoti ko'rinadigan son ham rost bo'ladi.
   */
  extraTotal?: {
    label: string;
    /** Shart qo'yiladigan ustunning sarlavhasi (columns ichidan topiladi). */
    criteriaHeader: string;
    /** Excel sharti, masalan '<>Бекор қилинган'. Kirillga O'GIRILMAYDI — tayyor bering. */
    criteria: string;
  };
}

/**
 * To'liq bezatilgan jadval yozadi va yozilgan qatorlar sonini qaytaradi.
 *
 * Zebra (juft qator foni) qo'lda beriladi, «table style» orqali emas: ExcelJS ning
 * jadval obyekti avtofiltr + muzlatilgan sarlavha bilan birga ishlaganda LibreOffice
 * va Google Sheets da turlicha ochiladi, qo'lda bo'yash esa hamma joyda bir xil.
 */
export function writeTable<T>(ws: Worksheet, opts: TableOpts<T>): number {
  const cols = opts.columns;
  const n = cols.length;
  titleBand(ws, {
    title: opts.title,
    subtitle: opts.subtitle,
    colCount: n,
    bandColor: opts.bandColor,
  });

  // ── sarlavha qatori ──
  const head = ws.getRow(HEADER_ROW);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = cyr(c.header);
    cell.font = { ...FONT.header };
    cell.fill = fill(COLOR.ink);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: COLOR.ink } },
      left: { style: 'thin', color: { argb: COLOR.ink2 } },
      bottom: { style: 'medium', color: { argb: COLOR.brand } },
      right: { style: 'thin', color: { argb: COLOR.ink2 } },
    };
  });
  head.height = 30;

  // ── ma'lumot ──
  let r = FIRST_DATA_ROW;
  if (opts.rows.length === 0) {
    ws.mergeCells(`A${r}:${colLetter(n)}${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = cyr(opts.emptyText ?? "Ma'lumot yo'q");
    cell.font = { ...FONT.bodyMuted, italic: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r).height = 22;
    r += 1;
  } else {
    opts.rows.forEach((row, idx) => {
      const line = ws.getRow(r);
      const banded = idx % 2 === 1;
      cols.forEach((c, i) => {
        const cell = line.getCell(i + 1);
        const v = c.value(row, idx);
        cell.value = v;
        if (c.fmt) cell.numFmt = c.fmt;
        const tone = c.tone?.(row, v);
        cell.font = tone ? { ...FONT.body, color: { argb: TONE_COLOR[tone] } } : { ...FONT.body };
        cell.alignment = {
          vertical: 'middle',
          horizontal: c.align ?? defaultAlign(c),
          wrapText: c.wrap ?? false,
        };
        cell.border = THIN_BORDER;
        if (banded) cell.fill = fill(COLOR.band);
      });
      r += 1;
    });
  }
  const lastDataRow = r - 1;

  // ── JAMI ──
  const wantsTotals = opts.totals !== false && cols.some((c) => c.total);
  if (wantsTotals && opts.rows.length > 0) {
    const totalRow = ws.getRow(r);
    let labelPlaced = false;
    cols.forEach((c, i) => {
      const cell = totalRow.getCell(i + 1);
      if (c.total === 'sum') {
        const from = `${colLetter(i + 1)}${FIRST_DATA_ROW}`;
        const to = `${colLetter(i + 1)}${lastDataRow}`;
        // FORMULA, tayyor son emas: foydalanuvchi qator o'chirsa yoki filtrlasa
        // jami o'zi qayta hisoblanadi — «qotib qolgan» yig'indi yolg'on gapirmaydi.
        cell.value = { formula: `SUBTOTAL(109,${from}:${to})`, date1904: false };
        if (c.fmt) cell.numFmt = c.fmt;
        cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'right' };
      } else if (c.total === 'count') {
        cell.value = { formula: `SUBTOTAL(103,${colLetter(i + 1)}${FIRST_DATA_ROW}:${colLetter(i + 1)}${lastDataRow})`, date1904: false };
        cell.numFmt = NUMFMT.int;
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (!labelPlaced) {
        cell.value = cyr('JAMI');
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        labelPlaced = true;
      }
      cell.font = { ...FONT.total };
      cell.fill = fill(COLOR.totalFill);
      cell.border = {
        top: { style: 'double', color: { argb: COLOR.brand } },
        left: { style: 'thin', color: { argb: COLOR.border } },
        bottom: { style: 'thin', color: { argb: COLOR.border } },
        right: { style: 'thin', color: { argb: COLOR.border } },
      };
    });
    totalRow.height = 22;
    r += 1;

    // ── shartli JAMI (filtrdan qat'i nazar to'g'ri) ──
    const ex = opts.extraTotal;
    const critIdx = ex ? cols.findIndex((c) => c.header === ex.criteriaHeader) : -1;
    if (ex && critIdx >= 0) {
      const critCol = colLetter(critIdx + 1);
      const critRange = `$${critCol}$${FIRST_DATA_ROW}:$${critCol}$${lastDataRow}`;
      const row2 = ws.getRow(r);
      let placed = false;
      cols.forEach((c, i) => {
        const cell = row2.getCell(i + 1);
        if (c.total === 'sum') {
          const col = colLetter(i + 1);
          cell.value = {
            formula: `SUMIFS(${col}${FIRST_DATA_ROW}:${col}${lastDataRow},${critRange},"${ex.criteria}")`,
            date1904: false,
          };
          if (c.fmt) cell.numFmt = c.fmt;
          cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'right' };
        } else if (c.total === 'count') {
          cell.value = { formula: `COUNTIFS(${critRange},"${ex.criteria}")`, date1904: false };
          cell.numFmt = NUMFMT.int;
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if (!placed) {
          cell.value = cyr(ex.label);
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
          placed = true;
        }
        cell.font = { ...FONT.total, color: { argb: COLOR.brandDark } };
        cell.fill = fill(COLOR.surface2);
        cell.border = {
          top: { style: 'thin', color: { argb: COLOR.border } },
          left: { style: 'thin', color: { argb: COLOR.border } },
          bottom: { style: 'medium', color: { argb: COLOR.brand } },
          right: { style: 'thin', color: { argb: COLOR.border } },
        };
      });
      row2.height = 22;
      r += 1;
    }
  }

  // ── izoh ──
  let footnoteRow = 0;
  if (opts.footnote) {
    r += 1;
    footnoteRow = r;
    ws.mergeCells(`A${r}:${colLetter(n)}${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = cyr(opts.footnote);
    cell.font = { ...FONT.subtitle };
    cell.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
  }

  finishSheet(ws, {
    columns: cols,
    rows: opts.rows,
    lastDataRow,
    freezeCols: opts.freezeCols ?? 0,
  });

  // Izohning balandligi ustun kengliklari MA'LUM bo'lgach hisoblanadi.
  // Birlashtirilgan katak — Excel uni o'zi kengaytirmaydi (bu Excel'ning ma'lum
  // cheklovi), shuning uchun bu yerda qo'lda hisoblanadi. Jadval qanchalik keng
  // bo'lsa, izoh shuncha kam qatorga sig'adi — 5 ustunli jadvalda 500 belgilik izoh
  // 5 qator, 30 ustunlisida bitta qator bo'ladi.
  if (footnoteRow) {
    let width = 0;
    for (let i = 1; i <= n; i += 1) width += ws.getColumn(i).width ?? 10;
    // kirill harf raqamdan keng — sig'imni 0.7 koeffitsiyent bilan kamaytiramiz
    const perLine = Math.max(40, Math.floor(width * 0.7));
    const linesNeeded = Math.ceil(cyr(opts.footnote as string).length / perLine);
    ws.getRow(footnoteRow).height = linesNeeded * 15 + 8;
  }

  return opts.rows.length;
}

const defaultAlign = (c: Col<unknown>): 'left' | 'center' | 'right' => {
  if (!c.fmt) return 'left';
  if (c.fmt === NUMFMT.date || c.fmt === NUMFMT.dateTime) return 'center';
  if (c.fmt === NUMFMT.text) return 'left';
  return 'right';
};

/** Muzlatish + avtofiltr + ustun kengligi + chop etish — har bir jadvalning oxiri. */
function finishSheet<T>(
  ws: Worksheet,
  o: { columns: Col<T>[]; rows: T[]; lastDataRow: number; freezeCols: number },
): void {
  ws.views = [
    {
      state: 'frozen',
      xSplit: o.freezeCols,
      ySplit: HEADER_ROW,
      topLeftCell: `${colLetter(o.freezeCols + 1)}${FIRST_DATA_ROW}`,
      activeCell: `${colLetter(o.freezeCols + 1)}${FIRST_DATA_ROW}`,
    },
  ];

  if (o.rows.length > 0) {
    ws.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: o.lastDataRow, column: o.columns.length },
    };
  }

  autoWidths(ws, o.columns, o.rows);

  ws.pageSetup = {
    orientation: o.columns.length > 6 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9, // A4
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
  };
  ws.headerFooter = {
    oddFooter: `&L${cyr('{SmartBlok}')}&C&P / &N&R${cyr(ws.name)}`,
  };
}

/**
 * Ustun kengligi: sarlavha va dastlabki qatorlar bo'yicha o'lchanadi.
 *
 * Faqat 200 qator tekshiriladi — 100 000 qatorli bosh daftarda hamma katakni
 * o'lchash eksportni sekinlashtiradi, kenglik esa baribir deyarli o'zgarmaydi.
 * Kirill harflar lotinga qaraganda bir oz keng, shuning uchun koeffitsiyent 1.15.
 */
function autoWidths<T>(ws: Worksheet, columns: Col<T>[], rows: T[]): void {
  const SAMPLE = 200;
  const sample = rows.slice(0, SAMPLE);
  columns.forEach((c, i) => {
    if (c.width) {
      ws.getColumn(i + 1).width = c.width;
      return;
    }
    let widest = cyr(c.header).length + 2;
    for (let k = 0; k < sample.length; k += 1) {
      const v = c.value(sample[k], k);
      const len = measure(v, c.fmt);
      if (len > widest) widest = len;
    }
    const col: Partial<ExcelColumn> = ws.getColumn(i + 1);
    col.width = Math.min(46, Math.max(9, Math.round(widest * 1.15) + 2));
  });
}

const measure = (v: CellValue, fmt?: NumFmt): number => {
  if (v === null) return 3;
  if (v instanceof Date) return fmt === NUMFMT.dateTime ? 16 : 10;
  if (typeof v === 'number') {
    // «1 234 567.89» — guruh ajratgichlari bilan
    const abs = Math.abs(v);
    const digits = abs < 1 ? 1 : Math.floor(Math.log10(abs)) + 1;
    const groups = Math.floor((digits - 1) / 3);
    const decimals = fmt === NUMFMT.int ? 0 : fmt === NUMFMT.m3 ? 4 : 3;
    return digits + groups + decimals + (v < 0 ? 1 : 0);
  }
  return Math.min(String(v).length, 50);
};

// ── erkin blok yozish (KPI / muqova varaqlari uchun) ────────────────────────

/** Bo'lim sarlavhasi — KPI varaqidagi guruhlarni ajratadi. */
export function sectionHeading(ws: Worksheet, row: number, latin: string, colCount: number): Row {
  ws.mergeCells(`A${row}:${colLetter(colCount)}${row}`);
  const cell = ws.getCell(`A${row}`);
  cell.value = cyr(latin);
  cell.font = { ...FONT.sectionHead };
  cell.fill = fill(COLOR.surface2);
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  cell.border = { bottom: { style: 'medium', color: { argb: COLOR.brand } } };
  const r = ws.getRow(row);
  r.height = 24;
  return r;
}

export interface KpiLine {
  label: string;
  value: CellValue;
  fmt?: NumFmt;
  tone?: Tone;
  /** Kichik tushuntirish — raqam qayerdan kelgani. */
  hint?: string;
  /** Qalin qatorlar — bo'limning bosh raqami. */
  strong?: boolean;
}

/**
 * KPI qatori: yorliq | qiymat | tushuntirish.
 *
 * Bu «kartochka» emas, ataylab jadval: egasi faylni ochib ustundan nusxa oladi,
 * shuning uchun qiymatlar bitta ustunda tik turishi kerak.
 */
export function kpiRow(ws: Worksheet, row: number, line: KpiLine): void {
  const r = ws.getRow(row);

  const label = r.getCell(1);
  label.value = cyr(line.label);
  label.font = line.strong ? { ...FONT.total } : { ...FONT.body };
  label.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  label.border = THIN_BORDER;
  if (line.strong) label.fill = fill(COLOR.totalFill);

  const value = r.getCell(2);
  value.value = line.value;
  value.numFmt = line.fmt ?? NUMFMT.moneyRound;
  value.font = {
    ...(line.strong ? FONT.kpi : FONT.total),
    ...(line.tone ? { color: { argb: TONE_COLOR[line.tone] } } : {}),
  };
  value.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
  value.border = THIN_BORDER;
  if (line.strong) value.fill = fill(COLOR.totalFill);

  const hint = r.getCell(3);
  const hintText = line.hint ? cyr(line.hint) : null;
  hint.value = hintText;
  hint.font = { ...FONT.subtitle };
  hint.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  hint.border = THIN_BORDER;
  if (line.strong) hint.fill = fill(COLOR.totalFill);

  // Balandlik izoh uzunligidan hisoblanadi.
  //
  // Excel'ning o'z avto-moslashiga tayanib ko'rildi va u ISHONCHSIZ chiqdi: tashqi
  // dastur yozgan faylni ochganda ba'zi qatorlarni kengaytiradi, ba'zilarini yo'q,
  // natijada izohning ikkinchi qatori jimgina kesiladi. Shuning uchun balandlik shu
  // yerda, ataylab ZAXIRA bilan hisoblanadi: bir qatorga 58 belgi (kirill harf
  // raqamdan keng, ustun kengligi esa raqam bo'yicha o'lchanadi) va har qatorga
  // 15 punkt. Ortiqcha bo'sh joy — chidasa bo'ladigan nuqson; kesilgan jumla — yo'q.
  const CHARS_PER_LINE = 58;
  const hintLines = hintText ? Math.ceil(hintText.length / CHARS_PER_LINE) : 1;
  r.height = Math.max(line.strong ? 26 : 20, hintLines * 15 + 6);
}

/** Ichki havola: mundarijadan varaqqa sakrash. */
export function linkToSheet(ws: Worksheet, address: string, target: string, latinText: string): void {
  const cell = ws.getCell(address);
  cell.value = {
    text: cyr(latinText),
    hyperlink: `#'${target}'!A1`,
  };
  cell.font = { ...FONT.body, color: { argb: COLOR.brand }, underline: true };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
}
