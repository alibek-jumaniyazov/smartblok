import { CostStatus, FactoryPayIntent, PaymentKind, Prisma } from '@prisma/client';
import { D, ZERO } from '../../common/money';
import { clientChargeable, clientDirectTransport } from '../../common/transport';
import { EMPTY_PALLET_STATS, hasPalletHistory, type PalletPartyStats } from '../../pallets/pallet-stats';
import {
  COST_STATUS,
  FACTORY_PAY_INTENT,
  ORDER_STATUS,
  PALLET_TX,
  TRANSPORT_MODE,
  TRANSPORT_PAID,
  L,
  YES_NO,
  label,
} from '../xlsx/labels';
import { NUMFMT } from '../xlsx/theme';
import { minus, num0, profitTone, times, txt, writeTable, type Col } from '../xlsx/sheet-builder';
import { NOT_CANCELLED } from '../../common/order-scope';
import { dateWhere, type Ctx } from './ctx';

const STATUS_HEADER = 'Holati';

/**
 * Tannarxi ANIQ buyurtma — dashboard.service.ts dagi DETERMINED_COST bilan bir xil qoida:
 * zavodga qanday to'lash tanlangan, YOKI pul allaqachon tegib bo'lgan.
 *
 * Bu shunchaki ustun emas — «sof foyda» faqat shu buyurtmalar ustidan hisoblanadi.
 * Aks holda tannarxi hali qarorga kelinmagan buyurtmaning butun savdosi foyda bo'lib
 * ko'rinadi.
 */
const isDetermined = (o: { factoryPayIntent: FactoryPayIntent; costStatus: CostStatus }): boolean =>
  o.factoryPayIntent !== FactoryPayIntent.UNKNOWN || o.costStatus !== CostStatus.PROVISIONAL;

// ══════════════════════════ BUYURTMALAR ══════════════════════════

export async function writeOrders(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const [orders, clientPaid, factoryPaid] = await Promise.all([
    prisma.order.findMany({
      // BEKOR QILINGANLAR EKSPORTGA UMUMAN TUSHMAYDI (egasi qarori, 2026-07-28).
      // Ilgari ular qatorda turar, summalari SUBTOTAL bilan hisoblangan yuqoridagi
      // JAMI ga kirar, pastda esa «JAMI — bekor qilinganlarsiz» degan ikkinchi
      // qator ularni qaytarib ayirardi. Ya'ni faylni ochgan odam ikkita JAMI
      // ko'rar va qaysi biri haqiqiy ekanini izohdan topishi kerak edi. Endi
      // bitta JAMI bor va u to'g'ri: hisoblanmaydigan qator umuman yozilmaydi.
      where: { ...dateWhere(ctx.window), ...NOT_CANCELLED },
      orderBy: [{ date: 'asc' }, { orderNo: 'asc' }],
      include: {
        client: { select: { name: true } },
        agent: { select: { name: true } },
        factory: { select: { name: true } },
        vehicle: { select: { name: true, plate: true } },
        createdBy: { select: { name: true } },
        importBatch: { select: { filename: true } },
        items: {
          select: {
            quantityM3: true,
            actualQuantityM3: true,
            palletCount: true,
            actualPalletCount: true,
            pricePending: true,
          },
        },
      },
    }),
    prisma.paymentAllocation.groupBy({
      by: ['orderId'],
      where: { voidedAt: null, payment: { voidedAt: null, kind: PaymentKind.CLIENT_IN } },
      _sum: { amount: true },
    }),
    prisma.paymentAllocation.groupBy({
      by: ['orderId'],
      where: { voidedAt: null, payment: { voidedAt: null, kind: PaymentKind.FACTORY_OUT } },
      _sum: { amount: true },
    }),
  ]);

  const clientPaidMap = new Map(clientPaid.map((g) => [g.orderId, D(g._sum.amount ?? 0)]));
  const factoryPaidMap = new Map(factoryPaid.map((g) => [g.orderId, D(g._sum.amount ?? 0)]));

  type O = (typeof orders)[number];
  interface Row {
    o: O;
    plannedM3: Prisma.Decimal;
    actualM3: Prisma.Decimal;
    pallets: number;
    pricePending: boolean;
    clientPaid: Prisma.Decimal;
    factoryPaid: Prisma.Decimal;
  }

  const rows: Row[] = orders.map((o) => {
    let planned = ZERO;
    let actual = ZERO;
    let pallets = 0;
    let pending = false;
    for (const it of o.items) {
      planned = planned.plus(it.quantityM3);
      actual = actual.plus(it.actualQuantityM3 ?? it.quantityM3);
      pallets += it.actualPalletCount ?? it.palletCount;
      if (it.pricePending) pending = true;
    }
    return {
      o,
      plannedM3: planned,
      actualM3: actual,
      pallets,
      pricePending: pending,
      clientPaid: clientPaidMap.get(o.id) ?? ZERO,
      factoryPaid: factoryPaidMap.get(o.id) ?? ZERO,
    };
  });

  /** Diller foydasi = savdo − tannarx − transport xarajati (enum izohida qotirilgan qoida). */
  const netProfit = (r: Row): number => minus(r.o.saleTotal, r.o.costTotal, r.o.transportCost);

  const cols: Col<Row>[] = [
    { header: 'Buyurtma №', value: (r) => r.o.orderNo, align: 'center', total: 'count' },
    { header: 'Sana', value: (r) => r.o.date, fmt: NUMFMT.date },
    { header: 'Mijoz', value: (r) => txt(r.o.client?.name ?? null), width: 28 },
    { header: 'Agent', value: (r) => txt(r.o.agent?.name ?? null) },
    { header: 'Zavod', value: (r) => txt(r.o.factory?.name ?? null), width: 22 },
    {
      header: 'Moshina',
      value: (r) => (r.o.vehicle ? `${r.o.vehicle.name}${r.o.vehicle.plate ? ` (${r.o.vehicle.plate})` : ''}` : null),
      width: 22,
    },
    { header: 'Shofyor', value: (r) => txt(r.o.driverName) },
    { header: STATUS_HEADER, value: (r) => label(ORDER_STATUS, r.o.status), align: 'center' },
    { header: 'Hajm — reja (m³)', value: (r) => num0(r.plannedM3), fmt: NUMFMT.m3, total: 'sum' },
    { header: 'Hajm — haqiqiy (m³)', value: (r) => num0(r.actualM3), fmt: NUMFMT.m3, total: 'sum' },
    { header: 'Paddon (dona)', value: (r) => r.pallets, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Savdo summasi', value: (r) => num0(r.o.saleTotal), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Tannarx', value: (r) => num0(r.o.costTotal), fmt: NUMFMT.money, total: 'sum' },
    {
      header: 'Mol foydasi',
      value: (r) => minus(r.o.saleTotal, r.o.costTotal),
      fmt: NUMFMT.money,
      total: 'sum',
      tone: profitTone,
    },
    { header: 'Transport xarajati', value: (r) => num0(r.o.transportCost), fmt: NUMFMT.money, total: 'sum' },
    { header: 'SOF FOYDA', value: netProfit, fmt: NUMFMT.money, total: 'sum', tone: profitTone },
    { header: 'Transport rejimi', value: (r) => label(TRANSPORT_MODE, r.o.transportMode), width: 24 },
    { header: 'Transport toʼlangani', value: (r) => label(TRANSPORT_PAID, r.o.transportPaidStatus), align: 'center' },
    {
      header: 'Shofyorga mijoz bergani',
      value: (r) => num0(clientDirectTransport(r.o)),
      fmt: NUMFMT.money,
      total: 'sum',
    },
    { header: 'Mijoz toʼlashi kerak', value: (r) => num0(clientChargeable(r.o)), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Mijoz toʼlagani', value: (r) => num0(r.clientPaid), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Zavodga toʼlangani', value: (r) => num0(r.factoryPaid), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Tannarx holati', value: (r) => label(COST_STATUS, r.o.costStatus), align: 'center', width: 18 },
    { header: "Zavodga toʼlash usuli", value: (r) => label(FACTORY_PAY_INTENT, r.o.factoryPayIntent), align: 'center' },
    {
      header: 'Tannarxi aniqmi',
      value: (r) => YES_NO(isDetermined(r.o)),
      align: 'center',
      tone: (r) => (isDetermined(r.o) ? undefined : 'violet'),
    },
    { header: 'Narxlanmagan qator bor', value: (r) => (r.pricePending ? L('Ha') : null), align: 'center', tone: () => 'amber' },
    { header: "Toʼlov muddati", value: (r) => r.o.dueDate, fmt: NUMFMT.date },
    { header: 'Yakunlangan', value: (r) => r.o.completedAt, fmt: NUMFMT.dateTime },
    // «Bekor sababi» ustuni olib tashlandi: bu varaqda bekor qilingan buyurtma yo'q,
    // ya'ni ustun har doim bo'sh turardi.
    { header: 'Izoh', value: (r) => txt(r.o.note), width: 30, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.o.createdBy?.name ?? null) },
    { header: 'Import fayli', value: (r) => txt(r.o.importBatch?.filename ?? null), width: 20 },
  ];

  const ws = ctx.book.sheet('ops', {
    tab: 'Buyurtmalar',
    title: 'Buyurtmalar — savdo, tannarx va foyda',
    desc: 'Har bir buyurtma: hajmi, savdo summasi, tannarxi, transporti va sof foydasi.',
  });
  writeTable(ws, {
    title: 'Buyurtmalar — savdo, tannarx va foyda',
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 2,
    footnote:
      "Bekor qilingan buyurtmalar bu varaqda YOʼQ — ular hech qaysi hisobga kirmaydi. Shuning uchun JAMI qatori bitta: u ekranda koʼrinayotgan qatorlar boʼyicha, ya'ni filtr qoʼysangiz oʼzi qayta hisoblanadi. " +
      "«SOF FOYDA» = savdo − tannarx − transport xarajati. Transport savdo summasining ichida, shuning uchun uni yana qoʼshmang. «Tannarxi aniqmi — Yoʼq» boʼlgan qatorlarning foydasi hali qaror qilinmagan: ularning tannarxi qimmatroq (bank) narxda taxmin qilingan. «Hajm — reja» buyurtma berilgandagi hajm, «haqiqiy» esa zavoddan chiqqani.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ BUYURTMA QATORLARI ══════════════════════

export async function writeOrderItems(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.orderItem.findMany({
    // «Buyurtmalar» varagʼi bilan BIR XIL kesim — bekor qilinganlar yoʼq. Ilgari bu
    // ikki varaq bir xil m³ ni ikki xil qamrovda koʼrsatardi (katalogdagi «Sotilgan
    // hajm» esa uchinchi xil), ya'ni bitta faylning ichida uchta javob bor edi.
    where: { order: { ...(ctx.window ? { date: { gte: ctx.window.gte, lt: ctx.window.lt } } : {}), ...NOT_CANCELLED } },
    orderBy: [{ order: { date: 'asc' } }, { orderId: 'asc' }],
    include: {
      order: {
        select: {
          orderNo: true,
          date: true,
          status: true,
          client: { select: { name: true } },
          factory: { select: { name: true } },
        },
      },
      product: { select: { name: true, size: true, m3PerPallet: true } },
    },
  });

  type R = (typeof rows)[number];
  const effM3 = (r: R): Prisma.Decimal => D(r.actualQuantityM3 ?? r.quantityM3);

  const cols: Col<R>[] = [
    { header: 'Buyurtma №', value: (r) => r.order.orderNo, align: 'center', total: 'count' },
    { header: 'Sana', value: (r) => r.order.date, fmt: NUMFMT.date },
    { header: 'Mijoz', value: (r) => txt(r.order.client?.name ?? null), width: 26 },
    { header: 'Zavod', value: (r) => txt(r.order.factory?.name ?? null), width: 20 },
    { header: STATUS_HEADER, value: (r) => label(ORDER_STATUS, r.order.status), align: 'center' },
    { header: 'Mahsulot', value: (r) => r.product.name, width: 26 },
    { header: "Oʼlchami", value: (r) => txt(r.product.size), align: 'center' },
    { header: 'Hajm — reja (m³)', value: (r) => num0(r.quantityM3), fmt: NUMFMT.m3, total: 'sum' },
    { header: 'Hajm — haqiqiy (m³)', value: (r) => num0(effM3(r)), fmt: NUMFMT.m3, total: 'sum' },
    { header: 'Paddon — reja', value: (r) => r.palletCount, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Paddon — haqiqiy', value: (r) => r.actualPalletCount ?? r.palletCount, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Kitob narxi (m³)', value: (r) => (r.listPricePerM3 ? num0(r.listPricePerM3) : null), fmt: NUMFMT.price },
    { header: 'Sotuv narxi (m³)', value: (r) => num0(r.salePricePerM3), fmt: NUMFMT.price },
    {
      header: 'Chegirma',
      value: (r) =>
        r.listPricePerM3 ? times(D(r.listPricePerM3).minus(r.salePricePerM3), effM3(r)) : null,
      fmt: NUMFMT.money,
      total: 'sum',
    },
    { header: 'Savdo summasi', value: (r) => num0(r.saleTotal), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Kelishilgan qatʼiy summa', value: (r) => (r.saleLumpSum ? num0(r.saleLumpSum) : null), fmt: NUMFMT.money },
    { header: 'Tannarx narxi (m³)', value: (r) => num0(r.costPricePerM3), fmt: NUMFMT.price },
    { header: 'Yakuniy tannarx narxi (m³)', value: (r) => (r.finalCostPricePerM3 ? num0(r.finalCostPricePerM3) : null), fmt: NUMFMT.price },
    { header: 'Tannarx summasi', value: (r) => num0(r.costTotal), fmt: NUMFMT.money, total: 'sum' },
    {
      header: 'Mol foydasi',
      value: (r) => minus(r.saleTotal, r.costTotal),
      fmt: NUMFMT.money,
      total: 'sum',
      tone: profitTone,
    },
    { header: 'Narxlanmagan', value: (r) => (r.pricePending ? L('Ha') : null), align: 'center', tone: () => 'amber' },
  ];

  const ws = ctx.book.sheet('ops', {
    tab: 'Buyurtma qatorlari',
    title: 'Buyurtma qatorlari — mahsulot kesimida',
    desc: 'Har bir buyurtmaning ichidagi mahsulot qatorlari: hajm, narx, tannarx.',
  });
  writeTable(ws, {
    title: 'Buyurtma qatorlari — mahsulot kesimida',
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "Bekor qilingan buyurtmalarning qatorlari bu yerda ham YOʼQ. Buyurtma varagʼidagi summalar shu qatorlarning yigʼindisi. «Kelishilgan qat'iy summa» toʼldirilgan qatorlar zavoddan chiqqan haqiqiy hajmga qarab QAYTA HISOBLANMAYDI — summa qat'iy, shuning uchun bunday qatorda «sotuv narxi» teskari yoʼl bilan chiqarilgan hisob-kitob raqami boʼladi. Paddon hech qachon pul emas — bu ustunlar DONA.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ PADDON XULOSASI ══════════════════════

export async function writePalletSummary(ctx: Ctx): Promise<void> {
  const [clients, factories, clientStats, factoryStats, dealerInHand] = await Promise.all([
    ctx.prisma.client.findMany({ select: { id: true, name: true, active: true, agent: { select: { name: true } } } }),
    ctx.prisma.factory.findMany({ select: { id: true, name: true, active: true } }),
    ctx.pallets.clientPalletStats(),
    ctx.pallets.factoryPalletStats(),
    ctx.pallets.dealerInHand(),
  ]);

  interface Row {
    side: string;
    party: string;
    agent: string | null;
    s: PalletPartyStats;
    active: boolean;
    synthetic?: boolean;
  }

  const rows: Row[] = [];
  for (const f of factories) {
    const s = factoryStats.get(f.id) ?? { ...EMPTY_PALLET_STATS };
    // «Hech qachon paddon ishlatmagan» nofaol tomonlarni koʼrsatmaymiz. Bu tekshiruv
    // ATAYLAB `movements > 0` emas: toʼliq bekor qilingan buyurtma ikki qator qoldiradi
    // (berish + storno) va ular bir-birini yoʼqqa chiqaradi — bunday tomon «tarixi bor»
    // boʼlib koʼrinadi-yu, hamma ustuni nol boʼladi.
    if (!f.active && !hasPalletHistory(s)) continue;
    rows.push({ side: L('Zavod'), party: f.name, agent: null, s, active: f.active });
  }
  for (const c of clients) {
    const s = clientStats.get(c.id) ?? { ...EMPTY_PALLET_STATS };
    if (!c.active && !hasPalletHistory(s)) continue;
    if (!hasPalletHistory(s)) continue;
    rows.push({ side: L('Mijoz'), party: c.name, agent: c.agent?.name ?? null, s, active: c.active });
  }
  if (dealerInHand !== 0) {
    rows.push({
      side: L('Bizda'),
      party: L('Omborimizdagi boʼsh paddon'),
      agent: null,
      s: { ...EMPTY_PALLET_STATS, balance: dealerInHand },
      active: true,
      synthetic: true,
    });
  }

  const cols: Col<Row>[] = [
    { header: 'Tomon', value: (r) => r.side, align: 'center', total: 'count' },
    { header: 'Nomi', value: (r) => r.party, width: 30 },
    { header: 'Agent', value: (r) => txt(r.agent) },
    { header: 'Jami olingan / berilgan', value: (r) => r.s.received, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Jami qaytarilgan', value: (r) => r.s.returned, fmt: NUMFMT.int, total: 'sum' },
    { header: "Yoʼqolgani uchun pulga oʼtkazilgan", value: (r) => r.s.chargedLost, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Tuzatish', value: (r) => r.s.adjustment, fmt: NUMFMT.int, total: 'sum', tone: () => 'muted' },
    {
      header: 'QOLDIQ (dona)',
      value: (r) => r.s.balance,
      fmt: NUMFMT.int,
      total: 'sum',
      tone: (_r, v) => (typeof v === 'number' && v > 0 ? 'violet' : undefined),
    },
    {
      header: "Yoʼqotilgan paddon puli",
      value: (r) => (r.synthetic ? null : num0(r.s.chargedLostAmount)),
      fmt: NUMFMT.money,
      total: 'sum',
    },
    { header: 'Oxirgi berish/olish', value: (r) => (r.s.lastReceivedAt ? new Date(r.s.lastReceivedAt) : null), fmt: NUMFMT.date },
    { header: 'Oxirgi qaytarish', value: (r) => (r.s.lastReturnAt ? new Date(r.s.lastReturnAt) : null), fmt: NUMFMT.date },
    { header: 'Harakatlar soni', value: (r) => r.s.movements, fmt: NUMFMT.int, total: 'sum' },
  ];

  const ws = ctx.book.sheet('ops', {
    tab: 'Paddon xulosasi',
    title: 'Paddon hisobi — zavodlar va mijozlar boʼyicha',
    desc: 'Kim qancha paddon olgan, qanchasini qaytargan va hozir kimda turibdi.',
  });
  writeTable(ws, {
    title: 'Paddon hisobi — zavodlar va mijozlar boʼyicha',
    subtitle: 'BUTUN TARIX boʼyicha — paddon davriy oqim emas, u yurib turgan majburiyat. Sana filtri bu varaqqa qoʼllanmaydi.',
    columns: cols,
    rows,
    freezeCols: 2,
    footnote:
      "Har bir qatorda: QOLDIQ = olingan − qaytarilgan − yoʼqotilgan + tuzatish. «Tuzatish» — qoʼlbola toʼgʼrilashlar va yakka storno yozuvlari; u boʼlmasa ayirish yopilmaydi. Zavod tomonida «Jami olingan» — biz zavoddan olganimiz, «QOLDIQ» — hozir zavodga qarzimiz. Mijoz tomonida «Jami berilgan» — mijozga yuborganimiz, «QOLDIQ» — hozir mijozda turgani. Paddon DONA hisoblanadi; yagona pul ustuni — mijoz yoʼqotgani uchun undirilgan summa. Zavodga paddon qaytarish butunlay pulsiz.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ PADDON HARAKATLARI ══════════════════════

export async function writePalletTransactions(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.palletTransaction.findMany({
    where: dateWhere(ctx.window),
    orderBy: [{ date: 'asc' }, { at: 'asc' }],
    include: {
      client: { select: { name: true } },
      factory: { select: { name: true } },
      order: { select: { orderNo: true } },
      createdBy: { select: { name: true } },
      reversalOf: { select: { type: true, date: true } },
      reversedBy: { select: { id: true } },
      importBatch: { select: { filename: true } },
    },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Sana', value: (r) => r.date, fmt: NUMFMT.date, total: 'count' },
    { header: 'Turi', value: (r) => label(PALLET_TX, r.type), width: 26 },
    { header: 'Mijoz', value: (r) => txt(r.client?.name ?? null), width: 26 },
    { header: 'Zavod', value: (r) => txt(r.factory?.name ?? null), width: 22 },
    { header: 'Buyurtma №', value: (r) => txt(r.order?.orderNo ?? null), align: 'center' },
    { header: 'Miqdor (dona)', value: (r) => r.qty, fmt: NUMFMT.int },
    {
      header: 'Dona narxi',
      value: (r) => (r.unitPrice ? num0(r.unitPrice) : null),
      fmt: NUMFMT.money,
    },
    {
      header: 'Summa',
      value: (r) => (r.unitPrice ? times(r.qty, r.unitPrice) : null),
      fmt: NUMFMT.money,
      total: 'sum',
    },
    { header: 'Storno yozuvi', value: (r) => YES_NO(!!r.reversalOf), align: 'center' },
    { header: 'Nimani bekor qiladi', value: (r) => label(PALLET_TX, r.reversalOf?.type ?? null), width: 24, tone: () => 'slate' },
    { header: 'Storno qilingan', value: (r) => YES_NO(!!r.reversedBy), align: 'center', tone: (r) => (r.reversedBy ? 'slate' : undefined) },
    { header: 'Izoh', value: (r) => txt(r.note), width: 30, wrap: true },
    { header: 'Kiritgan', value: (r) => txt(r.createdBy?.name ?? null) },
    { header: 'Import fayli', value: (r) => txt(r.importBatch?.filename ?? null), width: 20 },
  ];

  const ws = ctx.book.sheet('ops', {
    tab: 'Paddon harakatlari',
    title: 'Paddon harakatlari — har bir yozuv',
    desc: 'Paddonning zavod va mijozlar oʼrtasidagi barcha harakatlari.',
  });
  writeTable(ws, {
    title: 'Paddon harakatlari — har bir yozuv',
    subtitle: ctx.periodLabel,
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "DIQQAT: «Miqdor» ustunini shunchaki QOʼSHMANG. Toʼrtta asosiy turda u musbat saqlanadi va ishorani turning oʼzi beradi (berildi qoʼshadi, qaytarildi ayiradi); «Tuzatish» va «Storno» qatorlarida esa miqdor ISHORALI qoldiq oʼzgarishi boʼladi — masalan qaytarishni bekor qilgan storno MUSBAT boʼladi. Toʼgʼri qoldiq «Paddon xulosasi» varagʼida hisoblab berilgan. Pul faqat «Pulga oʼtkazildi (yoʼqolgan)» qatorlarida boʼladi — zavodga qaytarish hech qachon pulli emas.",
  });
  ctx.book.count(ws, rows.length);
}
