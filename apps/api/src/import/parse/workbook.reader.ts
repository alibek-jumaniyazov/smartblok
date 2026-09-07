import ExcelJS from 'exceljs';
import { readCell, readText, type RawCell } from './cells';

/**
 * ══════════════ «Smart blok.xlsx» — SHABLON v5 (2026-09) ══════════════
 *
 * Egasi daftarni butunlay qayta qurdi. Eski shablon («Лист1» jurnali + HAR BIR AGENT uchun
 * alohida varaq, ichida mijoz bloklari) YO'Q. Yangi fayl — 5 ta TEKIS jadval + справочник,
 * qolgani esa formula bilan hisoblanadigan hisobot varaqlari:
 *
 *   KIRITILADIGAN (import qilinadi)
 *     «Товар»                    — har qatori bitta mashina yuki   (415 qator)
 *     «Оплата»                   — mijoz to'lovlari                (194)
 *     «Оплата поставшику»        — zavodga to'lovlar                (58)
 *     «Поддон қайтариш»          — mijoz paddon qaytardi            (88)
 *     «Поддон қайтариш заводга»  — biz zavodga paddon qaytardik     (13)
 *     «Кўрсаткичлар»             — SPRAVOCHNIK: mijoz/agent/zavod nomlari + sozlamalar
 *
 *   HISOBLANADIGAN (o'qilmaydi, faqat solishtirish uchun)
 *     «Мижозлар қолдиғи» · «Ҳисобот» · «Поставшиклар ҳисоби» · «Акт (умумий)» ·
 *     «Акт сверка» · «KPI» · «Текширув» · «Қидирув» · «Мижоз картаси»
 *
 * ┌ NEGA SHABLON ANIQLANADI ┐
 * Eski parser jurnal varag'ini «3-qatorida Агент+Клиент sarlavhalari bor» degan belgi bilan
 * topardi. YANGI fayldagi «Товар» varag'i ham AYNAN shu belgiga to'g'ri keladi — ya'ni eski
 * parser yangi faylni JIM QABUL QILIB, butunlay boshqa ustunlarni o'qigan bo'lardi (yangi
 * A = «Тўлов тури», eskisida A = «В-о»). Natija: xatosiz, lekin butunlay yolg'on import.
 * Shuning uchun shablon ATAYLAB nomlangan jadvallar va sarlavha to'plami bo'yicha
 * tekshiriladi va mos kelmasa import BOSHLANMAYDI.
 */

/** Varaq nomlari — faylda qanday bo'lsa shunday (kirillcha, «ў»/«қ»/«ғ» bilan). */
export const SHEET = {
  goods: 'Товар',
  payments: 'Оплата',
  factoryPayments: 'Оплата поставшику',
  palletReturns: 'Поддон қайтариш',
  factoryPalletReturns: 'Поддон қайтариш заводга',
  masterData: 'Кўрсаткичлар',
} as const;

/**
 * Har bir varaqning sarlavha qatorini TOPADIGAN belgilar. Qator raqami qotirilmaydi: egasi
 * tepaga bitta yig'indi qatori qo'shsa ham import buzilmasin. Belgilar — o'sha varaqni
 * boshqasidan ajratadigan eng qisqa to'plam.
 */
const HEADER_MARKS: Record<string, string[]> = {
  [SHEET.goods]: ['тўлов тури', 'поставшик', 'клиент', 'блок', 'цена'],
  [SHEET.payments]: ['дата', 'клиент', 'пр-сумма', 'накд', 'жами сумма'],
  [SHEET.factoryPayments]: ['дата', 'сумма', 'получател'],
  [SHEET.palletReturns]: ['дата', 'клиент', 'поддон дона'],
  [SHEET.factoryPalletReturns]: ['дата', 'поддон сони', 'қабул қилувчи'],
};

/** Bitta topilgan jadval: qaysi varaqda, sarlavha qayerda, sarlavha → ustun raqami. */
export interface SheetTable {
  sheet: ExcelJS.Worksheet;
  sheetName: string;
  headerRow: number;
  /** normallashtirilgan sarlavha matni → ustun raqami (1-indeksli) */
  columns: Map<string, number>;
  /** oxirgi qator (exceljs ko'rgan) */
  lastRow: number;
}

/** Sarlavhani solishtirish uchun: kichik harf, ichki bo'shliqlar bitta, chetlari kesilgan. */
export function normHeader(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export class TemplateMismatchError extends Error {}

/**
 * exceljs ustidagi yupqa qobiq. exceljs tanlangan sabab: u katakning TURINI va formulaning
 * KESHLANGAN natijasini alohida beradi — bu daftarda pul ustuni ichida so'z, sana ustunida
 * esa ham seriya, ham matn uchraydi (cells.ts ga qarang).
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

  /** Nomi bo'yicha varaq (chetidagi bo'shliqqa bardoshli). `null` — yo'q. */
  worksheet(name: string): ExcelJS.Worksheet | null {
    const want = name.replace(/\s+/g, ' ').trim().toLowerCase();
    return (
      this.wb.getWorksheet(name) ??
      this.wb.worksheets.find((w) => w.name.replace(/\s+/g, ' ').trim().toLowerCase() === want) ??
      null
    );
  }

  /**
   * Varaqning sarlavha qatorini topadi va ustun xaritasini quradi.
   *
   * Qator raqami emas, MAZMUN bo'yicha izlanadi: birinchi 12 qatorning ichidan HEADER_MARKS
   * dagi hamma belgini o'z ichiga olgani sarlavha deb olinadi. Shu sababli egasi tepaga
   * yig'indi qatori qo'shsa yoki olib tashlasa, import baribir ishlaydi.
   */
  table(name: string): SheetTable {
    const ws = this.worksheet(name);
    if (!ws) throw new TemplateMismatchError(`«${name}» varag'i topilmadi`);
    const marks = HEADER_MARKS[name] ?? [];

    for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const columns = new Map<string, number>();
      for (let c = 1; c <= ws.columnCount; c++) {
        const text = normHeader(readText(readCell(row.getCell(c))));
        // Bir xil sarlavha ikki marta uchrasa BIRINCHISI qoladi: «Поддон қайтариш заводга»
        // varag'ida o'ngdagi «ПОДДОН ҚОЛДИҒИ» paneli sarlavhalarni takrorlaydi.
        if (text && !columns.has(text)) columns.set(text, c);
      }
      const keys = [...columns.keys()];
      if (marks.every((m) => keys.some((k) => k.includes(m)))) {
        return { sheet: ws, sheetName: ws.name, headerRow: r, columns, lastRow: ws.rowCount };
      }
    }
    throw new TemplateMismatchError(
      `«${name}» varag'ining sarlavha qatori topilmadi (kutilgan ustunlar: ${marks.join(', ')})`,
    );
  }

  /** 1-indeksli (qator, ustun) — ustun raqam yoki harf («A») bo'lishi mumkin. */
  cell(ws: ExcelJS.Worksheet, row: number, col: number | string): RawCell {
    return readCell(ws.getRow(row).getCell(col as never));
  }
}

/**
 * Jadvaldan ustunni nomi bo'yicha oladi. Sarlavha faylda ko'p qatorli («Блок\n Куб») yoki
 * chetida bo'shliqli («Дата ») bo'lishi mumkin, shuning uchun solishtirish QISM bo'yicha.
 *
 * `required` — ustun bo'lmasa import to'xtaydi. Bu ATAYLAB: yo'q ustunni jimgina `null` deb
 * o'qish (eski parserning odati) daftardan pul yoki paddonni ko'rinmasdan yo'qotardi.
 */
export function col(t: SheetTable, ...candidates: string[]): number {
  const c = optionalCol(t, ...candidates);
  if (c === null) {
    throw new TemplateMismatchError(
      `«${t.sheetName}» varag'ida «${candidates[0]}» ustuni yo'q (bor ustunlar: ${[...t.columns.keys()].join(' · ')})`,
    );
  }
  return c;
}

/** Ixtiyoriy ustun — yo'q bo'lsa `null` (faqat haqiqatan ixtiyoriy maydonlar uchun). */
export function optionalCol(t: SheetTable, ...candidates: string[]): number | null {
  for (const raw of candidates) {
    const want = normHeader(raw);
    const exact = t.columns.get(want);
    if (exact !== undefined) return exact;
    for (const [k, v] of t.columns) if (k.includes(want)) return v;
  }
  return null;
}
