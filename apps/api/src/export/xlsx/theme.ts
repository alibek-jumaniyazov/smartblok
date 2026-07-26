/**
 * ═══════════════ EXCEL DIZAYN TIZIMI ═══════════════
 *
 * Bitta kitobda 25 ga yaqin varaq bo'ladi. Ular bir xil ko'rinishi uchun har bir
 * rang / shrift / son formati SHU YERDA bir marta ta'riflanadi — varaq yozuvchi
 * kodda «qo'lda» rang berilmaydi.
 *
 * Ranglar saytdagi brend palitrasi bilan bir xil (apps/web/src/design.css --sb-*):
 * royal-ko'k brend, tund-ko'k sarlavha, semantik yashil/qizil/sariq. Excel ARGB
 * kutadi — shuning uchun hamma qiymat 'FF' + RRGGBB.
 */

const argb = (hex: string): string => `FF${hex.replace('#', '').toUpperCase()}`;

export const COLOR = {
  /** brend royal-ko'k — varaq sarlavha lentasi */
  brand: argb('#2563EB'),
  brandDark: argb('#1D4ED8'),
  /** tund-ko'k — jadval sarlavha qatori va muqova foni */
  ink: argb('#10224C'),
  ink2: argb('#16305F'),
  sky: argb('#38BDF8'),

  white: argb('#FFFFFF'),
  /** zebra (juft qator) foni — juda och ko'k */
  band: argb('#F4F7FB'),
  surface2: argb('#F7F9FD'),
  border: argb('#D8E0EE'),
  borderSoft: argb('#E6EBF3'),

  fg: argb('#0F172A'),
  fgMuted: argb('#55617A'),
  fgSubtle: argb('#94A3B8'),

  // semantik — sayt bilan bir xil ma'no
  success: argb('#16A34A'), // kirim / foyda / avans
  successSoft: argb('#E8F6EE'),
  danger: argb('#DC2626'), // mijoz qarzi / zarar
  dangerSoft: argb('#FDECEC'),
  amber: argb('#D97706'), // biz qarzdormiz (zavodga)
  amberSoft: argb('#FEF3E2'),
  orange: argb('#EA580C'), // chiqim / xarajat
  violet: argb('#7C3AED'),
  violetSoft: argb('#F1EAFE'),
  slate: argb('#64748B'), // bekor qilingan / nofaol
  slateSoft: argb('#EEF1F6'),

  /** jami qatori foni */
  totalFill: argb('#E8EEFA'),
} as const;

/**
 * Varaq yorlig'i (tab) rangi — bo'lim bo'yicha. Kitobni ochganda pastdagi
 * yorliqlardan qaysi guruh qayerdaligi bir qarashda ko'rinadi.
 */
export const TAB = {
  cover: COLOR.ink, //  muqova + mundarija
  kpi: COLOR.brand, //  umumiy ko'rsatkichlar
  money: COLOR.success, //  pul: to'lov, kassa, bonus
  debt: COLOR.danger, //  qarz / balanslar
  ops: COLOR.violet, //  buyurtma, paddon
  ref: COLOR.slate, //  ma'lumotnomalar
  raw: COLOR.fgSubtle, //  xom yozuvlar (bosh daftar, audit)
} as const;

export const FONT = {
  name: 'Calibri',
  /** muqova bosh sarlavhasi */
  cover: { name: 'Calibri', size: 28, bold: true, color: { argb: COLOR.white } },
  coverSub: { name: 'Calibri', size: 12, color: { argb: argb('#C7D6F5') } },
  /** varaq ustidagi lenta */
  title: { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR.white } },
  subtitle: { name: 'Calibri', size: 10, italic: true, color: { argb: COLOR.fgMuted } },
  /** jadval sarlavhasi */
  header: { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR.white } },
  body: { name: 'Calibri', size: 10.5, color: { argb: COLOR.fg } },
  bodyMuted: { name: 'Calibri', size: 10.5, color: { argb: COLOR.fgMuted } },
  total: { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR.fg } },
  /** KPI varaqidagi katta raqam */
  kpi: { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR.fg } },
  kpiLabel: { name: 'Calibri', size: 10, color: { argb: COLOR.fgMuted } },
  sectionHead: { name: 'Calibri', size: 12, bold: true, color: { argb: COLOR.ink } },
} as const;

/**
 * Son formatlari.
 *
 * MANFIY SON RANGI FORMATDA EMAS. `[Red]` yozib qo'yish oson edi, lekin u katakning
 * shrift rangidan KUCHLIROQ: mijozning avansi (manfiy balans) o'sha zahoti qizil
 * bo'lib, qarzdan farq qilmay qoladi — aslida avans yaxshi xabar. Shuning uchun rang
 * har bir ustunda ma'nosiga qarab beriladi (sheet-builder `tone`), format esa faqat
 * raqamning ko'rinishini hal qiladi.
 *
 * Nol «—» ko'rinishida: bo'sh katak bilan chalkashmaydi, lekin ustunni ma'nosiz
 * nollar bilan ham to'ldirmaydi.
 */
export const NUMFMT = {
  /** so'm, 2 kasr — barcha pul ustunlari */
  money: '#,##0.00;-#,##0.00;"—"',
  /** so'm, butun — KPI kartalari va yig'indi bloklari */
  moneyRound: '#,##0;-#,##0;"—"',
  /** m³ — hajm 3 kasrda saqlanadi */
  m3: '#,##0.000;-#,##0.000;"—"',
  /** dona (paddon, buyurtma soni) */
  int: '#,##0;-#,##0;"—"',
  /** m³ boshiga narx — 6 kasrgacha saqlanadi, 2 tasi ko'rsatiladi */
  price: '#,##0.00;-#,##0.00;"—"',
  percent: '0.00"%"',
  date: 'dd.mm.yyyy',
  dateTime: 'dd.mm.yyyy hh:mm',
  text: '@',
} as const;

export type NumFmt = (typeof NUMFMT)[keyof typeof NUMFMT];

/** Yupqa kulrang chegara — hamma jadval kataklari uchun. */
export const THIN_BORDER = {
  top: { style: 'thin' as const, color: { argb: COLOR.borderSoft } },
  left: { style: 'thin' as const, color: { argb: COLOR.borderSoft } },
  bottom: { style: 'thin' as const, color: { argb: COLOR.borderSoft } },
  right: { style: 'thin' as const, color: { argb: COLOR.borderSoft } },
};

export const fill = (argbColor: string) => ({
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: argbColor },
});
