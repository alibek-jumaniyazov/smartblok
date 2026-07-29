import { cyr } from '../common/translit';
import { Book } from '../export/xlsx/book';
import {
  FACTORY_PAY_INTENT,
  COST_STATUS,
  ORDER_STATUS,
  PAYMENT_KIND,
  PAYMENT_METHOD,
  ROLES,
  label,
} from '../export/xlsx/labels';
import {
  debtTone,
  dt,
  kpiRow,
  num0,
  profitTone,
  sectionHeading,
  titleBand,
  writeTable,
  type Col,
  type KpiLine,
} from '../export/xlsx/sheet-builder';
import { NUMFMT } from '../export/xlsx/theme';
import { formatDate, writeContents, writeCover } from '../export/sheets/cover';
import type { FactoryReport, FactoryReportOrderRow, FactoryReportOrdersResponse, PriceBucket } from './types';

/** «Narxi kiritilmagan» chelagi raqam emas, HOLAT — Excelda ham shunday o'qilsin. */
const priceLabel = (b: PriceBucket): string | number =>
  b.priceMissing ? cyr('narxi kiritilmagan') : Number(b.pricePerM3);

const FAMILY: Record<'CASH' | 'BANK' | 'BONUS', string> = {
  CASH: 'naqd',
  BANK: "o'tkazma",
  BONUS: 'bonusdan',
};

/**
 * ═══════════════ ZAVOD HISOBOTI — EXCEL ═══════════════
 *
 * Kitobdagi HAR BIR raqam `FactoryReportService` dan tayyor holda keladi va bu yerda
 * QAYTA HISOBLANMAYDI. To'liq eksportda ham shu qoida amal qiladi (export.service.ts):
 * faylni ochgan odam saytdagi ekran bilan bir xil sonni ko'rishi shart, aks holda
 * ikkalasidan qaysi biri to'g'ri ekanini hech kim ayta olmaydi.
 */
export async function buildFactoryReportWorkbook(
  data: { report: FactoryReport; orders: FactoryReportOrdersResponse },
  author: { name: string; role: string },
): Promise<{ buffer: Buffer; filename: string }> {
  const { report: r, orders } = data;
  const book = new Book(author.name);
  const now = new Date();
  const periodLine = r.period.from || r.period.to ? `Davr: ${r.period.label}` : 'Butun davr';

  const cover = book.sheet('cover', {
    tab: 'Muqova',
    title: `Zavod hisoboti — ${r.factory.name}`,
    desc: 'Kim, qachon va qaysi davr uchun yaratgani.',
  });
  const contents = book.sheet('cover', {
    tab: 'Mundarija',
    title: 'Mundarija',
    desc: 'Varaqlar ro‘yxati va ularda nima borligi.',
  });

  writeSummarySheet(book, r, periodLine);
  writeProductsSheet(book, r, periodLine);
  writePricesSheet(book, r, periodLine);
  writePaymentsSheet(book, r, periodLine);
  writeOrdersSheet(book, orders, periodLine, r.factory.name);

  writeCover(
    cover,
    {
      generatedAt: now,
      // Muqova shapkasi kitobning HAQIQIY qamrovini aytadi — to'liq eksportning
      // «butun biznes bitta faylda» matni bu yerda yolg'on bo'lardi.
      subtitle: `Zavod boʼyicha hisobot — ${r.factory.name}`,
      author: author.name,
      // Xom enum («ACCOUNTANT») emas — butun kitob kirillcha, muqovada ham shunday bo'lsin
      authorRole: ROLES[author.role as keyof typeof ROLES]
        ? cyr(ROLES[author.role as keyof typeof ROLES])
        : author.role,
      periodLabel: cyr(periodLine),
      // Muqovadagi bu qator «bazadagi ma'lumot oralig'i» deb nomlanadi. Bu fayl BITTA
      // zavod haqida, shuning uchun u yerga hisobotning o'z qamrovi yoziladi — buyurtma
      // soni yoki hajm EMAS (ular Xulosa varag'ida turadi va bu yerda chalkashtirardi).
      dataRangeLabel: cyr(`${r.factory.name} — faqat shu zavod, ${periodLine.toLowerCase()}`),
    },
    book,
  );
  writeContents(contents, book);

  const buffer = await book.toBuffer();
  const filename = `${cyr(`SmartBlok zavod hisoboti — ${r.factory.name}`)} ${formatDate(now)}.xlsx`;
  return { buffer, filename };
}

// ─────────────────────────── Xulosa ───────────────────────────

function writeSummarySheet(book: Book, r: FactoryReport, periodLine: string): void {
  const ws = book.sheet('kpi', {
    tab: 'Xulosa',
    title: `Xulosa — ${r.factory.name}`,
    desc: 'Olingan mol, to‘langan pul, qarz va avans — bir sahifada.',
  });
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 72;

  titleBand(ws, {
    title: `Zavod hisoboti — ${r.factory.name}`,
    subtitle: `${periodLine}. Qoldiqlar ikki ustunda: davr oxiriga va bugungi holat.`,
    colCount: 3,
  });

  let row = 5;
  let lines = 0;
  const put = (items: KpiLine[]) => {
    for (const line of items) {
      kpiRow(ws, row, line);
      row += 1;
      lines += 1;
    }
    row += 1;
  };
  const head = (latin: string) => {
    sectionHeading(ws, row, latin, 3);
    row += 1;
  };

  head('Zavoddan olingan mol');
  put([
    { label: 'Buyurtmalar soni', value: r.purchase.orders, fmt: NUMFMT.int },
    {
      label: 'Jami hajm (m³)',
      value: num0(r.purchase.cubeM3),
      fmt: NUMFMT.m3,
      strong: true,
      hint: 'Haqiqiy yuk boʼyicha (zavoddan chiqqanda oʼzgargan boʼlsa — oʼzgargani).',
    },
    { label: 'Reja boʼyicha hajm (m³)', value: num0(r.purchase.plannedCubeM3), fmt: NUMFMT.m3 },
    {
      label: 'Jami tannarx',
      value: num0(r.purchase.costTotal),
      fmt: NUMFMT.moneyRound,
      strong: true,
      hint: 'Faqat bloklar. Poddon naturada hisoblanadi — pulga aylanmaydi.',
    },
    {
      label: 'Oʼrtacha 1 m³ narxi',
      value: r.purchase.avgPricePerM3 === null ? null : num0(r.purchase.avgPricePerM3),
      hint: 'Jami tannarx ÷ jami hajm. Bu oʼrtacha — narxnoma raqami emas.',
    },
    { label: 'Olingan poddon (davr)', value: r.purchase.palletsReceived, fmt: NUMFMT.int },
    { label: 'Qaytarilgan poddon (davr)', value: r.purchase.palletsReturned, fmt: NUMFMT.int },
    {
      label: 'Bekor qilingan buyurtmalar',
      value: r.purchase.cancelledOrders,
      fmt: NUMFMT.int,
      hint: 'Faqat son. Bularning birorta raqami yuqoridagi yakunlarga kirmagan.',
    },
  ]);

  head('Zavodga toʼlangan pul — toʼlov usuli boʼyicha');
  put([
    { label: 'Naqd (kassadan)', value: num0(r.payments.paidCash) },
    { label: 'Oʼtkazma (bankdan)', value: num0(r.payments.paidBank) },
    {
      label: 'Jami toʼlangan',
      value: num0(r.payments.paid),
      strong: true,
      hint: 'Kassadan haqiqatan chiqqan pul. Bonusdan yopilgani bunga KIRMAYDI.',
    },
    { label: 'Zavod qaytargani', value: num0(r.payments.refunded) },
    { label: 'Sof oʼtkazilgan', value: num0(r.payments.netPaid), strong: true },
    {
      label: 'Bonusdan yopilgan',
      value: num0(r.payments.bonusOffset),
      hint: 'Qarzni kamaytirdi, lekin kassadan bir soʼm ham chiqmadi — shuning uchun alohida turadi.',
    },
    { label: 'Toʼlov hujjatlari soni', value: r.payments.paymentCount, fmt: NUMFMT.int },
  ]);

  head('Qaysi narxnomada yopildi (narx kanali)');
  put([
    { label: 'Naqd narxnomada', value: num0(r.settlement.byPriceKind.cash) },
    { label: 'Oʼtkazma narxnomada', value: num0(r.settlement.byPriceKind.bank) },
    {
      label: 'Kanali koʼrsatilmagan',
      value: num0(r.settlement.byPriceKind.unknown),
      hint: 'Eski yozuvlar. Oʼtkazmaga QOʼSHILMAYDI — aks holda naqd va bank raqamlari yolgʼon chiqardi.',
    },
    {
      label: 'Jami taqsimlangan',
      value: num0(r.settlement.byPriceKind.total),
      strong: true,
      hint: 'Bu raqam yuqoridagi «jami toʼlangan» bilan teng chiqmasligi NORMAL: taqsimlanmagan avans farqni tashkil qiladi.',
    },
    { label: 'Avansdan yechilgan — naqd', value: num0(r.settlement.drawnFromAdvance.cash) },
    { label: 'Avansdan yechilgan — oʼtkazma', value: num0(r.settlement.drawnFromAdvance.bank) },
    { label: 'Avansga tushgan — naqd', value: num0(r.settlement.advanceIn.cash) },
    { label: 'Avansga tushgan — oʼtkazma', value: num0(r.settlement.advanceIn.bank) },
  ]);

  head('Qarz va avans — davr oxiriga');
  put(balanceLines(r.balances.asOfPeriodEnd, r.balances.offBook.asOfPeriodEnd));

  head('Qarz va avans — bugungi holat');
  put(balanceLines(r.balances.current, r.balances.offBook.current));

  head('Bonus va poddon');
  put([
    { label: 'Davrda hisoblangan bonus', value: num0(r.bonus.accruedInPeriod) },
    { label: 'Davrda qarzga oʼtkazilgan bonus', value: num0(r.bonus.offsetInPeriod) },
    { label: 'Bonus hamyoni — bugungi qoldiq', value: num0(r.bonus.walletCurrent) },
    {
      label: 'Zavodga poddon qarzimiz (jami)',
      value: r.pallets.balance,
      fmt: NUMFMT.int,
      hint: 'Butun tarix boʼyicha. Poddon donada hisoblanadi, pulga aylanmaydi.',
    },
  ]);

  head('Nazorat (farq boʼlsa shu yerda koʼrinadi)');
  put([
    { label: 'Σ buyurtma tannarxi', value: num0(r.checks.orderCostTotal) },
    {
      label: 'Farq (pozitsiyalar bilan)',
      value: num0(r.checks.costTotalDrift),
      hint: 'Normal holat — 0. Nolga teng boʼlmasa buyurtma jamlari pozitsiyalar yigʼindisidan ajralib qolgan.',
    },
    {
      label: 'Narxnoma boʼyicha boʼlishi kerak edi',
      value: num0(r.checks.anchorCostTotal),
      hint: 'Hajm × narxnoma narxi. Yuqoridagi tannarxdan farq qilsa — toʼlov buyurtmani boshqa kanal narxida yopgan.',
    },
    {
      label: 'Narxi kiritilmagan hajm (m³)',
      value: num0(r.checks.zeroPricedCubeM3),
      fmt: NUMFMT.m3,
      hint: 'Bu hajm tannarxga 0 soʼm boʼlib tushgan — mahsulotga zavod narxi kiritilmagan.',
    },
    { label: 'Aralash narxda yopilgan pozitsiyalar', value: r.checks.blendedItems, fmt: NUMFMT.int },
  ]);

  book.count(ws, lines);
}

function balanceLines(b: FactoryReport['balances']['current'], offBook: string): KpiLine[] {
  return [
    {
      label: 'Zavodga qarzimiz',
      value: num0(b.payable) < 0 ? -num0(b.payable) : 0,
      strong: true,
      tone: num0(b.payable) < 0 ? 'danger' : undefined,
      hint: 'Ochiq mol qarzi. Zavodda turgan avans buni avtomatik yopmaydi.',
    },
    // BRUTTO choʼntaklar (advanceCash/Bank/Total) ATAYLAB yozilmaydi — ochiq mol qarzi
    // turganda ular egasining kitobida umuman yoʼq raqamni beradi (oʼtkazma 489 470 806
    // against uning 391 595 430 i). Qarz yuqorida, qolgan pul quyida — ikkalasi ham bor.
    {
      label: 'Zavodda qolgan pulimiz',
      value: num0(b.net),
      strong: true,
      tone: num0(b.net) > 0 ? 'success' : undefined,
      hint: 'Zavodga oʼtkazganimizdan yopilmagan mol qarzi ayirilgan. Musbat — pulimiz zavodda; manfiy — biz qarzdormiz.',
    },
    {
      label: 'Shundan qoʼlda tuzatish',
      value: num0(offBook),
      hint: 'Off-book tuzatish. Zavod kartochkasida hisobga olinadi, Boshqaruv paneli va Qarzlar sahifasida esa — yoʼq.',
    },
  ];
}

// ─────────────────────────── Mahsulotlar ───────────────────────────

/** Mahsulot sarlavhasi + uning ostidagi narx qatorlari — bitta tekis jadvalda. */
interface ProductLine {
  isProduct: boolean;
  product: string;
  size: string | null;
  priceCell: string | number | null;
  cubeM3: number;
  costTotal: number;
  anchorTotal: number | null;
  avg: number | null;
  pallets: number | null;
  orders: number;
}

function writeProductsSheet(book: Book, r: FactoryReport, periodLine: string): void {
  const ws = book.sheet('ops', {
    tab: 'Mahsulotlar',
    title: 'Mahsulot va narx boʼyicha taqsimot',
    desc: 'Har mahsulotdan qancha kub olingani va uning ichida qaysi narxda qanchasi.',
  });

  const rows: ProductLine[] = [];
  for (const p of r.products) {
    rows.push({
      isProduct: true,
      product: p.productName,
      size: p.size,
      priceCell: null,
      cubeM3: num0(p.cubeM3),
      costTotal: num0(p.costTotal),
      anchorTotal: null,
      avg: p.avgPricePerM3 === null ? null : num0(p.avgPricePerM3),
      pallets: p.palletCount,
      orders: p.orders,
    });
    for (const b of p.prices) {
      rows.push({
        isProduct: false,
        product: `    ${p.productName}`,
        size: null,
        priceCell: priceLabel(b),
        cubeM3: num0(b.cubeM3),
        costTotal: num0(b.costTotal),
        anchorTotal: num0(b.anchorTotal),
        avg: null,
        pallets: null,
        orders: b.orders,
      });
    }
  }

  const cols: Col<ProductLine>[] = [
    { header: 'Mahsulot', value: (x) => x.product, width: 34 },
    { header: 'Oʼlchami', value: (x) => x.size, width: 14 },
    { header: 'Narx (1 m³)', value: (x) => x.priceCell, fmt: NUMFMT.price, width: 18, align: 'right' },
    // JAMI qatori bu varaqda ATAYLAB yo'q: mahsulot sarlavhasi o'z narx qatorlarining
    // yig'indisi, ikkalasini qo'shgan «jami» hamma raqamni ikki barobar ko'rsatardi.
    // Yalpi yakun «Narxlar» varag'ida turadi va u yerda JAMI qatori bor.
    { header: 'Hajm (m³)', value: (x) => x.cubeM3, fmt: NUMFMT.m3, width: 14 },
    { header: 'Summa', value: (x) => x.costTotal, fmt: NUMFMT.money, width: 18 },
    {
      header: 'Narxnoma boʼyicha',
      value: (x) => x.anchorTotal,
      fmt: NUMFMT.money,
      width: 18,
    },
    { header: 'Oʼrtacha 1 m³', value: (x) => x.avg, fmt: NUMFMT.price, width: 16 },
    { header: 'Poddon', value: (x) => x.pallets, fmt: NUMFMT.int, width: 10 },
    { header: 'Buyurtma', value: (x) => x.orders, fmt: NUMFMT.int, width: 12 },
  ];

  const n = writeTable(ws, {
    title: 'Mahsulot va narx boʼyicha taqsimot',
    // Matn AYNAN ko'rinadigan narsani aytadi: writeTable qatorlarni qalinlashtirmaydi,
    // ajratuvchi belgi — nomdagi surish. «Qalin qatorlar» deb yozish varaqni o'zi haqida
    // yolg'on gapirtirardi.
    subtitle:
      `${periodLine}. Har mahsulotdan keyin — oʼsha mahsulotning narx boʼyicha kesimi `
      + `(nomi ichkariga surilgan qatorlar). «Narx» ustuni boʼsh qator — mahsulot jami.`,
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      'Hajm — haqiqiy olingan yuk. Narx — buyurtmaning oʼz narxnoma raqami (narx kitobidan qayta oʼqilmaydi). '
      + '«Narxnoma boʼyicha» ustuni «Summa» dan farq qilsa, oʼsha buyurtma boshqa kanal narxida yopilgan.',
    emptyText: 'Bu davrda bu zavoddan mol olinmagan',
  });
  book.count(ws, n);
}

// ─────────────────────────── Narxlar ───────────────────────────

function writePricesSheet(book: Book, r: FactoryReport, periodLine: string): void {
  const ws = book.sheet('ops', {
    tab: 'Narxlar',
    title: 'Narx boʼyicha yalpi taqsimot',
    desc: 'Mahsulotdan qatʼi nazar: qaysi narxda jami qancha kub olingan.',
  });

  const cols: Col<PriceBucket>[] = [
    { header: 'Narx (1 m³)', value: (b) => priceLabel(b), fmt: NUMFMT.price, width: 20, align: 'right' },
    { header: 'Hajm (m³)', value: (b) => num0(b.cubeM3), fmt: NUMFMT.m3, width: 16, total: 'sum' },
    { header: 'Summa', value: (b) => num0(b.costTotal), fmt: NUMFMT.money, width: 20, total: 'sum' },
    { header: 'Narxnoma boʼyicha', value: (b) => num0(b.anchorTotal), fmt: NUMFMT.money, width: 20, total: 'sum' },
    { header: 'Pozitsiya', value: (b) => b.items, fmt: NUMFMT.int, width: 12, total: 'sum' },
    { header: 'Buyurtma', value: (b) => b.orders, fmt: NUMFMT.int, width: 12 },
  ];

  const n = writeTable(ws, {
    title: 'Narx boʼyicha yalpi taqsimot',
    subtitle: `${periodLine}. «500 000 narxda 100 m³» degan savolning javobi shu jadvalda.`,
    columns: cols,
    rows: r.priceBreakdown,
    totals: true,
    footnote:
      '«Narxi kiritilmagan» qatori — mahsulotga zavod narxi kiritilmagani uchun tannarxga 0 soʼm boʼlib tushgan hajm. '
      + 'U ATAYLAB yashirilmaydi: aks holda jami tannarx jimgina kam koʼrinardi.',
    emptyText: 'Bu davrda bu zavoddan mol olinmagan',
  });
  book.count(ws, n);
}

// ─────────────────────────── To'lovlar ───────────────────────────

type MethodRow = FactoryReport['payments']['byMethod'][number];

function writePaymentsSheet(book: Book, r: FactoryReport, periodLine: string): void {
  const ws = book.sheet('money', {
    tab: 'Toʼlovlar',
    title: 'Zavodga toʼlangan pul — usul boʼyicha',
    desc: 'Har toʼlov usuli boʼyicha summa va hujjatlar soni.',
  });

  /**
   * «Kassadan chiqqan pul» — BELGILI ustun, va JAMI faqat shundan olinadi.
   *
   * Xom «Summa» ustuniga jami qo'yish jimgina yolg'on berardi: qatorlar orasida
   * FACTORY_REFUND (zavod bizga QAYTARGAN pul) va method=BONUS (umuman pul emas) ham bor,
   * ikkalasi ham bazada MUSBAT saqlanadi — yo'nalishni faqat `kind` belgilaydi. Ularni
   * qo'shgan «JAMI» Xulosa varag'idagi «Jami to'langan» dan katta chiqar va bitta kitobda
   * ikkita bir-biriga zid yakun turardi. Bu — eksport modulining o'z naqshi
   * (export/sheets/payments.ts: «Pul oqimi (belgili)»).
   */
  const flow = (x: MethodRow): number | null => {
    if (x.family === 'BONUS') return null; // kassa qimirlamagan — oqimda ishtirok etmaydi
    return x.kind === 'FACTORY_REFUND' ? -num0(x.amount) : num0(x.amount);
  };

  const cols: Col<MethodRow>[] = [
    { header: 'Turi', value: (x) => label(PAYMENT_KIND, x.kind), width: 24 },
    { header: 'Usuli', value: (x) => label(PAYMENT_METHOD, x.method), width: 22 },
    { header: 'Kanal', value: (x) => cyr(FAMILY[x.family]), width: 16 },
    { header: 'Summa', value: (x) => num0(x.amount), fmt: NUMFMT.money, width: 22 },
    {
      header: 'Kassa oqimi (belgili)',
      value: (x) => flow(x),
      fmt: NUMFMT.money,
      width: 22,
      total: 'sum',
      tone: profitTone,
    },
    { header: 'Hujjat', value: (x) => x.count, fmt: NUMFMT.int, width: 12, total: 'sum' },
  ];

  const n = writeTable(ws, {
    title: 'Zavodga toʼlangan pul — usul boʼyicha',
    subtitle: `${periodLine}. «Kanal» — pul kassaning qaysi tomonidan chiqqani.`,
    columns: cols,
    rows: r.payments.byMethod,
    totals: true,
    footnote:
      'JAMI faqat «Kassa oqimi» ustunidan olinadi va u Xulosa varagʼidagi «Sof oʼtkazilgan» ga TENG: '
      + 'zavod qaytargan pul minus belgi bilan, bonusdan yopilgani esa umuman qatnashmaydi (kassadan bir soʼm ham chiqmagan). '
      + 'Xom «Summa» ustuniga jami ATAYLAB qoʼyilmagan — u chiqim, qaytim va bonusni bitta songa qoʼshib yuborardi. '
      + 'Bu jadval toʼlov USULI haqida; qaysi NARXNOMADA yopilgani boshqa savol va u «Xulosa» varagʼida turadi.',
    emptyText: 'Bu davrda bu zavodga toʼlov qilinmagan',
  });
  book.count(ws, n);
}

// ─────────────────────────── Buyurtmalar ───────────────────────────

function writeOrdersSheet(
  book: Book,
  orders: FactoryReportOrdersResponse,
  periodLine: string,
  factoryName: string,
): void {
  const ws = book.sheet('ops', {
    tab: 'Buyurtmalar',
    title: 'Davrdagi buyurtmalar',
    desc: 'Har bir buyurtma: sana, mijoz, mahsulotlar, hajm, tannarx, toʼlangani va qoldigʼi.',
  });

  const cols: Col<FactoryReportOrderRow>[] = [
    { header: 'Buyurtma №', value: (o) => o.orderNo, width: 16, total: 'count' },
    { header: 'Sana', value: (o) => dt(o.date), fmt: NUMFMT.date, width: 14 },
    { header: 'Mijoz', value: (o) => o.client?.name ?? null, width: 30 },
    { header: 'Mahsulotlar', value: (o) => o.products.map((p) => p.name).join(', ') || null, width: 34, wrap: true },
    { header: 'Hajm (m³)', value: (o) => num0(o.cubeM3), fmt: NUMFMT.m3, width: 14, total: 'sum' },
    { header: 'Poddon', value: (o) => o.palletCount, fmt: NUMFMT.int, width: 10, total: 'sum' },
    { header: 'Tannarx', value: (o) => num0(o.costTotal), fmt: NUMFMT.money, width: 20, total: 'sum' },
    { header: 'Toʼlangan', value: (o) => num0(o.factoryPaid), fmt: NUMFMT.money, width: 20, total: 'sum' },
    {
      header: 'Qoldiq',
      value: (o) => num0(o.factoryOpen),
      fmt: NUMFMT.money,
      width: 20,
      total: 'sum',
      tone: debtTone,
    },
    { header: 'Toʼlash niyati', value: (o) => label(FACTORY_PAY_INTENT, o.factoryPayIntent), width: 18 },
    { header: 'Tannarx holati', value: (o) => label(COST_STATUS, o.costStatus), width: 18 },
    { header: 'Holat', value: (o) => label(ORDER_STATUS, o.status), width: 16 },
  ];

  const n = writeTable(ws, {
    title: `Davrdagi buyurtmalar — ${factoryName}`,
    subtitle: `${periodLine}. Bekor qilingan buyurtmalar bu roʼyxatga umuman kirmaydi${
      orders.summary.cancelledOrders > 0 ? ` (${orders.summary.cancelledOrders} ta)` : ''
    }.`,
    columns: cols,
    rows: orders.items,
    freezeCols: 2,
    totals: true,
    footnote:
      '«Qoldiq» — zavodga hali toʼlanmagani. Tannarx daftarga hali tushmagan buyurtmada u 0 boʼladi '
      + '(mol zavoddan chiqmaguncha zavod qarzi tugʼilmaydi).',
    emptyText: 'Bu davrda buyurtma yoʼq',
  });
  book.count(ws, n);
}
