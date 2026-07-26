import ExcelJS, { type Worksheet } from 'exceljs';
import { TAB } from './theme';
import { sheetName } from './sheet-builder';

/** Varaqlar guruhi — yorliq rangi va mundarijadagi bo'lim shundan kelib chiqadi. */
export type Group = 'cover' | 'kpi' | 'debt' | 'money' | 'ops' | 'ref' | 'raw';

export const GROUP_TITLE: Record<Group, string> = {
  cover: 'Boshlanish',
  kpi: 'Umumiy xulosa',
  debt: 'Balanslar va qarzlar',
  money: 'Pul harakati',
  ops: 'Operatsiyalar',
  ref: "Ma'lumotnomalar",
  raw: 'Xom yozuvlar',
};

export interface SheetEntry {
  /** Excel dagi haqiqiy varaq nomi (kirill, ≤31 belgi) — havola shu nomga boradi. */
  name: string;
  group: Group;
  /** Mundarijadagi to'liq nom (lotin — kirillga o'giriladi). */
  title: string;
  /** «Bu varaqda nima bor» — bir jumla. */
  desc: string;
  rows: number;
}

export interface NewSheet {
  /** Yorliqda ko'rinadigan qisqa nom. */
  tab: string;
  /** Varaq ustidagi lentadagi to'liq sarlavha. */
  title: string;
  /** Mundarija uchun tavsif. */
  desc: string;
}

/**
 * Kitob + mundarija ro'yxati.
 *
 * Har bir varaq shu yerdan yaratiladi, shuning uchun mundarija hech qachon
 * haqiqatdan orqada qolmaydi: varaq qo'shildi — mundarijada ham paydo bo'ldi.
 */
export class Book {
  readonly wb = new ExcelJS.Workbook();
  readonly entries: SheetEntry[] = [];

  constructor(author: string) {
    this.wb.creator = 'SmartBlok';
    this.wb.lastModifiedBy = author;
    this.wb.company = 'SmartBlok';
    // Sana maydonlari ataylab to'ldirilmaydi: ExcelJS ularni o'zi qo'yadi va
    // faylni ochganda «kim, qachon» xossalarida ko'rinadi.
    this.wb.views = [{ x: 0, y: 0, width: 24000, height: 16000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  }

  sheet(group: Group, s: NewSheet): Worksheet {
    const name = sheetName(this.wb, s.tab);
    // `defaultRowHeight` ATAYLAB berilmaydi. U chiroyli ko'rinardi, lekin ExcelJS uni
    // `<sheetFormatPr customHeight="1">` qilib yozadi — bu bayroq Excel'ga «qator
    // balandliklari qo'lda belgilangan» deydi va o'ralgan uzun matn uchun avtomatik
    // balandlik hisobini O'CHIRADI. Natijada izohlarning ikkinchi qatori jimgina
    // kesilib qolardi.
    const ws = this.wb.addWorksheet(name, {
      properties: { tabColor: { argb: TAB[group] } },
    });
    this.entries.push({ name, group, title: s.title, desc: s.desc, rows: 0 });
    return ws;
  }

  /** Varaqqa nechta qator tushganini belgilaydi (mundarijada ko'rsatiladi). */
  count(ws: Worksheet, rows: number): void {
    const e = this.entries.find((x) => x.name === ws.name);
    if (e) e.rows = rows;
  }

  async toBuffer(): Promise<Buffer> {
    // exceljs global `Buffer extends ArrayBuffer` deb e'lon qiladi (index.d.ts:1), shu
    // sababli writeBuffer() ning turi Node Buffer'ga to'g'ridan-to'g'ri tushmaydi —
    // o'quvchi tomonda ham xuddi shu cast bor (import/parse/workbook.reader.ts).
    const raw = (await this.wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
    return Buffer.from(raw);
  }
}
