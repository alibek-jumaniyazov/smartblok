import type { Worksheet } from 'exceljs';
import { cyr } from '../../common/translit';
import { COLOR, FONT, NUMFMT, THIN_BORDER, fill } from '../xlsx/theme';
import { colLetter, linkToSheet, sectionHeading } from '../xlsx/sheet-builder';
import { GROUP_TITLE, type Book, type Group } from '../xlsx/book';

export interface CoverMeta {
  generatedAt: Date;
  author: string;
  authorRole: string;
  /** «Butun davr» yoki «01.06.2026 — 25.07.2026» */
  periodLabel: string;
  /** Bazadagi eng erta va eng kech buyurtma sanasi. */
  dataRangeLabel: string;
}

const COVER_COLS = 5;

/**
 * ═══ MUQOVA ═══
 *
 * Faylni ochgan odam birinchi ko'radigan sahifa. Uch vazifasi bor: bu qanday
 * hujjat, qaysi davrni qamraydi, va — eng muhimi — RAQAMLARNI QANDAY O'QISH kerak.
 *
 * Oxirgisi bezak emas. Bu bazadagi ishorat qoidalari («musbat = qarz»), netlashtirish
 * («avans qarzni yopmaydi») va istisnolar («transport savdo summasi ichida») haqiqiy
 * va nostandart; ularni yozib qo'ymasa, fayl to'g'ri raqamlar bilan noto'g'ri xulosa
 * chiqartiradi.
 */
export function writeCover(ws: Worksheet, meta: CoverMeta, book: Book): void {
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 46;
  ws.getColumn(5).width = 4;

  // ── tund-ko'k shapka ──
  for (let r = 1; r <= 7; r += 1) {
    const row = ws.getRow(r);
    row.height = r === 3 ? 40 : 18;
    for (let c = 1; c <= COVER_COLS; c += 1) row.getCell(c).fill = fill(COLOR.ink);
  }
  ws.mergeCells('B3:D3');
  const brand = ws.getCell('B3');
  brand.value = cyr('{SmartBlok}');
  brand.font = { ...FONT.cover };
  brand.alignment = { vertical: 'middle', horizontal: 'left' };

  ws.mergeCells('B5:D5');
  const sub = ws.getCell('B5');
  sub.value = cyr("To'liq ma'lumot eksporti — butun biznes bitta faylda");
  sub.font = { ...FONT.coverSub };
  sub.alignment = { vertical: 'middle', horizontal: 'left' };

  ws.getRow(8).height = 10;

  // ── hujjat pasporti ──
  let r = 9;
  sectionHeading(ws, r, 'Hujjat haqida', COVER_COLS);
  r += 1;

  const facts: Array<[string, string]> = [
    ['Yaratilgan sana', formatDateTime(meta.generatedAt)],
    ['Kim yaratdi', `${meta.author} (${meta.authorRole})`],
    ['Harakatlar davri', meta.periodLabel],
    ["Bazadagi ma'lumot oraligʼi", meta.dataRangeLabel],
    ['Varaqlar soni', String(book.entries.length)],
    ['Jami yozuvlar', formatInt(book.entries.reduce((a, e) => a + e.rows, 0))],
  ];
  for (const [k, v] of facts) {
    factRow(ws, r, k, v);
    r += 1;
  }

  r += 1;

  // ── o'qish qoidalari ──
  sectionHeading(ws, r, 'Raqamlarni qanday oʼqish kerak', COVER_COLS);
  r += 1;

  const rules: Array<[string, string]> = [
    [
      'Mijoz balansi',
      "Musbat son — mijoz BIZGA qarz. Manfiy son — mijozning bizdagi AVANSI. Har bir varaqda «Holat» ustuni buni soʼz bilan ham yozadi.",
    ],
    [
      'Zavod hisobi',
      "Uchta alohida choʼntak: mol qarzi, naqd avans, bank avansi. Avans qarzni OʼZI YOPMAYDI — faqat «avansdan yechish» amali koʼchiradi. Shuning uchun ular qoʼshilmagan holda, uchta ustunda turadi.",
    ],
    [
      'Transport',
      "Shofyor haqi savdo summasining ICHIDA. Uni savdo summasi ustiga qoʼshmang — mijoz baribir savdo summasini toʼlaydi, transport rejimi faqat pul qaysi yoʼldan ketishini belgilaydi.",
    ],
    [
      'Sof foyda',
      "Faqat tannarxi ANIQ boʼlgan buyurtmalar boʼyicha hisoblanadi (zavodga toʼlash usuli tanlangan yoki pul allaqachon toʼlangan). Tannarxi hali aniqlanmagan buyurtmalar alohida «eng kam — eng koʼp» oraligʼi bilan koʼrsatiladi.",
    ],
    [
      'Kassa va bank',
      "Qoldiq — qoʼlda kiritilgan balans tuzatishlari va diller kapitali bilan BIRGA. Kirim/chiqim esa ularsiz: tuzatish — amaliyot emas. Shuning uchun «kirim − chiqim» qoldiqqa teng boʼlmasligi mumkin; farqni «Tuzatish» ustuni koʼrsatadi.",
    ],
    [
      'Paddon',
      "Hamma joyda DONA, hech qachon pul. Yagona istisno — mijoz yoʼqotgan paddon: u pulga oʼtkaziladi va mijoz qarziga yoziladi. Zavodga paddon qaytarish butunlay pulsiz.",
    ],
    [
      'Bekor qilingan buyurtma',
      "Oʼchirilmaydi — summalari qatorida qoladi, lekin hech qaysi jamiga kirmaydi. «Holat» ustunidan koʼrinadi.",
    ],
    [
      'Storno (bekor yozuvi)',
      "Hech bir yozuv oʼchirilmaydi; xato yozuv teskari yozuv bilan yopiladi va ikkalasi ham roʼyxatda qoladi. Ular bir-birini yoʼqqa chiqaradi, shuning uchun jamilar toʼgʼri — lekin qatorlar sonini «amallar soni» deb oʼqimang.",
    ],
    [
      'Valyuta',
      "Soʼm va dollar hech qachon qoʼshilmaydi. {USD} hisoblar oʼz valyutasida turadi va alohida ustunda koʼrsatiladi.",
    ],
    [
      'Nofaol yozuvlar',
      "Bazadan hech narsa oʼchirilmaydi — nofaol qilinadi. Nofaol mijoz/zavod/moshina ham roʼyxatda qoladi, chunki ularda hamon pul yoki paddon boʼlishi mumkin.",
    ],
  ];
  for (const [k, v] of rules) {
    ruleRow(ws, r, k, v);
    r += 1;
  }

  r += 1;
  ws.mergeCells(`B${r}:D${r}`);
  const foot = ws.getCell(`B${r}`);
  foot.value = cyr(
    "Mundarija varagʼidan istalgan boʼlimga bitta bosishda oʼtish mumkin. Har bir jadvalda sarlavha qatori qotirilgan, filtr yoqilgan va pastda JAMI qatori bor — qator filtrlansa, JAMI ham qayta hisoblanadi.",
  );
  foot.font = { ...FONT.subtitle };
  foot.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  ws.getRow(r).height = 34;

  ws.views = [{ state: 'normal', showGridLines: false }];
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

function factRow(ws: Worksheet, r: number, label: string, value: string): void {
  const row = ws.getRow(r);
  const l = row.getCell(2);
  l.value = cyr(label);
  l.font = { ...FONT.bodyMuted };
  l.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  l.border = THIN_BORDER;

  ws.mergeCells(`C${r}:D${r}`);
  const v = ws.getCell(`C${r}`);
  // Qiymatlar allaqachon tayyor matn (sana/ism) — ular kirillga o'girilmaydi, chunki
  // ism va sana o'girilmasligi kerak. Faqat maxsus so'zlar (masalan «Butun davr»)
  // chaqiruvchida cyr() bilan tayyorlanadi.
  v.value = value;
  v.font = { ...FONT.total };
  v.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  v.border = THIN_BORDER;
  ws.getCell(`D${r}`).border = THIN_BORDER;
  row.height = 20;
}

function ruleRow(ws: Worksheet, r: number, label: string, text: string): void {
  const row = ws.getRow(r);
  const l = row.getCell(2);
  l.value = cyr(label);
  l.font = { ...FONT.total, color: { argb: COLOR.brand } };
  l.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
  l.border = THIN_BORDER;

  ws.mergeCells(`C${r}:D${r}`);
  const v = ws.getCell(`C${r}`);
  v.value = cyr(text);
  v.font = { ...FONT.body };
  v.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
  v.border = THIN_BORDER;
  ws.getCell(`D${r}`).border = THIN_BORDER;
  // C:D birlashgan ustun ≈ 76 «belgi», kirillda bir qatorga ~66 tasi sig'adi.
  // Kam baholab olingan — kesilgan jumladan ko'ra ortiqcha bo'sh joy yaxshi.
  row.height = Math.max(30, Math.ceil(cyr(text).length / 66) * 15 + 8);
}

/**
 * ═══ MUNDARIJA ═══
 *
 * Guruhlarga bo'lingan ro'yxat + har bir varaqqa ichki havola + qator soni.
 * Qator soni ataylab ko'rsatiladi: bo'sh varaq «yo'qolgan ma'lumot» emas, shunchaki
 * o'sha bo'limda hali yozuv yo'q degani, va buni darhol ko'rish kerak.
 */
export function writeContents(ws: Worksheet, book: Book): void {
  ws.getColumn(1).width = 4;
  // varaq nomlari uzun — tor ustunda ular kesilib, mundarija o'qib bo'lmas holga keladi
  ws.getColumn(2).width = 56;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 72;
  ws.getColumn(5).width = 4;

  ws.mergeCells('B2:D2');
  const t = ws.getCell('B2');
  t.value = cyr('Mundarija');
  t.font = { name: 'Calibri', size: 20, bold: true, color: { argb: COLOR.ink } };
  t.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(2).height = 32;

  ws.mergeCells('B3:D3');
  const s = ws.getCell('B3');
  s.value = cyr('Nomni bosing — oʼsha varaq ochiladi');
  s.font = { ...FONT.subtitle };
  ws.getRow(3).height = 16;

  let r = 5;
  const groups: Group[] = ['cover', 'kpi', 'debt', 'money', 'ops', 'ref', 'raw'];
  for (const g of groups) {
    const list = book.entries.filter((e) => e.group === g);
    if (list.length === 0) continue;

    ws.mergeCells(`B${r}:D${r}`);
    const h = ws.getCell(`B${r}`);
    h.value = cyr(GROUP_TITLE[g]);
    h.font = { ...FONT.sectionHead };
    h.fill = fill(COLOR.surface2);
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    h.border = { bottom: { style: 'medium', color: { argb: COLOR.brand } } };
    ws.getRow(r).height = 24;
    r += 1;

    for (const e of list) {
      linkToSheet(ws, `B${r}`, e.name, e.title);
      const c = ws.getCell(`C${r}`);
      // Muqova va mundarijaning o'zida «qator» tushunchasi yo'q — bo'sh qoldiriladi.
      c.value = e.group === 'cover' ? null : e.rows;
      c.numFmt = NUMFMT.int;
      c.font = { ...FONT.bodyMuted };
      c.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      const d = ws.getCell(`D${r}`);
      const desc = cyr(e.desc);
      d.value = desc;
      d.font = { ...FONT.subtitle };
      d.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      for (const col of [2, 3, 4]) ws.getRow(r).getCell(col).border = THIN_BORDER;
      // Tavsif uzun bo'lsa qator o'sadi — aks holda ikkinchi qator kesiladi
      // (Excel'ning avto-moslashi tashqi yozilgan faylda ishonchsiz).
      ws.getRow(r).height = Math.max(20, Math.ceil(desc.length / 56) * 15 + 6);
      r += 1;
    }
    r += 1;
  }

  // «qator» ustuni nimani bildirishini aytib qo'yamiz — aks holda son tushunarsiz
  ws.mergeCells(`B${r}:D${r}`);
  const note = ws.getCell(`B${r}`);
  note.value = cyr("Oʼrtadagi ustun — varaqdagi yozuvlar soni.");
  note.font = { ...FONT.subtitle };
  note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: false }];
  ws.pageSetup = {
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    printTitlesRow: '2:4',
  };
  void colLetter;
}

// ── kichik formatlovchilar (muqovadagi matn qiymatlari uchun) ──

const pad = (n: number): string => String(n).padStart(2, '0');

/** Toshkent vaqti (UTC+5, yozgi vaqt yo'q) — bazadagi UTC dan o'giriladi. */
export function formatDateTime(d: Date): string {
  const l = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  return `${pad(l.getUTCDate())}.${pad(l.getUTCMonth() + 1)}.${l.getUTCFullYear()} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`;
}

export function formatDate(d: Date): string {
  const l = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  return `${pad(l.getUTCDate())}.${pad(l.getUTCMonth() + 1)}.${l.getUTCFullYear()}`;
}

const formatInt = (n: number): string => n.toLocaleString('ru-RU');
