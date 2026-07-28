import { PriceKind, Prisma } from '@prisma/client';
import type { Worksheet } from 'exceljs';
import { cyr } from '../../common/translit';
import { LEGAL_ENTITY_KIND, PRICE_KIND, ROLES, ACTIVE, YES_NO, L, label } from '../xlsx/labels';
import { COLOR, FONT, NUMFMT, THIN_BORDER, fill } from '../xlsx/theme';
import { colLetter, num0, sectionHeading, titleBand, txt, writeTable, type Col } from '../xlsx/sheet-builder';
import { NOT_CANCELLED } from '../../common/order-scope';
import type { Ctx } from './ctx';
import { programText } from './parties';

// ══════════════════════════ MAHSULOTLAR ══════════════════════════

export async function writeProducts(ctx: Ctx): Promise<void> {
  const now = new Date();
  const [products, prices, itemAgg] = await Promise.all([
    ctx.prisma.product.findMany({
      orderBy: [{ active: 'desc' }, { factory: { name: 'asc' } }, { name: 'asc' }],
      include: { factory: { select: { name: true } } },
    }),
    // Kuchdagi narx = effectiveFrom <= HOZIR boʼlganlarning eng oxirgisi.
    ctx.prisma.productPrice.findMany({
      where: { effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'desc' },
      select: { productId: true, kind: true, pricePerM3: true, effectiveFrom: true },
    }),
    ctx.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: NOT_CANCELLED },
      _sum: { quantityM3: true },
      _count: true,
    }),
  ]);

  const current = new Map<string, Prisma.Decimal>();
  for (const p of prices) {
    const key = `${p.productId}:${p.kind}`;
    if (!current.has(key)) current.set(key, p.pricePerM3);
  }
  const usage = new Map(itemAgg.map((g) => [g.productId, g]));

  type P = (typeof products)[number];
  const price = (p: P, kind: PriceKind): number | null => {
    const v = current.get(`${p.id}:${kind}`);
    return v ? num0(v) : null;
  };

  const cols: Col<P>[] = [
    { header: 'Mahsulot', value: (r) => r.name, width: 28, total: 'count' },
    { header: 'Zavod', value: (r) => r.factory.name, width: 22 },
    { header: "Oʼlchami", value: (r) => txt(r.size), align: 'center' },
    { header: 'Paddonda (m³)', value: (r) => num0(r.m3PerPallet), fmt: NUMFMT.m3 },
    { header: 'Paddonda (blok)', value: (r) => r.blocksPerPallet, fmt: NUMFMT.int },
    { header: "Oʼlchov birligi", value: (r) => r.unit, align: 'center' },
    { header: 'Joriy narx — zavod naqd', value: (r) => price(r, PriceKind.FACTORY_CASH), fmt: NUMFMT.price },
    { header: "Joriy narx — zavod oʼtkazma", value: (r) => price(r, PriceKind.FACTORY_BANK), fmt: NUMFMT.price },
    { header: 'Joriy narx — sotuv', value: (r) => price(r, PriceKind.DEALER_SALE), fmt: NUMFMT.price },
    { header: 'Sotilgan hajm (m³)', value: (r) => num0(usage.get(r.id)?._sum.quantityM3 ?? 0), fmt: NUMFMT.m3, total: 'sum' },
    { header: 'Buyurtma qatorlari', value: (r) => usage.get(r.id)?._count ?? 0, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Holati', value: (r) => ACTIVE(r.active), align: 'center' },
  ];

  const ws = ctx.book.sheet('ref', {
    tab: 'Mahsulotlar',
    title: 'Mahsulotlar va joriy narxlar',
    desc: 'Mahsulot katalogi, bugungi narxlari va sotuv hajmi.',
  });
  writeTable(ws, {
    title: 'Mahsulotlar va joriy narxlar',
    subtitle: 'Narxlar — BUGUNGI kuchdagi narxlar. Eski buyurtmalar oʼz sanasidagi narx bilan yozilgan.',
    columns: cols,
    rows: products,
    freezeCols: 1,
    footnote:
      "Bu yerdagi narx BUGUNGI kuchdagi narx. Buyurtma esa oʼz sanasidagi narx bilan hisoblangan — shuning uchun eski buyurtmaning narxi bu ustundan farq qilishi normal. Narxlarning toʼliq tarixi «Narx kitobi» varagʼida. Mijozga maxsus narx belgilangan boʼlsa, u shu katalog narxini bekor qiladi.",
  });
  ctx.book.count(ws, products.length);
}

// ══════════════════════════ NARX KITOBI ══════════════════════════

export async function writeProductPrices(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.productPrice.findMany({
    orderBy: [{ product: { name: 'asc' } }, { kind: 'asc' }, { effectiveFrom: 'desc' }],
    include: { product: { select: { name: true, factory: { select: { name: true } } } } },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Mahsulot', value: (r) => r.product.name, width: 28, total: 'count' },
    { header: 'Zavod', value: (r) => r.product.factory.name, width: 22 },
    { header: 'Narx turi', value: (r) => label(PRICE_KIND, r.kind), width: 20 },
    { header: 'Narx (m³)', value: (r) => num0(r.pricePerM3), fmt: NUMFMT.price },
    { header: 'Kuchga kirgan', value: (r) => r.effectiveFrom, fmt: NUMFMT.date },
  ];

  const ws = ctx.book.sheet('ref', {
    tab: 'Narx kitobi',
    title: 'Narx kitobi — butun tarix',
    desc: 'Har bir mahsulot narxining barcha versiyalari va qachondan kuchga kirgani.',
  });
  writeTable(ws, {
    title: 'Narx kitobi — butun tarix',
    subtitle: 'Narx hech qachon tahrirlanmaydi — yangi sana bilan yangi qator qoʼshiladi.',
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "Buyurtma yaratilganda kuchdagi narx — sanasi buyurtma sanasidan katta boʼlmagan eng oxirgi qator. Shuning uchun bu jadval buyurtmalardagi narxni tekshirish uchun ishlatiladi. Narx ustunini QOʼSHMANG — bu narx, summa emas.",
  });
  ctx.book.count(ws, rows.length);
}

// ═══════════════════ MIJOZ MAXSUS NARXLARI ═══════════════════

export async function writeClientPrices(ctx: Ctx): Promise<void> {
  const rows = await ctx.prisma.clientPrice.findMany({
    orderBy: [{ client: { name: 'asc' } }, { effectiveFrom: 'desc' }],
    include: {
      client: { select: { name: true } },
      product: { select: { name: true, factory: { select: { name: true } } } },
    },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Mijoz', value: (r) => r.client.name, width: 28, total: 'count' },
    { header: 'Mahsulot', value: (r) => r.product.name, width: 26 },
    { header: 'Zavod', value: (r) => r.product.factory.name, width: 20 },
    { header: 'Maxsus narx (m³)', value: (r) => num0(r.pricePerM3), fmt: NUMFMT.price },
    { header: 'Kuchga kirgan', value: (r) => r.effectiveFrom, fmt: NUMFMT.date },
  ];

  const ws = ctx.book.sheet('ref', {
    tab: 'Mijoz narxlari',
    title: 'Mijozlarning maxsus narxlari',
    desc: 'Ayrim mijozlar uchun belgilangan, katalog narxidan ustun turadigan narxlar.',
  });
  writeTable(ws, {
    title: 'Mijozlarning maxsus narxlari',
    subtitle: 'Bu narx shu mijoz uchun katalogdagi sotuv narxini BEKOR QILADI.',
    columns: cols,
    rows,
    freezeCols: 1,
    emptyText: 'Maxsus narx belgilanmagan — hamma mijozga katalog narxi qoʼllanadi',
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ FOYDALANUVCHILAR ══════════════════════

export async function writeUsers(ctx: Ctx): Promise<void> {
  // Parol xeshi ATAYLAB olinmaydi — eksport fayli qoʼldan qoʼlga oʼtadi.
  const rows = await ctx.prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: {
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      active: true,
      lastLoginAt: true,
      createdAt: true,
      agent: { select: { name: true } },
    },
  });

  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { header: 'Ism', value: (r) => r.name, width: 26, total: 'count' },
    { header: 'Login', value: (r) => r.username, width: 20 },
    { header: 'Roli', value: (r) => label(ROLES, r.role), align: 'center', width: 16 },
    { header: 'Agent', value: (r) => txt(r.agent?.name ?? null), width: 20 },
    { header: 'Elektron pochta', value: (r) => txt(r.email), width: 26 },
    { header: 'Telefon', value: (r) => txt(r.phone), fmt: NUMFMT.text },
    { header: 'Oxirgi kirish', value: (r) => r.lastLoginAt, fmt: NUMFMT.dateTime },
    { header: 'Yaratilgan', value: (r) => r.createdAt, fmt: NUMFMT.date },
    { header: 'Holati', value: (r) => ACTIVE(r.active), align: 'center' },
  ];

  const ws = ctx.book.sheet('ref', {
    tab: 'Foydalanuvchilar',
    title: 'Tizim foydalanuvchilari',
    desc: 'Kim tizimga kira oladi va qaysi rol bilan.',
  });
  writeTable(ws, {
    title: 'Tizim foydalanuvchilari',
    subtitle: 'Parollar eksport qilinmaydi.',
    columns: cols,
    rows,
    freezeCols: 1,
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════ IMPORT PARTIYALARI ══════════════════════

export async function writeImportBatches(ctx: Ctx): Promise<void> {
  const [batches, counts] = await Promise.all([
    ctx.prisma.importBatch.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true } } },
    }),
    // Faqat TIRIK buyurtmalar sanaladi. Import qaytarilganda (rollback) uning
    // buyurtmalari o'chirilmaydi — bekor qilinadi; shu sabab bu ustun qaytarilgan
    // partiya uchun ham to'laligicha turaverar, ya'ni «bu fayldan 113 ta buyurtma»
    // deb ko'rsatardi, holbuki ularning biri ham kitobning boshqa hech qaysi
    // varag'ida sanalmaydi. Endi qaytarilgan partiyada bu ustun 0 bo'ladi —
    // «Qaytarilgan» sanasi yonida aynan shunday o'qilishi kerak.
    ctx.prisma.order.groupBy({
      by: ['importBatchId'],
      _count: true,
      where: { importBatchId: { not: null }, ...NOT_CANCELLED },
    }),
  ]);
  const orderCount = new Map(counts.map((g) => [g.importBatchId as string, g._count]));

  type R = (typeof batches)[number];
  const cols: Col<R>[] = [
    { header: 'Fayl nomi', value: (r) => r.filename, width: 34, total: 'count' },
    { header: 'Holati', value: (r) => r.status, align: 'center', width: 16 },
    { header: 'Yuklangan', value: (r) => r.createdAt, fmt: NUMFMT.dateTime },
    { header: 'Bazaga yozilgan', value: (r) => r.committedAt, fmt: NUMFMT.dateTime },
    { header: 'Qaytarilgan', value: (r) => r.rolledBackAt, fmt: NUMFMT.dateTime },
    { header: 'Buyurtmalar', value: (r) => orderCount.get(r.id) ?? 0, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Kim yuklagan', value: (r) => txt(r.createdBy?.name ?? null), width: 22 },
    { header: 'Xato', value: (r) => txt(r.error), width: 40, wrap: true },
  ];

  const ws = ctx.book.sheet('raw', {
    tab: 'Import partiyalari',
    title: 'Excel importlari tarixi',
    desc: 'Qaysi fayl, qachon va kim tomonidan bazaga koʼchirilgan.',
  });
  writeTable(ws, {
    title: 'Excel importlari tarixi',
    subtitle:
      'Bazadagi maʼlumot qaysi fayldan kelganini shu yerdan kuzatish mumkin. «Buyurtmalar» ustuni — shu fayldan kelib, HOZIR ham kuchda turgan buyurtmalar soni; import qaytarilgan boʼlsa u 0 boʼladi.',
    columns: cols,
    rows: batches,
    freezeCols: 1,
    emptyText: 'Hech qanday Excel import qilinmagan — barcha maʼlumot tizimning oʼzida kiritilgan',
  });
  ctx.book.count(ws, batches.length);
}

// ══════════════════════════ MAʼLUMOTNOMA ══════════════════════════

/**
 * Kichik ma'lumotnomalar bitta varaqda, bloklar ko'rinishida.
 *
 * Har biriga alohida varaq berilsa, kitobda beshta deyarli bo'sh yorliq paydo bo'ladi
 * va mundarija shovqinga to'ladi. Bu yerda esa hammasi bir joyda, izlash oson.
 */
export async function writeReference(ctx: Ctx): Promise<void> {
  const [regions, entities, categories, routes, programs, settings] = await Promise.all([
    ctx.prisma.region.findMany({ orderBy: { name: 'asc' } }),
    ctx.prisma.legalEntity.findMany({ orderBy: { name: 'asc' } }),
    ctx.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }),
    ctx.prisma.logisticsRoute.findMany({
      orderBy: { effectiveFrom: 'desc' },
      include: { factory: { select: { name: true } }, region: { select: { name: true } } },
    }),
    ctx.prisma.bonusProgram.findMany({
      orderBy: [{ factory: { name: 'asc' } }, { effectiveFrom: 'desc' }],
      include: { factory: { select: { name: true } } },
    }),
    ctx.settings.all(),
  ]);

  const ws = ctx.book.sheet('ref', {
    tab: "Maʼlumotnoma",
    title: "Maʼlumotnomalar — hudud, firma, tarif, dastur, sozlama",
    desc: 'Kichik yordamchi jadvallar: hududlar, yuridik shaxslar, xarajat turkumlari, logistika tariflari, bonus dasturlari va tizim sozlamalari.',
  });

  titleBand(ws, {
    title: "Maʼlumotnomalar",
    subtitle: 'Yordamchi jadvallar. Boʼsh blok — shu boʼlimda hali yozuv yoʼq degani.',
    colCount: 5,
  });
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 40;

  let r = 5;
  let total = 0;

  r = block(ws, r, 'Tizim sozlamalari', ['Sozlama', 'Qiymat', '', '', 'Izoh'], [
    [L('Agent qarz limiti (umumiy)'), settingText(settings.agentDebtLimitDefault), '', '', L('Boʼsh — cheklanmagan. Agentning shaxsiy limiti bundan ustun turadi.')],
    [L('Moshina sigʼimi (paddon)'), settingText(settings.truckCapacityPallets), '', '', L('Moshinaning oʼz sigʼimi koʼrsatilmagan boʼlsa shu ishlatiladi.')],
    [L('Eng kam ustama (%)'), settingText(settings.saleMarginMinPct), '', '', L('Sotuv narxi zavod narxidan shuncha foizdan kam ustama bilan qoʼyilmaydi.')],
    [L("Yoʼqolgan paddon narxi"), settingText(settings.palletPriceDefault), '', '', L('Mijoz yoʼqotgan paddon uchun undiriladigan summa. Boʼsh boʼlsa 130 000 soʼm qoʼllanadi.')],
  ]);
  total += 4;

  r += 1;
  const regionRows = regions.map((x) => [x.name, txt(x.note), '', '', '']);
  r = block(ws, r, 'Hududlar', ['Nomi', 'Izoh', '', '', ''], regionRows);
  total += regionRows.length;

  r += 1;
  const entityRows = entities.map((x) => [x.name, label(LEGAL_ENTITY_KIND, x.kind), txt(x.inn), ACTIVE(x.active), txt(x.note)]);
  r = block(ws, r, 'Yuridik shaxslar', ['Nomi', 'Turi', 'STIR', 'Holati', 'Izoh'], entityRows);
  total += entityRows.length;

  r += 1;
  const catRows = categories.map((x) => [x.name, '', '', '', '']);
  r = block(ws, r, 'Xarajat turkumlari', ['Nomi', '', '', '', ''], catRows);
  total += catRows.length;

  r += 1;
  const routeRows = routes.map((x) => [
    x.factory.name,
    x.region.name,
    num0(x.costPerTruck),
    x.capacityPallets,
    x.effectiveFrom,
  ]);
  r = block(ws, r, 'Logistika tariflari', ['Zavod', 'Hudud', 'Moshina narxi', 'Sigʼimi', 'Kuchga kirgan'], routeRows, {
    2: NUMFMT.money,
    3: NUMFMT.int,
    4: NUMFMT.date,
  });
  total += routeRows.length;

  r += 1;
  const progRows = programs.map((x) => [x.factory.name, programText(x), '', '', x.effectiveFrom]);
  r = block(ws, r, 'Bonus dasturlari (butun tarix)', ['Zavod', 'Dastur', '', '', 'Kuchga kirgan'], progRows, {
    4: NUMFMT.date,
  });
  total += progRows.length;

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: false }];
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ctx.book.count(ws, total);
}

/** Bitta kichik blok: sarlavha + ustun nomlari + qatorlar. Keyingi bo'sh qatorni qaytaradi. */
function block(
  ws: Worksheet,
  start: number,
  heading: string,
  headers: string[],
  rows: (string | number | Date | null)[][],
  fmts: Record<number, string> = {},
): number {
  let r = start;
  sectionHeading(ws, r, heading, 5);
  r += 1;

  const head = ws.getRow(r);
  headers.forEach((h, i) => {
    const cell = head.getCell(i + 1);
    cell.value = h ? cyr(h) : null;
    cell.font = { ...FONT.header };
    cell.fill = fill(COLOR.ink);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });
  head.height = 22;
  r += 1;

  if (rows.length === 0) {
    ws.mergeCells(`A${r}:${colLetter(5)}${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = cyr("Ma'lumot yo'q");
    cell.font = { ...FONT.bodyMuted, italic: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    return r + 1;
  }

  rows.forEach((row, idx) => {
    const line = ws.getRow(r);
    row.forEach((v, i) => {
      const cell = line.getCell(i + 1);
      cell.value = v === '' ? null : v;
      if (fmts[i]) cell.numFmt = fmts[i];
      cell.font = { ...FONT.body };
      cell.alignment = {
        vertical: 'middle',
        horizontal: typeof v === 'number' ? 'right' : v instanceof Date ? 'center' : 'left',
        indent: 1,
        wrapText: i === 4,
      };
      cell.border = THIN_BORDER;
      if (idx % 2 === 1) cell.fill = fill(COLOR.band);
    });
    r += 1;
  });
  return r;
}

/** Sozlama qiymati: null «belgilanmagan» degani va uni 0 deb yozish ma'noni teskari qiladi. */
const settingText = (v: unknown): string =>
  v === null || v === undefined ? L('Belgilanmagan') : typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v);

void YES_NO;
