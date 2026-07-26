import { CashboxType, CashDirection, CashSource, Currency, Prisma } from '@prisma/client';
import { D, ZERO } from '../../common/money';
import { isOffBookCash } from '../../common/cash-flow';
import { CASHBOX_TYPE, CASH_DIRECTION, CASH_SOURCE, ACTIVE, YES_NO, L, label } from '../xlsx/labels';
import { NUMFMT } from '../xlsx/theme';
import { num0, profitTone, txt, writeTable, type Col } from '../xlsx/sheet-builder';
import { dateWhere, type Ctx } from './ctx';
import type { KassaService } from '../../kassa/kassa.service';
import type { CashTotals } from './summary';

/** Bank tomoni — TERMINAL va BANK; qolgani (naqd, Click, karta) kassa tomoni. */
const isBankSide = (t: CashboxType): boolean => t === CashboxType.BANK || t === CashboxType.TERMINAL;

// ══════════════════════ KASSA QOLDIQLARI ══════════════════════

/**
 * Har bir hisob qatori uchta ustunda haqiqatni ochiq ko'rsatadi:
 *
 *     QOLDIQ = KIRIM − CHIQIM + TUZATISH
 *
 * «Tuzatish» ustunisiz bu tenglik yopilmaydi va o'quvchi «kassada pul yetishmayapti»
 * degan xulosaga keladi. Sabab: qo'lda kiritilgan balans tuzatishi va diller kapitali
 * qoldiqqa KIRADI, lekin kirim/chiqim hisobotiga kirmaydi — ular amaliyot emas.
 *
 * So'm va dollar ustunlari ATAYLAB alohida: bitta ustunga qo'shilsa, pastdagi JAMI
 * dollarni so'mga qo'shib yuboradi.
 */
export type CashboxRow = Awaited<ReturnType<KassaService['cashboxes']>>[number];

/**
 * KPI va Solishtirma varaqlari uchun valyuta bo'yicha jamlar.
 *
 * Alohida funksiya, chunki bu raqamlar varaq YOZILISHIDAN OLDIN kerak bo'ladi
 * (umumiy ko'rsatkichlar varag'i kitobda kassadan oldin turadi).
 */
export function cashTotals(boxes: CashboxRow[]): CashTotals {
  const t: CashTotals = {
    uzsBalance: ZERO,
    uzsIn: ZERO,
    uzsOut: ZERO,
    uzsAdjust: ZERO,
    usdBalance: ZERO,
    boxCount: boxes.length,
  };
  for (const b of boxes) {
    if (b.currency === Currency.UZS) {
      t.uzsBalance = t.uzsBalance.plus(b.balance);
      t.uzsIn = t.uzsIn.plus(b.inTotal);
      t.uzsOut = t.uzsOut.plus(b.outTotal);
      t.uzsAdjust = t.uzsAdjust.plus(b.adjustTotal);
    } else {
      t.usdBalance = t.usdBalance.plus(b.balance);
    }
  }
  return t;
}

export async function writeCashboxes(ctx: Ctx, boxes: CashboxRow[]): Promise<void> {
  const moveAgg = await ctx.prisma.cashTransaction.groupBy({ by: ['cashboxId'], _count: true });
  const moveMap = new Map(moveAgg.map((g) => [g.cashboxId, g._count]));

  type Box = CashboxRow;
  const rows = boxes.map((b) => ({ b, moves: moveMap.get(b.id) ?? 0 }));
  type R = (typeof rows)[number];

  const uzs = (b: Box, v: Prisma.Decimal): number | null => (b.currency === Currency.UZS ? num0(v) : null);
  const usd = (b: Box, v: Prisma.Decimal): number | null => (b.currency === Currency.USD ? num0(v) : null);

  const cols: Col<R>[] = [
    { header: 'Hisob', value: (r) => r.b.name, width: 26, total: 'count' },
    { header: 'Turi', value: (r) => label(CASHBOX_TYPE, r.b.type), align: 'center' },
    { header: "Boʼlim", value: (r) => L(isBankSide(r.b.type) ? 'Bank' : 'Kassa'), align: 'center' },
    { header: 'Valyuta', value: (r) => r.b.currency, align: 'center' },
    { header: 'Kirim', value: (r) => uzs(r.b, r.b.inTotal), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Chiqim', value: (r) => uzs(r.b, r.b.outTotal), fmt: NUMFMT.money, total: 'sum', tone: () => 'danger' },
    { header: 'Tuzatish va kapital', value: (r) => uzs(r.b, r.b.adjustTotal), fmt: NUMFMT.money, total: 'sum', tone: () => 'muted' },
    { header: 'QOLDIQ', value: (r) => uzs(r.b, r.b.balance), fmt: NUMFMT.money, total: 'sum', tone: profitTone },
    { header: 'Kirim ({USD})', value: (r) => usd(r.b, r.b.inTotal), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Chiqim ({USD})', value: (r) => usd(r.b, r.b.outTotal), fmt: NUMFMT.money, total: 'sum' },
    { header: 'QOLDIQ ({USD})', value: (r) => usd(r.b, r.b.balance), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Harakatlar soni', value: (r) => r.moves, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Yuridik shaxs', value: (r) => txt(r.b.entity?.name ?? null), width: 22 },
    { header: 'Holati', value: (r) => ACTIVE(r.b.active), align: 'center' },
  ];

  const ws = ctx.book.sheet('money', {
    tab: 'Kassa qoldiqlari',
    title: 'Kassa va bank hisoblari — qoldiqlar',
    desc: 'Har bir kassa/bank hisobi: kirim, chiqim, tuzatish va joriy qoldiq.',
  });
  writeTable(ws, {
    title: 'Kassa va bank hisoblari — qoldiqlar',
    subtitle: 'Bugungi holat, butun tarix boʼyicha. Nofaol hisoblar ham roʼyxatda — ularda pul qolgan boʼlishi mumkin.',
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "Har bir qatorda: QOLDIQ = Kirim − Chiqim + Tuzatish. «Tuzatish va kapital» — qoʼlda kiritilgan balans tuzatishlari va «diller kapitali» (egasining oʼz puli, hisob minusga tushmasligi uchun). Ular haqiqiy qoldiqqa kiradi, lekin kirim/chiqim hisobotiga kirmaydi — chunki bu amaliyot emas. Soʼm va dollar hech qachon qoʼshilmaydi, shuning uchun alohida ustunlarda. Ichki oʼtkazma (bir hisobdan ikkinchisiga) ikkita qator yozadi: birida chiqim, birida kirim — kompaniya boʼyicha ular bir-birini yoʼqqa chiqaradi.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ KASSA JURNALI ══════════════════════

export async function writeCashJournal(ctx: Ctx): Promise<void> {
  // ATAYLAB toʼgʼridan-toʼgʼri Prisma orqali: GET /kassa/transactions ga `direction`
  // berilsa, u jimgina balans tuzatishi va kapital qatorlarini tashlab ketadi
  // (kassa.service.ts), qolaversa sahifa hajmi 200 ta bilan cheklangan.
  const rows = await ctx.prisma.cashTransaction.findMany({
    where: dateWhere(ctx.window),
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: {
      cashbox: { select: { name: true, currency: true, type: true } },
      payment: {
        select: {
          kind: true,
          voidedAt: true,
          client: { select: { name: true } },
          factory: { select: { name: true } },
          vehicle: { select: { name: true } },
        },
      },
      expense: { select: { voidedAt: true, category: { select: { name: true } } } },
      bonusTransaction: { select: { type: true, factory: { select: { name: true } } } },
      reversedBy: { select: { id: true } },
      reversalOf: { select: { id: true } },
      createdBy: { select: { name: true } },
      importBatch: { select: { filename: true } },
    },
  });

  type R = (typeof rows)[number];

  const signed = (r: R): number => (r.direction === CashDirection.IN ? num0(r.amount) : -num0(r.amount));
  const isUzs = (r: R): boolean => r.cashbox.currency === Currency.UZS;

  const docType = (r: R): string | null => {
    if (r.payment) return L("Toʼlov");
    if (r.expense) return L('Xarajat');
    if (r.bonusTransaction) return L('Bonus');
    if (r.source === CashSource.TRANSFER) return L("Ichki oʼtkazma");
    if (r.source === CashSource.REVERSAL) return L('Storno');
    return null;
  };

  const party = (r: R): string | null =>
    r.payment?.client?.name ??
    r.payment?.factory?.name ??
    r.payment?.vehicle?.name ??
    r.bonusTransaction?.factory?.name ??
    r.expense?.category?.name ??
    null;

  const cols: Col<R>[] = [
    { header: 'Sana', value: (r) => r.date, fmt: NUMFMT.date, total: 'count' },
    { header: 'Hisob', value: (r) => r.cashbox.name, width: 22 },
    { header: 'Valyuta', value: (r) => r.cashbox.currency, align: 'center' },
    {
      header: "Yoʼnalish",
      // Balans tuzatishi kirim ham, chiqim ham emas — uni shunday atash yolgʼon boʼladi
      value: (r) => (r.source === CashSource.BALANCE_ADJUSTMENT ? '—' : label(CASH_DIRECTION, r.direction)),
      align: 'center',
    },
    { header: 'Summa', value: (r) => num0(r.amount), fmt: NUMFMT.money },
    {
      header: 'Belgili summa',
      value: (r) => (isUzs(r) ? signed(r) : null),
      fmt: NUMFMT.money,
      total: 'sum',
      tone: profitTone,
    },
    {
      header: 'Belgili summa ({USD})',
      value: (r) => (isUzs(r) ? null : signed(r)),
      fmt: NUMFMT.money,
      total: 'sum',
      tone: profitTone,
    },
    { header: 'Manba', value: (r) => label(CASH_SOURCE, r.source), width: 20 },
    {
      header: 'Oqimga kiradimi',
      value: (r) => L(isOffBookCash(r.source) ? "Yoʼq — faqat qoldiqqa" : 'Ha'),
      align: 'center',
      width: 18,
      tone: (r) => (isOffBookCash(r.source) ? 'muted' : undefined),
    },
    { header: 'Hujjat', value: (r) => docType(r) },
    { header: 'Kontragent', value: (r) => txt(party(r)), width: 26 },
    { header: 'Kurs', value: (r) => (r.rate.isZero() ? null : num0(r.rate)), fmt: NUMFMT.money },
    { header: 'Storno qilingan', value: (r) => YES_NO(!!r.reversedBy), align: 'center', tone: (r) => (r.reversedBy ? 'slate' : undefined) },
    { header: 'Storno yozuvi', value: (r) => YES_NO(!!r.reversalOf), align: 'center' },
    { header: 'Hujjat bekor qilingan', value: (r) => YES_NO(!!(r.payment?.voidedAt ?? r.expense?.voidedAt)), align: 'center' },
    { header: "Oʼtkazma juftligi", value: (r) => (r.transferPairId ? L('Ha') : null), align: 'center' },
    { header: 'Izoh', value: (r) => txt(r.note), width: 32, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.createdBy?.name ?? null) },
    { header: 'Import fayli', value: (r) => txt(r.importBatch?.filename ?? null), width: 20 },
  ];

  const ws = ctx.book.sheet('money', {
    tab: 'Kassa jurnali',
    title: 'Kassa va bank jurnali — har bir harakat',
    desc: 'Kassa/bank hisoblaridagi barcha kirim-chiqim, tuzatish va oʼtkazma yozuvlari.',
  });
  writeTable(ws, {
    title: 'Kassa va bank jurnali — har bir harakat',
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 2,
    footnote:
      "«Summa» har doim musbat; qoʼshish uchun «Belgili summa» ustunidan foydalaning (kirim +, chiqim −). «Oqimga kiradimi — Yoʼq» qatorlar qoldiqni oʼzgartiradi, lekin kirim/chiqim hisobotiga kirmaydi: bular qoʼlbola balans tuzatishi va diller kapitali. Ichki oʼtkazma ikki qator (chiqim + kirim) — kompaniya boʼyicha yigʼindisi nol. Storno yozuvlari ham roʼyxatda qoladi va asl yozuvni yoʼqqa chiqaradi: shuning uchun qatorlar sonini «amallar soni» deb oʼqimang.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════ TUZATISH VA OʼTKAZMALAR ══════════════════

/**
 * «Kirim − chiqim» va «qoldiq» orasidagi butun farq shu bitta varaqda.
 *
 * Uchta manba tushuntirishga muhtoj: balans tuzatishi (egasining qo'lbola
 * to'g'rilashi), diller kapitali (o'z puli, hisob minusga tushmasin deb) va ichki
 * o'tkazma (pul kompaniyani tark etmaydi). Ular jurnalning ichida ko'rinmay ketadi,
 * shuning uchun bu yerda alohida yig'ilgan.
 */
export async function writeCashBridge(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.cashTransaction.findMany({
    where: {
      source: { in: [CashSource.BALANCE_ADJUSTMENT, CashSource.CAPITAL, CashSource.TRANSFER] },
      ...dateWhere(ctx.window),
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: {
      cashbox: { select: { name: true, currency: true } },
      createdBy: { select: { name: true } },
      importBatch: { select: { filename: true } },
    },
  });

  type R = (typeof rows)[number];
  const signed = (r: R): number => (r.direction === CashDirection.IN ? num0(r.amount) : -num0(r.amount));

  const section = (r: R): string =>
    L(r.source === CashSource.TRANSFER ? "Ichki oʼtkazma" : "Qoldiq tuzatishi / kapital");

  const cols: Col<R>[] = [
    { header: "Boʼlim", value: (r) => section(r), width: 24, total: 'count' },
    { header: 'Sana', value: (r) => r.date, fmt: NUMFMT.date },
    { header: 'Hisob', value: (r) => r.cashbox.name, width: 24 },
    { header: 'Valyuta', value: (r) => r.cashbox.currency, align: 'center' },
    { header: 'Manba', value: (r) => label(CASH_SOURCE, r.source), width: 20 },
    { header: "Yoʼnalish", value: (r) => (r.source === CashSource.BALANCE_ADJUSTMENT ? '—' : label(CASH_DIRECTION, r.direction)), align: 'center' },
    { header: 'Belgili summa', value: (r) => signed(r), fmt: NUMFMT.money, total: 'sum', tone: profitTone },
    { header: 'Izoh', value: (r) => txt(r.note), width: 36, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.createdBy?.name ?? null) },
    { header: 'Import fayli', value: (r) => txt(r.importBatch?.filename ?? null), width: 20 },
  ];

  const ws = ctx.book.sheet('money', {
    tab: 'Tuzatish va oʼtkazma',
    title: 'Qoldiq tuzatishlari, diller kapitali va ichki oʼtkazmalar',
    desc: "«Kirim − chiqim» bilan «qoldiq» orasidagi farqni tushuntiruvchi barcha yozuvlar.",
  });
  writeTable(ws, {
    title: 'Qoldiq tuzatishlari, diller kapitali va ichki oʼtkazmalar',
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 1,
    emptyText: "Bu turdagi yozuv yoʼq — kassa qoldigʼi toʼliq kirim va chiqimdan hosil boʼlgan",
    footnote:
      "Bu yerdagi qatorlar kassa/bank QOLDIGʼIGA taʼsir qiladi, lekin kirim/chiqim hisobotida koʼrinmaydi. «Balans tuzatildi» — egasi hisob qoldigʼini qoʼlda toʼgʼrilagan (storno qilinmaydi; xato boʼlsa qoldiq yana belgilanadi). «Diller kapitali» — egasining oʼz puli, hisob minusga tushmasligi uchun kiritilgan. «Ichki oʼtkazma» — pul bir hisobdan ikkinchisiga koʼchgan, kompaniyani tark etmagan: shuning uchun bu boʼlim jamisi odatda nolga yaqin boʼladi.",
  });
  ctx.book.count(ws, rows.length);
}

void D;
