import { PaymentKind, Prisma } from '@prisma/client';
import { D, isSettled, round2, ZERO } from '../../common/money';
import { EMPTY_PALLET_STATS, type PalletPartyStats } from '../../pallets/pallet-stats';
import { BONUS_PROGRAM, ACTIVE, YES_NO, L } from '../xlsx/labels';
import { NUMFMT } from '../xlsx/theme';
import { debtTone, num, num0, txt, writeTable, type Col } from '../xlsx/sheet-builder';
import { NOT_CANCELLED } from '../../common/order-scope';
import type { Ctx } from './ctx';

/** «Qarz» / «Avans» / «Yopiq» — ishorani so'z bilan ham yozadi (faylni o'qigan odam uchun). */
const balanceWord = (v: Prisma.Decimal): string =>
  L(isSettled(v) ? 'Yopiq' : v.greaterThan(0) ? 'Qarz' : 'Avans');

/** Limit ustuni ATAYLAB matn: null «cheklanmagan», 0 esa «faqat oldindan» degani —
 *  ikkalasini ham raqam qilib yozsak, ma'nosi teskarisiga aylanadi. Va limitlar
 *  hech qachon qo'shilmaydi. */
const limitText = (v: Prisma.Decimal | null): string =>
  v === null ? L('Cheklanmagan') : v.isZero() ? L("Faqat oldindan to'lov") : v.toFixed(2);

/** Zavodning kuchdagi bonus dasturini bir qatorlik matnga aylantiradi. */
export const programText = (
  p: { kind: string; ratePerM3: Prisma.Decimal | null; percent: Prisma.Decimal | null } | null | undefined,
): string | null => {
  if (!p) return null;
  if (p.kind === 'PER_M3') return `${L(BONUS_PROGRAM.PER_M3)}: ${p.ratePerM3?.toFixed(2) ?? '0'}`;
  if (p.kind === 'PERCENT') return `${L(BONUS_PROGRAM.PERCENT)}: ${p.percent?.toFixed(2) ?? '0'}%`;
  return L(BONUS_PROGRAM.NONE);
};

// ══════════════════════════════ MIJOZLAR ══════════════════════════════

interface ClientRow {
  name: string;
  agent: string | null;
  phone: string | null;
  legalEntity: string | null;
  region: string | null;
  balance: Prisma.Decimal;
  creditLimit: Prisma.Decimal | null;
  paymentTermDays: number | null;
  pal: PalletPartyStats;
  orders: number;
  sales: Prisma.Decimal;
  lastOrderAt: Date | null;
  lastPaymentAt: Date | null;
  active: boolean;
  createdAt: Date;
}

export async function writeClients(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const [clients, balances, palStats, orderAgg, payAgg] = await Promise.all([
    prisma.client.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { agent: { select: { name: true } }, region: { select: { name: true } } },
    }),
    // includeOffBook sukut bo'yicha TRUE — mijoz sahifasidagi qoldiq bilan bir xil bo'lsin.
    ctx.ledger.clientBalances(),
    ctx.pallets.clientPalletStats(),
    prisma.order.groupBy({
      by: ['clientId'],
      where: NOT_CANCELLED,
      _count: true,
      _sum: { saleTotal: true },
      _max: { date: true },
    }),
    prisma.payment.groupBy({
      by: ['clientId'],
      where: { kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND] }, voidedAt: null },
      _max: { date: true },
    }),
  ]);

  const orderMap = new Map(orderAgg.map((g) => [g.clientId, g]));
  const payMap = new Map(payAgg.map((g) => [g.clientId as string, g._max.date]));

  const rows: ClientRow[] = clients.map((c) => {
    const o = orderMap.get(c.id);
    return {
      name: c.name,
      agent: c.agent?.name ?? null,
      phone: c.phone,
      legalEntity: c.legalEntity,
      region: c.region?.name ?? null,
      balance: balances.get(c.id) ?? ZERO,
      creditLimit: c.creditLimit,
      paymentTermDays: c.paymentTermDays,
      pal: palStats.get(c.id) ?? { ...EMPTY_PALLET_STATS },
      orders: o?._count ?? 0,
      sales: D(o?._sum.saleTotal ?? 0),
      lastOrderAt: o?._max.date ?? null,
      lastPaymentAt: payMap.get(c.id) ?? null,
      active: c.active,
      createdAt: c.createdAt,
    };
  });

  const cols: Col<ClientRow>[] = [
    { header: 'Mijoz', value: (r) => r.name, width: 30, total: 'count' },
    { header: 'Agent', value: (r) => txt(r.agent) },
    { header: 'Telefon', value: (r) => txt(r.phone), fmt: NUMFMT.text },
    { header: 'Yuridik shaxs', value: (r) => txt(r.legalEntity) },
    { header: 'Hudud', value: (r) => txt(r.region) },
    { header: 'Balans', value: (r) => num0(r.balance), fmt: NUMFMT.money, total: 'sum', tone: debtTone },
    { header: 'Holati', value: (r) => balanceWord(r.balance), align: 'center' },
    { header: 'Kredit limiti', value: (r) => limitText(r.creditLimit), align: 'right' },
    { header: "To'lov muddati (kun)", value: (r) => r.paymentTermDays, fmt: NUMFMT.int },
    { header: 'Buyurtmalar', value: (r) => r.orders, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Savdo summasi', value: (r) => num0(r.sales), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Paddon — jami olgan', value: (r) => r.pal.received, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Paddon — jami qaytargan', value: (r) => r.pal.returned, fmt: NUMFMT.int, total: 'sum' },
    { header: "Paddon — yo'qotgan", value: (r) => r.pal.chargedLost, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Paddon — tuzatish', value: (r) => r.pal.adjustment, fmt: NUMFMT.int, total: 'sum' },
    {
      header: 'Hozir mijozda (paddon)',
      value: (r) => r.pal.balance,
      fmt: NUMFMT.int,
      total: 'sum',
      tone: (_r, v) => (typeof v === 'number' && v > 0 ? 'violet' : undefined),
    },
    { header: 'Oxirgi buyurtma', value: (r) => r.lastOrderAt, fmt: NUMFMT.date },
    { header: "Oxirgi to'lov", value: (r) => r.lastPaymentAt, fmt: NUMFMT.date },
    { header: 'Holati', value: (r) => ACTIVE(r.active), align: 'center' },
    { header: 'Qo‘shilgan', value: (r) => r.createdAt, fmt: NUMFMT.date },
  ];

  const ws = ctx.book.sheet('debt', {
    tab: 'Mijozlar',
    title: 'Mijozlar — qoldiq, paddon va savdo tarixi',
    desc: "Har bir mijoz: puldagi balansi, paddon tarixi, jami savdosi va rekvizitlari.",
  });
  writeTable(ws, {
    title: 'Mijozlar — qoldiq, paddon va savdo tarixi',
    subtitle: 'Qoldiq va paddon — bugungi holat (butun tarix). Savdo — bekor qilinmagan buyurtmalar.',
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "«Balans» musbat boʼlsa mijoz bizga qarz, manfiy boʼlsa uning avansi. Bu ustunga «balansni nazorat qilish» qoʼlbola tuzatishlari ham kiradi (mijoz sahifasidagi son bilan bir xil), lekin «Umumiy koʼrsatkichlar» varagʼidagi kompaniya jamlanmasiga ular kirmaydi — shuning uchun ikki son farq qilishi mumkin. Nofaol mijozlar ham roʼyxatda: ularda hamon paddon boʼlishi mumkin. «Kredit limiti» hech qachon qoʼshilmaydi.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════════════ AGENTLAR ══════════════════════════════

interface AgentRow {
  name: string;
  phone: string | null;
  sortNo: number | null;
  clients: number;
  net: Prisma.Decimal;
  owed: Prisma.Decimal;
  orders: number;
  sales: Prisma.Decimal;
  cost: Prisma.Decimal;
  collected: Prisma.Decimal;
  ownLimit: Prisma.Decimal | null;
  active: boolean;
  synthetic?: boolean;
}

export async function writeAgents(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const [agents, clients, balances, orderAgg, payAgg] = await Promise.all([
    prisma.agent.findMany({ orderBy: [{ active: 'desc' }, { sortNo: 'asc' }, { name: 'asc' }] }),
    prisma.client.findMany({ select: { id: true, agentId: true } }),
    ctx.ledger.clientBalances(),
    prisma.order.groupBy({
      by: ['agentId'],
      where: NOT_CANCELLED,
      _count: true,
      _sum: { saleTotal: true, costTotal: true },
    }),
    prisma.payment.groupBy({
      by: ['agentId', 'kind'],
      where: { kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND] }, voidedAt: null },
      _sum: { amount: true },
    }),
  ]);

  const orderMap = new Map(orderAgg.map((g) => [g.agentId ?? '', g]));
  const collected = new Map<string, Prisma.Decimal>();
  for (const g of payAgg) {
    const key = g.agentId ?? '';
    const amount = D(g._sum.amount ?? 0);
    const prev = collected.get(key) ?? ZERO;
    collected.set(key, g.kind === PaymentKind.CLIENT_REFUND ? prev.minus(amount) : prev.plus(amount));
  }

  // agentId → uning mijozlarining balanslari
  const byAgent = new Map<string, { count: number; net: Prisma.Decimal; owed: Prisma.Decimal }>();
  for (const c of clients) {
    const key = c.agentId ?? '';
    const acc = byAgent.get(key) ?? { count: 0, net: ZERO, owed: ZERO };
    const bal = balances.get(c.id) ?? ZERO;
    acc.count += 1;
    acc.net = acc.net.plus(bal);
    // «Qarzdorlar» — faqat musbat qoldiqlar; avans boshqa mijozning qarzini yopmaydi
    // (buyurtma yaratishdagi limit darvozasi aynan shu sonni qaraydi).
    if (bal.greaterThan(0)) acc.owed = acc.owed.plus(bal);
    byAgent.set(key, acc);
  }

  const mk = (id: string, name: string, phone: string | null, sortNo: number | null, limit: Prisma.Decimal | null, active: boolean, synthetic = false): AgentRow => {
    const b = byAgent.get(id) ?? { count: 0, net: ZERO, owed: ZERO };
    const o = orderMap.get(id);
    return {
      name,
      phone,
      sortNo,
      clients: b.count,
      net: b.net,
      owed: b.owed,
      orders: o?._count ?? 0,
      sales: D(o?._sum.saleTotal ?? 0),
      cost: D(o?._sum.costTotal ?? 0),
      collected: collected.get(id) ?? ZERO,
      ownLimit: limit,
      active,
      synthetic,
    };
  };

  const rows: AgentRow[] = agents.map((a) => mk(a.id, a.name, a.phone, a.sortNo, a.debtLimit, a.active));

  // Agentga biriktirilmagan mijozlar va buyurtmalar hech bir agent qatoriga tushmaydi —
  // ularsiz ustun jamlari kompaniya jamiga yetmaydi va «yoʼqolgan pul» taassuroti tugʼiladi.
  const orphan = mk('', L('Agentsiz'), null, null, null, true, true);
  if (orphan.clients > 0 || orphan.orders > 0 || !orphan.net.isZero()) rows.push(orphan);

  const cols: Col<AgentRow>[] = [
    { header: 'Agent', value: (r) => r.name, width: 26, total: 'count' },
    { header: 'Telefon', value: (r) => txt(r.phone), fmt: NUMFMT.text },
    { header: 'Tartib №', value: (r) => r.sortNo, fmt: NUMFMT.int },
    { header: 'Mijozlar soni', value: (r) => r.clients, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Mijozlar balansi (sof)', value: (r) => num0(r.net), fmt: NUMFMT.money, total: 'sum', tone: debtTone },
    { header: 'Qarzdorlar (faqat musbat)', value: (r) => num0(r.owed), fmt: NUMFMT.money, total: 'sum', tone: (_r, v) => (typeof v === 'number' && v > 0 ? 'danger' : undefined) },
    { header: 'Buyurtmalar', value: (r) => r.orders, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Savdo summasi', value: (r) => num0(r.sales), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Mol foydasi', value: (r) => num0(r.sales.minus(r.cost)), fmt: NUMFMT.money, total: 'sum' },
    { header: "Yigʼilgan toʼlov (sof)", value: (r) => num0(r.collected), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Shaxsiy qarz limiti', value: (r) => (r.synthetic ? null : limitText(r.ownLimit)), align: 'right' },
    { header: 'Holati', value: (r) => (r.synthetic ? '—' : ACTIVE(r.active)), align: 'center' },
  ];

  const ws = ctx.book.sheet('debt', {
    tab: 'Agentlar',
    title: 'Agentlar — mijozlari, savdosi va yigʼgan puli',
    desc: 'Har bir agent kesimida: mijozlar soni, ularning qarzi, savdo, foyda va yigʼilgan toʼlov.',
  });
  writeTable(ws, {
    title: 'Agentlar — mijozlari, savdosi va yigʼgan puli',
    subtitle: 'Butun davr boʼyicha. Bekor qilingan buyurtmalar hisobga olinmagan.',
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "«Mijozlar soni» va «Mijozlar balansi» — mijozning HOZIRGI agenti boʼyicha; «Buyurtmalar», «Savdo» va «Yigʼilgan toʼlov» esa hujjat yaratilgan paytdagi agent boʼyicha muzlatilgan. Mijoz boshqa agentga oʼtkazilsa, bu ikki guruh raqam bir-biriga toʼliq mos kelmaydi — bu xato emas, tarix shunday saqlanadi. «Shaxsiy qarz limiti» — agentning oʼz limiti; boʼsh boʼlsa umumiy sozlamadagi limit ishlaydi.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════════════ ZAVODLAR ══════════════════════════════

interface FactoryRow {
  name: string;
  note: string | null;
  payableOwed: Prisma.Decimal;
  payableOwedToUs: Prisma.Decimal;
  advCash: Prisma.Decimal;
  advBank: Prisma.Decimal;
  advTotal: Prisma.Decimal;
  net: Prisma.Decimal;
  bonus: Prisma.Decimal;
  program: string | null;
  pal: PalletPartyStats;
  products: number;
  orders: number;
  purchased: Prisma.Decimal;
  active: boolean;
}

export async function writeFactories(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const [factories, buckets, palStats, bonusAgg, orderAgg, productAgg, programs] = await Promise.all([
    prisma.factory.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    ctx.ledger.factoryBucketsMap(),
    ctx.pallets.factoryPalletStats(),
    prisma.bonusTransaction.groupBy({ by: ['factoryId'], _sum: { amount: true } }),
    prisma.order.groupBy({
      by: ['factoryId'],
      where: NOT_CANCELLED,
      _count: true,
      _sum: { costTotal: true },
    }),
    prisma.product.groupBy({ by: ['factoryId'], _count: true }),
    prisma.bonusProgram.findMany({ orderBy: { effectiveFrom: 'desc' } }),
  ]);

  const bonusMap = new Map(bonusAgg.map((g) => [g.factoryId, D(g._sum.amount ?? 0)]));
  const orderMap = new Map(orderAgg.map((g) => [g.factoryId, g]));
  const productMap = new Map(productAgg.map((g) => [g.factoryId, g._count]));
  // Joriy dastur = eng oxirgi kuchga kirgan (versiyalangan jadval, hech qachon UPDATE qilinmaydi).
  const programMap = new Map<string, (typeof programs)[number]>();
  for (const p of programs) if (!programMap.has(p.factoryId)) programMap.set(p.factoryId, p);

  const rows: FactoryRow[] = factories.map((f) => {
    const b = buckets.get(f.id);
    const payable = b?.payable ?? ZERO;
    const prog = programMap.get(f.id);
    const o = orderMap.get(f.id);
    return {
      name: f.name,
      note: f.note,
      payableOwed: payable.lessThan(0) ? payable.negated() : ZERO,
      payableOwedToUs: payable.greaterThan(0) ? payable : ZERO,
      advCash: b?.advanceCash ?? ZERO,
      advBank: b?.advanceBank ?? ZERO,
      advTotal: b?.advanceTotal ?? ZERO,
      net: b?.net ?? ZERO,
      bonus: bonusMap.get(f.id) ?? ZERO,
      program: programText(prog),
      pal: palStats.get(f.id) ?? { ...EMPTY_PALLET_STATS },
      products: productMap.get(f.id) ?? 0,
      orders: o?._count ?? 0,
      purchased: D(o?._sum.costTotal ?? 0),
      active: f.active,
    };
  });

  const cols: Col<FactoryRow>[] = [
    { header: 'Zavod', value: (r) => r.name, width: 28, total: 'count' },
    { header: 'Mol qarzimiz (ochiq)', value: (r) => num0(r.payableOwed), fmt: NUMFMT.money, total: 'sum', tone: (_r, v) => (typeof v === 'number' && v > 0 ? 'amber' : undefined) },
    { header: 'Zavod bizga qarz', value: (r) => num0(r.payableOwedToUs), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Naqd avans', value: (r) => num0(r.advCash), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Bank avansi', value: (r) => num0(r.advBank), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Avans — jami', value: (r) => num0(r.advTotal), fmt: NUMFMT.money, total: 'sum', tone: () => 'success' },
    { header: 'Netto (eski usul)', value: (r) => num0(r.net), fmt: NUMFMT.money, total: 'sum', tone: (_r, v) => (typeof v === 'number' && v < 0 ? 'amber' : undefined) },
    { header: 'Bonus hamyoni', value: (r) => num0(r.bonus), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Bonus dasturi (joriy)', value: (r) => txt(r.program), width: 22 },
    { header: 'Paddon — jami olingan', value: (r) => r.pal.received, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Paddon — zavodga qaytarilgan', value: (r) => r.pal.returned, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Paddon — tuzatish', value: (r) => r.pal.adjustment, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Hozir qarzmiz (paddon)', value: (r) => r.pal.balance, fmt: NUMFMT.int, total: 'sum', tone: (_r, v) => (typeof v === 'number' && v > 0 ? 'violet' : undefined) },
    { header: 'Mahsulotlar', value: (r) => r.products, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Buyurtmalar', value: (r) => r.orders, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Xarid summasi (tannarx)', value: (r) => num0(r.purchased), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Holati', value: (r) => ACTIVE(r.active), align: 'center' },
    { header: 'Izoh', value: (r) => txt(r.note), wrap: true, width: 30 },
  ];

  const ws = ctx.book.sheet('debt', {
    tab: 'Zavodlar',
    title: 'Zavodlar — uchta choʼntak, bonus va paddon',
    desc: 'Har bir zavod: ochiq mol qarzi, naqd va bank avansi, bonus hamyoni, paddon hisobi.',
  });
  writeTable(ws, {
    title: 'Zavodlar — uchta choʼntak, bonus va paddon',
    subtitle: 'Bugungi holat. Avans mol qarzini avtomatik yopmaydi — shuning uchun alohida ustunlarda.',
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "Zavod hisobi UCHGA boʼlingan: mol qarzi, naqd avans, bank avansi. Zavodda turgan pul buyurtma qarzini OʼZI yopmaydi — buning uchun «avansdan yechish» amali kerak. «Netto (eski usul)» — uchalasining yigʼindisi; u eski hisobotlar bilan solishtirish uchun qoldirilgan, kundalik ish uchun undan foydalanmang: 15 mln avans ortida turgan 5 mln qarzni 0 qilib koʼrsatadi. Zavodga paddon qaytarish butunlay pulsiz — bu ustunlar DONA.",
  });
  ctx.book.count(ws, rows.length);
}

// ══════════════════════════════ MOSHINALAR ══════════════════════════════

interface VehicleRow {
  name: string;
  plate: string | null;
  driver: string | null;
  phone: string | null;
  capacity: number;
  oneTime: boolean;
  balance: Prisma.Decimal;
  owed: Prisma.Decimal;
  trips: number;
  transportCost: Prisma.Decimal;
  paid: Prisma.Decimal;
  active: boolean;
}

export async function writeVehicles(ctx: Ctx): Promise<void> {
  const { prisma } = ctx;
  const [vehicles, balances, orderAgg, payAgg] = await Promise.all([
    // ATAYLAB toʼgʼridan-toʼgʼri Prisma: /vehicles ikkala shoxida ham `oneTime:false`
    // filtrini qoʼllaydi, holbuki bir martalik moshinalar real transport puli va real
    // qarz olib yuradi — ular tushib qolsa, shofyorlar boʼyicha jami tugamaydi.
    prisma.vehicle.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    ctx.ledger.vehicleBalances(),
    prisma.order.groupBy({
      by: ['vehicleId'],
      where: { ...NOT_CANCELLED, vehicleId: { not: null } },
      _count: true,
      _sum: { transportCost: true },
    }),
    prisma.payment.groupBy({
      by: ['vehicleId'],
      where: { kind: PaymentKind.VEHICLE_OUT, voidedAt: null, vehicleId: { not: null } },
      _sum: { amount: true },
    }),
  ]);

  const orderMap = new Map(orderAgg.map((g) => [g.vehicleId as string, g]));
  const payMap = new Map(payAgg.map((g) => [g.vehicleId as string, D(g._sum.amount ?? 0)]));

  const rows: VehicleRow[] = vehicles.map((v) => {
    const bal = balances.get(v.id) ?? ZERO;
    const o = orderMap.get(v.id);
    return {
      name: v.name,
      plate: v.plate,
      driver: v.driver,
      phone: v.phone,
      capacity: v.capacityPallets,
      oneTime: v.oneTime,
      balance: bal,
      owed: bal.lessThan(0) ? bal.negated() : ZERO,
      trips: o?._count ?? 0,
      transportCost: D(o?._sum.transportCost ?? 0),
      paid: payMap.get(v.id) ?? ZERO,
      active: v.active,
    };
  });

  const cols: Col<VehicleRow>[] = [
    { header: 'Moshina', value: (r) => r.name, width: 22, total: 'count' },
    { header: 'Davlat raqami', value: (r) => txt(r.plate), fmt: NUMFMT.text, align: 'center' },
    { header: 'Shofyor', value: (r) => txt(r.driver) },
    { header: 'Telefon', value: (r) => txt(r.phone), fmt: NUMFMT.text },
    { header: 'Sigʼimi (paddon)', value: (r) => r.capacity, fmt: NUMFMT.int },
    { header: 'Bir martalik', value: (r) => YES_NO(r.oneTime), align: 'center' },
    { header: 'Reyslar', value: (r) => r.trips, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Transport xarajati (jami)', value: (r) => num0(r.transportCost), fmt: NUMFMT.money, total: 'sum' },
    { header: "Toʼlangan", value: (r) => num0(r.paid), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Shofyorga qarzimiz', value: (r) => num0(r.owed), fmt: NUMFMT.money, total: 'sum', tone: (_r, v) => (typeof v === 'number' && v > 0 ? 'amber' : undefined) },
    { header: 'Balans (belgili)', value: (r) => num0(r.balance), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Holati', value: (r) => ACTIVE(r.active), align: 'center' },
  ];

  const ws = ctx.book.sheet('debt', {
    tab: 'Moshinalar',
    title: 'Moshinalar va shofyorlar hisobi',
    desc: 'Butun avtopark, jumladan bir martalik moshinalar: reyslar, transport haqi va qarzimiz.',
  });
  writeTable(ws, {
    title: 'Moshinalar va shofyorlar hisobi',
    subtitle: 'Bir martalik (vaqtinchalik) moshinalar ham roʼyxatda — ularda ham haqiqiy qarz boʼlishi mumkin.',
    columns: cols,
    rows,
    freezeCols: 1,
    footnote:
      "«Balans (belgili)» manfiy boʼlsa biz shofyorga qarzdormiz; «Shofyorga qarzimiz» ustuni oʼsha sonni musbat koʼrinishda takrorlaydi. Davlat raqami takrorlanganday koʼrinishi mumkin — bazada u katta-kichik harf, boʼshliq va kirill/lotin farqi olib tashlangan holda solishtiriladi.",
  });
  ctx.book.count(ws, rows.length);
}

void round2;
void num;
