/**
 * ZANJIR-REPLAY: the real market week from «Smart blok.xlsx», replayed through the
 * app's NORMAL flows (no import!) — agents/clients created WITHOUT limits, orders via
 * POST /orders with status walk, payments via POST /payments, transport settled via
 * VEHICLE_OUT. Proves the app natively produces the same books as the owner's Excel:
 *   sotuv 501 414 039.36 · tannarx 340 416 000 · yalpi 160 998 039.36 (T25)
 *   sof foyda 117 498 039.36 (V25) · mijozlar qarzi 239 399 139.36 («Ост»)
 *   zavod −78 401 100 («Завод») · poddon 394 · shofyor 0
 *
 *   DATABASE_URL=…smartblok_test API on :4100 →
 *   API_URL=http://localhost:4100/api node test/chain-replay.e2e.mjs
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.API_URL || 'http://localhost:4100/api';
if (!/4100|smartblok_test/.test(BASE) && !process.env.ALLOW_ANY_DB) {
  throw new Error('chain-replay faqat test API (:4100) da yuriladi');
}

// ── the real week, transcribed from the workbook (see docs/audit/excel-spec-v2.md) ──
const ORDERS = [
  { no: 1, agent: 'Жамол 22-22', client: 'Урганч Тамирлаш', date: '2026-06-24', plate: '95 G 851 NA', size: '600x300x200', m3: 31.104, price: 732542.438, pallets: 18, transport: 2000000 },
  { no: 2, agent: 'Жамол 22-22', client: 'Урганч Тамирлаш', date: '2026-06-24', plate: '40 Y 173 KB', size: '600x300x200', m3: 31.104, price: 732542.438, pallets: 18, transport: 2000000 },
  { no: 3, agent: 'Жамол 22-22', client: 'Инвест Холдинг', date: '2026-06-24', plate: '90 X 700 CA', size: '600x300x200', m3: 31.104, price: 700000, pallets: 18, transport: 2000000 },
  { no: 4, agent: 'Зафар ога', client: 'Сулаймон Ога Хазарасп', date: '2026-06-24', plate: '90 G 991 FA', size: '600x300x200', m3: 31.104, price: 750000, pallets: 18, transport: 2000000 },
  { no: 5, agent: 'Жамол 22-22', client: 'Инвест Холдинг', date: '2026-06-24', plate: '90 G 429 CA', size: '600x300x200', m3: 32.832, price: 700000, pallets: 19, transport: 2000000 },
  { no: 6, agent: 'Жамол 22-22', client: 'Инвест Холдинг', date: '2026-06-25', plate: '30 N 113 MB', size: '600x300x200', m3: 32.832, price: 700000, pallets: 19, transport: 2000000 },
  { no: 7, agent: 'Жамол 22-22', client: 'Нормат Умидбек', date: '2026-06-25', plate: '50 R 575 CB', size: '600x300x200', m3: 32.832, price: 735000, pallets: 19, transport: 2000000 },
  { no: 8, agent: 'Жамол 22-22', client: 'Нормат Умидбек', date: '2026-06-25', plate: '30 784 WBA', size: '600x300x200', m3: 32.832, price: 735000, pallets: 19, transport: 2000000 },
  { no: 9, agent: 'Жамол 22-22', client: 'Нормат Умидбек', date: '2026-06-25', plate: 'VI-004-KT', size: '600x300x200', m3: 32.832, price: 735000, pallets: 19, transport: 2000000 },
  { no: 10, agent: 'Арслон ога', client: 'Гофур Хазорасп', date: '2026-06-25', plate: '01 U 917 XC', size: '600x300x200', m3: 32.832, price: 750000, pallets: 19, transport: 2500000 },
  { no: 11, agent: 'Арслон ога', client: 'Гофур Хазорасп', date: '2026-06-25', plate: '95 194 LBA', size: '600x300x200', m3: 31.104, price: 750000, pallets: 18, transport: 2500000 },
  { no: 12, agent: 'Зафар ога', client: 'Сулаймон Ога Хазарасп', date: '2026-06-27', plate: '40 W 910 SB', size: '600x300x100', m3: 32.832, price: 750000, pallets: 19, transport: 2500000 },
  { no: 13, agent: 'Зафар ога', client: 'Сулаймон Ога Хазарасп', date: '2026-06-27', plate: '90 Z 688 AB', size: '600x300x100', m3: 32.832, price: 750000, pallets: 19, transport: 2000000 },
  { no: 14, agent: 'Зафар ога', client: 'Сулаймон Ога Хазарасп', date: '2026-06-27', plate: '95 617 MBA', size: '600x300x200', m3: 32.832, price: 750000, pallets: 19, transport: 2000000 },
  { no: 15, agent: 'Зафар ога', client: 'Сулаймон Ога Хазарасп', date: '2026-06-27', plate: '40 148 ECA', size: '600x300x200', m3: 32.832, price: 750000, pallets: 19, transport: 2000000 },
  { no: 16, agent: 'Шохрух ога', client: 'Гайрат Штб', date: '2026-06-27', plate: '90 919 LBA', size: '600x300x200', m3: 32.832, price: 760000, pallets: 19, transport: 2000000 },
  { no: 17, agent: 'Шохрух ога', client: 'Рустам Шпик', date: '2026-06-27', plate: '90 X 700 CA', size: '600x300x200', m3: 32.832, price: 729928.1, pallets: 19, transport: 2000000 },
  { no: 18, agent: 'Шохрух ога', client: 'Гайрат Штб', date: '2026-06-28', plate: '90 273 QBA', size: '600x300x200', m3: 32.832, price: 760000, pallets: 19, transport: 2000000 },
  { no: 19, agent: 'Зафар ога', client: 'Мурод ога Урганч', date: '2026-06-30', plate: '40 148 ECA', size: '600x300x200', m3: 32.832, price: 730000, pallets: 19, transport: 2000000 },
  { no: 20, agent: 'Зафар ога', client: 'Мурод ога Урганч', date: '2026-06-30', plate: '85 L 868 PA', size: '600x300x200', m3: 32.832, price: 730000, pallets: 19, transport: 2000000 },
  { no: 21, agent: 'Жамол 22-22', client: 'Ирригатсия темир бетон', date: '2026-06-30', plate: '25 Q 068 OA', size: '600x300x200', m3: 32.832, price: 735000, pallets: 19, transport: 2000000 },
];
const CLIENT_PAYMENTS = [
  { client: 'Рустам Шпик', date: '2026-06-29', amount: 23965900, payer: '"Ифтихор" хусусий корхонаси' },
  { client: 'Сулаймон Ога Хазарасп', date: '2026-06-25', amount: 23328000, payer: 'HAZORASP MUHAMMAD' },
  { client: 'Сулаймон Ога Хазарасп', date: '2026-06-29', amount: 24624000, payer: '"A-SIA HOUSE" MCHJ' },
  { client: 'Сулаймон Ога Хазарасп', date: '2026-06-30', amount: 73872000, payer: 'Xazorasp Ipoteka Qurilish мчж' },
  { client: 'Гофур Хазорасп', date: '2026-06-29', amount: 47952000, payer: '"EZVIZ CITY"Mchj' },
  { client: 'Урганч Тамирлаш', date: '2026-06-25', amount: 45570000, payer: 'URGANCH TAMIRLASH' },
  { client: 'Фидато Гроуп', date: '2026-06-30', amount: 22703000, payer: 'OOO "FIDATO GROUP"' },
];
const FACTORY_PAYMENTS = [
  { date: '2026-06-25', amount: 23328000 }, { date: '2026-06-25', amount: 45570000 },
  { date: '2026-06-29', amount: 23965900 }, { date: '2026-06-29', amount: 24624000 },
  { date: '2026-06-29', amount: 47952000 }, { date: '2026-06-30', amount: 22703000 },
  { date: '2026-06-30', amount: 23872000 }, { date: '2026-06-30', amount: 50000000 },
];
const AGENTS = ['Жамол 22-22', 'Арслон ога', 'Зафар ога', 'Шохрух ога'];
const CLIENT_AGENT = new Map(ORDERS.map((o) => [o.client, o.agent]));
CLIENT_AGENT.set('Фидато Гроуп', 'Жамол 22-22'); // faqat avans bergan mijoz

let fails = 0;
const eq = (label, got, want) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

let token = '';
async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.accessToken;

  console.log('0) Sozlama: poddon puli 0 (boss modeli) + kassa ochilish qoldigʼi');
  await api('PUT', '/settings/palletPriceDefault', { value: 0 });
  const boxes = await api('GET', '/kassa/cashboxes');
  const boxList = Array.isArray(boxes) ? boxes : boxes.items ?? boxes.data;
  const naqd = boxList.find((b) => b.type === 'CASH' && b.currency === 'UZS');
  const bank = boxList.find((b) => b.type === 'BANK');
  await api('POST', '/kassa/manual', { cashboxId: naqd.id, direction: 'IN', amount: 50_000_000, note: 'ochilish (replay)' });

  console.log('1) Zavod + mahsulotlar + narxnoma (500 000 / 750 000)');
  const factory = await api('POST', '/factories', { name: 'Газоблок (replay)' });
  const productBySize = new Map();
  for (const size of ['600x300x200', '600x300x100']) {
    const p = await api('POST', '/products', { factoryId: factory.id, name: `Газоблок ${size} (replay)`, size, m3PerPallet: 1.728 });
    for (const [kind, price] of [['FACTORY_CASH', 500000], ['FACTORY_BANK', 500000], ['DEALER_SALE', 750000]]) {
      await api('POST', `/products/${p.id}/prices`, { kind, pricePerM3: price, effectiveFrom: '2026-06-01' });
    }
    productBySize.set(size, p.id);
  }

  console.log('2) Agentlar (LIMITSIZ) va mijozlar (LIMITSIZ)');
  const agentIdByName = new Map();
  for (const name of AGENTS) {
    const a = await api('POST', '/agents', { name: `${name} (replay)` }); // hech qanday debtLimit yoʼq
    agentIdByName.set(name, a.id);
  }
  const clientIdByName = new Map();
  for (const [client, agent] of CLIENT_AGENT) {
    const c = await api('POST', '/clients', { name: `${client} (replay)`, agentId: agentIdByName.get(agent) }); // creditLimit yoʼq
    clientIdByName.set(client, c.id);
  }

  console.log('3) 21 buyurtma (jurnal qatorlari) — status zanjiri bilan');
  const STATUSES = ['CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED'];
  for (const o of ORDERS) {
    const order = await api('POST', '/orders', {
      clientId: clientIdByName.get(o.client),
      date: o.date,
      oneTimeVehicle: { name: o.plate, plate: o.plate },
      transportMode: 'DEALER_ABSORBED',
      transportCost: o.transport,
      items: [{ productId: productBySize.get(o.size), quantityM3: o.m3, palletCount: o.pallets, salePricePerM3: o.price }],
    });
    for (const st of STATUSES) await api('PATCH', `/orders/${order.id}/status`, { to: st });
    // «Туланди» — shofyorga toʼlangan (naqd)
    await api('POST', '/payments', {
      kind: 'VEHICLE_OUT', vehicleId: order.vehicleId, method: 'CASH', cashboxId: naqd.id,
      amount: o.transport, date: o.date, allocations: [{ orderId: order.id, amount: o.transport }],
    });
  }

  console.log('4) 7 mijoz toʼlovi (bank) + 8 zavod oʼtkazmasi');
  for (const p of CLIENT_PAYMENTS) {
    await api('POST', '/payments', {
      kind: 'CLIENT_IN', clientId: clientIdByName.get(p.client), method: 'BANK', cashboxId: bank.id,
      amount: p.amount, date: p.date, payerName: p.payer,
    });
  }
  for (const f of FACTORY_PAYMENTS) {
    await api('POST', '/payments', {
      kind: 'FACTORY_OUT', factoryId: factory.id, method: 'BANK', cashboxId: bank.id,
      amount: f.amount, date: f.date,
    });
  }

  console.log('\n5) TEKSHIRUV — Excel bilan qatorma-qator');
  const s = await api('GET', '/dashboard/summary?from=2026-06-24&to=2026-06-30');
  eq('Sotuv (R25)', s.period.sales, '501414039.36');
  eq('Tannarx — faqat blok (J25)', s.period.cost, '340416000');
  eq('Yalpi foyda (T25 «Общая прибль»)', s.period.goodsProfit, '160998039.36');
  eq('Transport xarajati', s.period.transportProfit, '-43500000');
  eq('SOF FOYDA (V25 «Соф фойда»)', s.period.netProfit, '117498039.36');
  eq('Yigʻilgan toʼlovlar', s.period.collected, '262014900');
  eq('Buyurtmalar', s.period.orders, 21);
  eq('Kub sotildi', s.period.cubeSold, '680.832');

  console.log('   — balanslar —');
  eq('Mijozlar qarzi SOF («Ост» jami)', s.clientsOweUs, '239399139.36');
  eq('Zavodga qarzimiz («Завод» bloki)', s.weOweFactories, '78401100');
  eq('Shofyor qoldigʼi («Туланди»)', s.weOweVehicles, '0');
  eq('Mijozlardagi poddonlar', s.palletsAtClients, 394);

  console.log('   — agent daftarlari («Ост») —');
  const agents = await api('GET', '/agents');
  const aList = (Array.isArray(agents) ? agents : agents.items ?? agents.data).filter((a) => a.name.endsWith('(replay)'));
  const ost = new Map(aList.map((a) => [a.name.replace(' (replay)', ''), (+a.outstandingDebt).toFixed(2)]));
  eq('Жамол 22-22 Ост', ost.get('Жамол 22-22'), '141560679.98');
  eq('Зафар ога Ост', ost.get('Зафар ога'), '47934720.00');
  eq('Шохрух ога Ост', ost.get('Шохрух ога'), '49903739.38');
  eq('Арслон ога Ост (yopiq)', ost.get('Арслон ога'), '0.00');

  console.log('   — Гофур Хазорасп (daftar misoli) —');
  const arslon = aList.find((a) => a.name.startsWith('Арслон'));
  const det = await api('GET', `/agents/${arslon.id}`);
  const gofur = det.clients.find((c) => c.name.startsWith('Гофур'));
  eq('Гофур balans (47 952 000 − 47 952 000)', (+gofur.balance).toFixed(0), '0');
  eq('Гофур poddon (19+18)', gofur.palletBalance, 37);
  const gOrders = await api('GET', `/orders?clientId=${gofur.id}&pageSize=10`);
  eq('Гофур buyurtmalari', (gOrders.items ?? gOrders).filter((o) => o.status !== 'CANCELLED').length, 2);

  console.log('   — poddon naturada qaytarish (pul yozilmasligi kerak) —');
  await api('POST', '/pallets/client-return', { clientId: gofur.id, qty: 5, date: '2026-07-01' });
  await api('POST', '/pallets/factory-return', { factoryId: factory.id, qty: 5, date: '2026-07-01' });
  const s2 = await api('GET', '/dashboard/summary?from=2026-06-24&to=2026-06-30');
  eq('zavod qarzi OʼZGARMADI (poddon puli yoʼq)', s2.weOweFactories, '78401100');
  eq('poddonlar 394−5', s2.palletsAtClients, 389);

  console.log(`\n${fails === 0 ? 'ZANJIR-REPLAY OʼTDI ✓ — ilova real bozor hisobini importsiz ham aynan yuritadi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
