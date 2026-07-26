import { PaymentKind, Prisma } from '@prisma/client';
import { D, ZERO } from '../../common/money';
import { PAYMENT_KIND, PAYMENT_METHOD, PRICE_KIND, YES_NO, label } from '../xlsx/labels';
import { NUMFMT } from '../xlsx/theme';
import { minus, num0, profitTone, times, txt, writeTable, type Col } from '../xlsx/sheet-builder';
import { dateWhere, type Ctx } from './ctx';

/**
 * To'lovning diller cho'ntagiga ta'siri (belgili).
 *
 * `amount` HAR DOIM musbat — yo'nalish `kind` ichida. Shu sababli xom summani qo'shish
 * ma'nosiz son beradi: mijozdan olingan va zavodga to'langan pul bir xil ishorada
 * turadi. Bu ustun yagona qo'shsa bo'ladigan ustun.
 *
 * Ikki istisno nolga tushadi: TRANSPORT_DIRECT (mijoz shofyorga o'zi bergan — bizning
 * pulimiz umuman qimirlamaydi, bu shunchaki qayd) va bekor qilingan hujjatlar.
 */
const flowSign = (kind: PaymentKind): number => {
  switch (kind) {
    case PaymentKind.CLIENT_IN:
    case PaymentKind.FACTORY_REFUND:
      return 1;
    case PaymentKind.CLIENT_REFUND:
    case PaymentKind.FACTORY_OUT:
    case PaymentKind.VEHICLE_OUT:
      return -1;
    default:
      return 0; // TRANSPORT_DIRECT
  }
};

type PaymentWithRels = Prisma.PaymentGetPayload<{
  include: {
    client: { select: { name: true } };
    factory: { select: { name: true } };
    vehicle: { select: { name: true; plate: true } };
    agent: { select: { name: true } };
    cashbox: { select: { name: true; currency: true } };
    usdCashbox: { select: { name: true } };
    payerEntity: { select: { name: true } };
    receiverEntity: { select: { name: true } };
    createdBy: { select: { name: true } };
    voidedBy: { select: { name: true } };
    importBatch: { select: { filename: true } };
  };
}>;

interface PayRow {
  p: PaymentWithRels;
  allocated: Prisma.Decimal;
}

export async function writePayments(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const [payments, allocAgg] = await Promise.all([
    // Bekor qilingan (voided) hujjatlar ham chiqadi: ular oʼchirilmaydi va ularning
    // kassa/daftar aksi bazada turadi. Ularni yashirsak, jurnaldagi teskari yozuvlar
    // «egasiz» boʼlib qoladi. Jamiga esa ular kirmaydi — «Pul oqimi» ustuni nol beradi.
    prisma.payment.findMany({
      where: dateWhere(ctx.window),
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        client: { select: { name: true } },
        factory: { select: { name: true } },
        vehicle: { select: { name: true, plate: true } },
        agent: { select: { name: true } },
        cashbox: { select: { name: true, currency: true } },
        usdCashbox: { select: { name: true } },
        payerEntity: { select: { name: true } },
        receiverEntity: { select: { name: true } },
        createdBy: { select: { name: true } },
        voidedBy: { select: { name: true } },
        importBatch: { select: { filename: true } },
      },
    }),
    prisma.paymentAllocation.groupBy({
      by: ['paymentId'],
      where: { voidedAt: null },
      _sum: { amount: true },
    }),
  ]);

  const allocMap = new Map(allocAgg.map((g) => [g.paymentId, D(g._sum.amount ?? 0)]));
  const rows: PayRow[] = payments.map((p) => ({ p, allocated: allocMap.get(p.id) ?? ZERO }));

  const counterparty = (p: PaymentWithRels): string | null =>
    p.client?.name ??
    p.factory?.name ??
    (p.vehicle ? `${p.vehicle.name}${p.vehicle.plate ? ` (${p.vehicle.plate})` : ''}` : null);

  const cols: Col<PayRow>[] = [
    { header: 'Sana', value: (r) => r.p.date, fmt: NUMFMT.date, total: 'count' },
    { header: 'Turi', value: (r) => label(PAYMENT_KIND, r.p.kind), width: 22 },
    { header: 'Usuli', value: (r) => label(PAYMENT_METHOD, r.p.method), align: 'center' },
    { header: 'Kontragent', value: (r) => counterparty(r.p), width: 28 },
    { header: 'Agent', value: (r) => txt(r.p.agent?.name ?? null) },
    { header: 'Summa', value: (r) => num0(r.p.amount), fmt: NUMFMT.money },
    {
      header: 'Pul oqimi (belgili)',
      value: (r) => (r.p.voidedAt ? 0 : times(r.p.amount, flowSign(r.p.kind))),
      fmt: NUMFMT.money,
      total: 'sum',
      tone: profitTone,
    },
    { header: 'Kassa hisobi', value: (r) => txt(r.p.cashbox?.name ?? null), width: 20 },
    { header: 'USD summasi', value: (r) => (r.p.usdAmount.isZero() ? null : num0(r.p.usdAmount)), fmt: NUMFMT.money },
    { header: 'Kurs', value: (r) => (r.p.rate.isZero() ? null : num0(r.p.rate)), fmt: NUMFMT.money },
    { header: 'Taqsimlangan', value: (r) => num0(r.allocated), fmt: NUMFMT.money, total: 'sum' },
    {
      header: 'Taqsimlanmagan',
      value: (r) => (r.p.voidedAt ? null : minus(r.p.amount, r.allocated)),
      fmt: NUMFMT.money,
      total: 'sum',
    },
    { header: "Toʼlovchi", value: (r) => txt(r.p.payerEntity?.name ?? r.p.payerName), width: 22 },
    { header: 'Qabul qiluvchi', value: (r) => txt(r.p.receiverEntity?.name ?? r.p.receiverName), width: 22 },
    { header: 'Tekshirilgan', value: (r) => YES_NO(r.p.reconciled), align: 'center' },
    { header: 'Bekor qilingan', value: (r) => YES_NO(!!r.p.voidedAt), align: 'center', tone: (r) => (r.p.voidedAt ? 'slate' : undefined) },
    { header: 'Bekor sababi', value: (r) => txt(r.p.voidReason), width: 26, wrap: true },
    { header: 'Izoh', value: (r) => txt(r.p.note), width: 30, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.p.createdBy?.name ?? null) },
    { header: 'Import fayli', value: (r) => txt(r.p.importBatch?.filename ?? null), width: 22 },
  ];

  const ws = ctx.book.sheet('money', {
    tab: "Toʼlovlar",
    title: "Toʼlovlar — barcha pul hujjatlari",
    desc: "Mijozdan, zavodga, shofyorga — hamma toʼlov hujjati, bekor qilinganlari bilan birga.",
  });
  writeTable(ws, {
    title: "Toʼlovlar — barcha pul hujjatlari",
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "«Summa» har doim musbat — yoʼnalish «Turi» ustunida. Qoʼshish uchun faqat «Pul oqimi (belgili)» ustunidan foydalaning: u mijozdan tushgan pulni musbat, zavodga/shofyorga ketganini manfiy qiladi. Ikki holat unda NOL boʼladi: bekor qilingan hujjatlar va «Mijoz shofyorga toʼlagan» qatorlari (bu pul bizning kassamizga umuman kirmagan, shunchaki qayd). Bonus hisobidan toʼlangan zavod toʼlovi ham kassaga tegmaydi. «Tekshirilgan — Yoʼq» degani: import qilingan, lekin egasining daftaridagi toʼlovlar roʼyxatida topilmagan pul.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════════ TAQSIMOT ══════════════════════════

export async function writeAllocations(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const rows = await prisma.paymentAllocation.findMany({
    where: ctx.window ? { payment: { date: { gte: ctx.window.gte, lt: ctx.window.lt } } } : {},
    orderBy: [{ createdAt: 'asc' }],
    include: {
      payment: {
        select: {
          date: true,
          kind: true,
          method: true,
          voidedAt: true,
          client: { select: { name: true } },
          factory: { select: { name: true } },
        },
      },
      order: { select: { orderNo: true, date: true, client: { select: { name: true } } } },
      createdBy: { select: { name: true } },
    },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Sana', value: (r) => r.payment.date, fmt: NUMFMT.date, total: 'count' },
    { header: "Toʼlov turi", value: (r) => label(PAYMENT_KIND, r.payment.kind), width: 22 },
    { header: 'Kontragent', value: (r) => txt(r.payment.client?.name ?? r.payment.factory?.name ?? null), width: 26 },
    { header: 'Buyurtma №', value: (r) => r.order.orderNo, align: 'center' },
    { header: 'Buyurtma sanasi', value: (r) => r.order.date, fmt: NUMFMT.date },
    { header: 'Buyurtma mijozi', value: (r) => txt(r.order.client?.name ?? null), width: 26 },
    { header: 'Summa', value: (r) => (r.voidedAt ? 0 : num0(r.amount)), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Narx asosi', value: (r) => label(PRICE_KIND, r.priceKind), width: 18 },
    { header: 'Avansdan yechilgan', value: (r) => YES_NO(r.fromAdvance), align: 'center' },
    { header: 'Bekor qilingan', value: (r) => YES_NO(!!r.voidedAt), align: 'center', tone: (r) => (r.voidedAt ? 'slate' : undefined) },
    { header: 'Bekor sababi', value: (r) => txt(r.voidReason), width: 24, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.createdBy?.name ?? null) },
    { header: 'Yaratilgan', value: (r) => r.createdAt, fmt: NUMFMT.dateTime },
  ];

  const ws = ctx.book.sheet('money', {
    tab: "Toʼlov taqsimoti",
    title: "Toʼlov taqsimoti — qaysi pul qaysi buyurtmaga ketdi",
    desc: "Har bir toʼlovning buyurtmalarga taqsimlangan qismlari.",
  });
  writeTable(ws, {
    title: "Toʼlov taqsimoti — qaysi pul qaysi buyurtmaga ketdi",
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "Mijoz puli buyurtmalarga eng eski buyurtmadan boshlab avtomatik taqsimlanadi; bu taqsimot MAʼLUMOT uchun — mijozning balansi toʼlov qabul qilingan paytda allaqachon oʼzgargan boʼladi. Zavod toʼlovining taqsimoti esa ISHCHI: u buyurtma tannarxini qotiradi va «avansdan yechish» boʼlsa pulni choʼntakdan choʼntakka koʼchiradi. Bekor qilingan taqsimotlar qatorda qoladi, lekin summasi 0 koʼrsatiladi.",
  });
  ctx.book.count(ws, rows.length);
}
