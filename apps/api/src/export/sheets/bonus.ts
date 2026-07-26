import { BonusTransactionType, Prisma } from '@prisma/client';
import { D, ZERO } from '../../common/money';
import { BONUS_TX, ACTIVE, YES_NO, label } from '../xlsx/labels';
import { NUMFMT } from '../xlsx/theme';
import { num0, profitTone, txt, writeTable, type Col } from '../xlsx/sheet-builder';
import { dateWhere, type Ctx } from './ctx';
import { programText } from './parties';

// ══════════════════════ BONUS HAMYONI ══════════════════════

interface WalletRow {
  factory: string;
  active: boolean;
  accrued: Prisma.Decimal;
  withdrawn: Prisma.Decimal;
  offset: Prisma.Decimal;
  adjusted: Prisma.Decimal;
  reversed: Prisma.Decimal;
  balance: Prisma.Decimal;
  program: string | null;
  programFrom: Date | null;
}

/**
 * Hamyon qoldig'i — `amount` ustunining oddiy YIG'INDISI.
 *
 * Ishora allaqachon ustunning ichida: hisoblangan bonus musbat, yechilgani va qarzga
 * o'tkazilgani manfiy holda saqlanadi. Turga qarab qayta ishora qo'yish har bir
 * sarflangan bonusni ikki marta ayirib yuboradi.
 */
export async function writeBonusWallets(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const [factories, groups, programs] = await Promise.all([
    prisma.factory.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    prisma.bonusTransaction.groupBy({ by: ['factoryId', 'type'], _sum: { amount: true } }),
    prisma.bonusProgram.findMany({ orderBy: { effectiveFrom: 'desc' } }),
  ]);

  const byFactory = new Map<string, Map<BonusTransactionType, Prisma.Decimal>>();
  for (const g of groups) {
    const m = byFactory.get(g.factoryId) ?? new Map();
    m.set(g.type, D(g._sum.amount ?? 0));
    byFactory.set(g.factoryId, m);
  }
  const programMap = new Map<string, (typeof programs)[number]>();
  for (const p of programs) if (!programMap.has(p.factoryId)) programMap.set(p.factoryId, p);

  const rows: WalletRow[] = factories.map((f) => {
    const m = byFactory.get(f.id) ?? new Map<BonusTransactionType, Prisma.Decimal>();
    const get = (t: BonusTransactionType) => m.get(t) ?? ZERO;
    let balance = ZERO;
    for (const v of m.values()) balance = balance.plus(v);
    const prog = programMap.get(f.id);
    return {
      factory: f.name,
      active: f.active,
      accrued: get(BonusTransactionType.ACCRUAL),
      withdrawn: get(BonusTransactionType.WITHDRAWAL),
      offset: get(BonusTransactionType.DEBT_OFFSET),
      adjusted: get(BonusTransactionType.ADJUSTMENT),
      reversed: get(BonusTransactionType.REVERSAL),
      balance,
      program: programText(prog),
      programFrom: prog?.effectiveFrom ?? null,
    };
  });

  const cols: Col<WalletRow>[] = [
    { header: 'Zavod', value: (r) => r.factory, width: 28, total: 'count' },
    { header: 'Hisoblangan', value: (r) => num0(r.accrued), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Naqd yechilgan', value: (r) => num0(r.withdrawn), fmt: NUMFMT.money, total: 'sum' },
    { header: "Qarzga oʼtkazilgan", value: (r) => num0(r.offset), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Tuzatish', value: (r) => num0(r.adjusted), fmt: NUMFMT.money, total: 'sum', tone: () => 'muted' },
    { header: 'Storno', value: (r) => num0(r.reversed), fmt: NUMFMT.money, total: 'sum', tone: () => 'slate' },
    { header: 'HAMYON QOLDIGʼI', value: (r) => num0(r.balance), fmt: NUMFMT.money, total: 'sum', tone: profitTone },
    { header: 'Joriy dastur', value: (r) => txt(r.program), width: 24 },
    { header: 'Dastur kuchga kirgan', value: (r) => r.programFrom, fmt: NUMFMT.date },
    { header: 'Zavod holati', value: (r) => ACTIVE(r.active), align: 'center' },
  ];

  const ws = ctx.book.sheet('money', {
    tab: 'Bonus hamyoni',
    title: 'Bonus hamyoni — zavodlar boʼyicha',
    desc: 'Zavodlardan yigʼilgan bonus: hisoblangan, sarflangan va qolgan qismi.',
  });
  writeTable(ws, {
    title: 'Bonus hamyoni — zavodlar boʼyicha',
    subtitle: 'Butun tarix boʼyicha. Bonus yozuvlarida biznes sanasi yoʼq — hisob vaqti boʼyicha yuritiladi.',
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "«Naqd yechilgan» va «Qarzga oʼtkazilgan» ustunlari MANFIY koʼrinadi — chunki bazada ular allaqachon ishorali saqlanadi va hamyon qoldigʼi shu ustunlarning oddiy yigʼindisi. Bonus faqat buyurtma yakunlanganda va oʼsha paytdagi kuchdagi dastur boʼyicha hisoblanadi; dastur keyin oʼzgarsa, eski hisoblanmalar oʼzgarmaydi.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ BONUS HARAKATLARI ══════════════════════

export async function writeBonusTransactions(ctx: Ctx): Promise<void> {
  // DIQQAT: BonusTransaction da biznes sanasi ustuni YOʼQ — faqat `at` (yozuv vaqti).
  // Shuning uchun sana filtri ham shunga qoʼllanadi va varaqda buni aytib qoʼyamiz.
  const rows = await ctx.prisma.bonusTransaction.findMany({
    where: dateWhere(ctx.window, 'at'),
    orderBy: [{ at: 'asc' }],
    include: {
      factory: { select: { name: true } },
      order: { select: { orderNo: true, date: true } },
      payment: { select: { date: true, amount: true } },
      program: { select: { kind: true, ratePerM3: true, percent: true } },
      createdBy: { select: { name: true } },
      reversalOf: { select: { id: true } },
      reversedBy: { select: { id: true } },
    },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Vaqti', value: (r) => r.at, fmt: NUMFMT.dateTime, total: 'count' },
    { header: 'Zavod', value: (r) => r.factory.name, width: 26 },
    { header: 'Turi', value: (r) => label(BONUS_TX, r.type), width: 20 },
    { header: 'Summa (belgili)', value: (r) => num0(r.amount), fmt: NUMFMT.money, total: 'sum', tone: profitTone },
    { header: 'Asos — summa', value: (r) => (r.baseAmount ? num0(r.baseAmount) : null), fmt: NUMFMT.money },
    { header: 'Asos — hajm (m³)', value: (r) => (r.baseM3 ? num0(r.baseM3) : null), fmt: NUMFMT.m3 },
    { header: 'Buyurtma №', value: (r) => txt(r.order?.orderNo ?? null), align: 'center' },
    { header: 'Buyurtma sanasi', value: (r) => r.order?.date ?? null, fmt: NUMFMT.date },
    { header: 'Dastur', value: (r) => programText(r.program), width: 22 },
    { header: 'Storno qilingan', value: (r) => YES_NO(!!r.reversedBy), align: 'center', tone: (r) => (r.reversedBy ? 'slate' : undefined) },
    { header: 'Storno yozuvi', value: (r) => YES_NO(!!r.reversalOf), align: 'center' },
    { header: 'Izoh', value: (r) => txt(r.note), width: 32, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.createdBy?.name ?? null) },
  ];

  const ws = ctx.book.sheet('money', {
    tab: 'Bonus harakatlari',
    title: 'Bonus harakatlari — hisoblash, yechish, qarzga oʼtkazish',
    desc: 'Bonus hamyonidagi har bir yozuv va uning asosi.',
  });
  writeTable(ws, {
    title: 'Bonus harakatlari — hisoblash, yechish, qarzga oʼtkazish',
    subtitle: `${ctx.periodLabel} · Sana sifatida yozuv vaqti olinadi — bonusda alohida biznes sanasi yoʼq.`,
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "«Summa (belgili)» — bazadagi ishorali qiymat: hisoblangan bonus musbat, yechilgan va qarzga oʼtkazilgani manfiy. Ustun yigʼindisi hamyon qoldigʼini beradi. Storno yozuvlari roʼyxatdan olib tashlanmaydi — asl yozuv va uning stornosi ikkalasi ham koʼrinadi va bir-birini yoʼqqa chiqaradi.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ XARAJATLAR ══════════════════════

export async function writeExpenses(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.expense.findMany({
    where: dateWhere(ctx.window),
    orderBy: [{ date: 'asc' }],
    include: {
      category: { select: { name: true } },
      cashbox: { select: { name: true, currency: true } },
      createdBy: { select: { name: true } },
    },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Sana', value: (r) => r.date, fmt: NUMFMT.date, total: 'count' },
    { header: 'Turkum', value: (r) => txt(r.category?.name ?? null), width: 24 },
    { header: 'Summa', value: (r) => (r.voidedAt ? 0 : num0(r.amount)), fmt: NUMFMT.money, total: 'sum', tone: () => 'danger' },
    { header: 'Hisob', value: (r) => txt(r.cashbox?.name ?? null), width: 22 },
    { header: 'Bekor qilingan', value: (r) => YES_NO(!!r.voidedAt), align: 'center' },
    { header: 'Bekor sababi', value: (r) => txt(r.voidReason), width: 24, wrap: true },
    { header: 'Izoh', value: (r) => txt(r.note), width: 32, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.createdBy?.name ?? null) },
  ];

  const ws = ctx.book.sheet('money', {
    tab: 'Xarajatlar',
    title: 'Xarajatlar',
    desc: 'Alohida qayd etilgan xarajatlar (kassa xarajat moduli).',
  });
  writeTable(ws, {
    title: 'Xarajatlar',
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 1,
    emptyText: "Alohida xarajat yozuvi yoʼq — asosiy xarajatlar buyurtma tannarxi va transport haqi sifatida hisobga olinadi",
    footnote:
      "Bu varaq faqat ALOHIDA qayd etilgan xarajatlarni koʼrsatadi. Biznesning asosiy xarajatlari bu yerda emas: mol tannarxi buyurtma qatorida, shofyor haqi esa transport xarajati sifatida hisobga olinadi. Varaq boʼsh boʼlishi «xarajat yoʼq» degani emas.",
  });
  ctx.book.count(ws, rows.length);
}
