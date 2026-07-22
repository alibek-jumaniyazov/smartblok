// Bekor qilishning IKKI REJIMI (egasi qoidasi, 2026-07-22 kechqurun — shu kungi ikkala
// oldingi qoidani ham almashtiradi). IKKALASIDA HAM kassa buyurtmadan OLDINGI holatiga
// qaytadi: mijozning to'lagani kassadan chiqadi, zavodga to'langani kassaga qaytadi —
// bekor qilingan buyurtmaning puli kassada turib qolmaydi.
//
//   • REFUND   («Ha — mijozga qaytariladi», default) — mijoz BIZGA to'lagani unga NAQD
//     qaytariladi; SHOFYORGA o'z qo'li bilan bergani esa balansida KREDIT bo'lib qoladi
//     (transportni diller o'z zimmasiga oladi). Ya'ni to'lagan har bir so'm qaytadi:
//     bir qismi naqd, bir qismi kredit bo'lib.
//   • VOID_ALL («Yo'q — hamma o'tkazmalar yo'qolsin») — hech qanday iz qolmaydi: mijoz
//     balansi 0, shofyorga to'lov hujjati ham bekor, kassa va zavod oldingi holatda.
//     Buyurtma umuman berilmagandek, to'lov umuman qilinmagandek.
//
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (bir marta)
//   cd apps/api
//   DATABASE_URL=...smartblok_test npx prisma migrate deploy && npx tsx prisma/seed.ts
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/cancel-refund.e2e.mjs

const BASE = process.env.API_URL ?? 'http://localhost:4100/api';
const U = Date.now().toString(36).slice(-6);
let pass = 0;
const fails = [];
const num = (v) => Number(v ?? 0);
const near = (a, b, eps = 1) => Math.abs(num(a) - num(b)) <= eps;
const ok = (c, l) => { if (c) pass++; else fails.push(l); console.log(`${c ? '  ok  ' : ' FAIL '} ${l}`); };
const eq = (a, e, l) => ok(near(a, e), `${l} — kutilgan ${e}, keldi ${a}`);
let admin;

async function req(method, path, body, expect) {
  const res = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer ' + admin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let j; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (expect !== undefined && res.status !== expect) {
    fails.push(`${method} ${path} -> ${res.status} (kutilgan ${expect}): ${text.slice(0, 200)}`);
    console.log(` FAIL  ${method} ${path} -> ${res.status}: ${text.slice(0, 160)}`);
  }
  return { status: res.status, body: j };
}
const clientBal = async (id) => num((await req('GET', `/debts/statement?account=CLIENT&partyId=${id}`)).body?.closingBalance);
const factoryOf = async (id) => (await req('GET', `/factories/${id}`)).body;
const boxBal = async (id) => {
  const cbx = (await req('GET', '/kassa/cashboxes')).body;
  return num((cbx.items ?? cbx).find((b) => b.id === id)?.balance);
};

const setup = async (tag) => {
  const factory = (await req('POST', '/factories', { name: `Z ${U}-${tag}` }, 201)).body;
  const product = (await req('POST', '/products', { factoryId: factory.id, name: `B ${U}-${tag}`, m3PerPallet: 1.728 }, 201)).body;
  for (const [kind, price] of [['FACTORY_CASH', 600000], ['FACTORY_BANK', 625000], ['DEALER_SALE', 750000]])
    await req('POST', `/products/${product.id}/prices`, { kind, pricePerM3: price, effectiveFrom: '2026-07-01' }, 201);
  const boxes = (await req('GET', '/kassa/cashboxes')).body;
  const cash = (boxes.items ?? boxes).find((b) => b.type === 'CASH' && b.currency === 'UZS');
  const bank = (boxes.items ?? boxes).find((b) => b.type === 'BANK');
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'IN', amount: 500_000_000, date: '2026-07-22', note: 'kapital' }, 201);
  await req('POST', '/kassa/manual', { cashboxId: bank.id, direction: 'IN', amount: 500_000_000, date: '2026-07-22', note: 'kapital' }, 201);
  const client = (await req('POST', '/clients', { name: `M ${U}-${tag}` }, 201)).body;
  return { factory, product, cash, bank, client };
};

// final-at-create: order is COMPLETED at birth — cost is posted at create, no stepping.
const SALE = 24_000_000; // 32 m³ × 750 000
const COST_BANK = 20_000_000; // 32 m³ × 625 000 (blocks only)
const makeOrder = async (s, extra = {}) =>
  (await req('POST', '/orders', {
    clientId: s.client.id, date: '2026-07-22', factoryPayIntent: 'BANK',
    oneTimeVehicle: { name: `Mo ${U}`, plate: `RF${U}${Math.random().toString(36).slice(2, 5)}` },
    transportMode: 'CLIENT_OWN',
    items: [{ productId: s.product.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
    ...extra,
  }, 201)).body;

const main = async () => {
  admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 201)).body?.accessToken;
  ok(!!admin, 'admin login');

  // ══════════ A) REFUND: mijoz to'ladi + ZAVODGA TO'LADIK → bekor ══════════
  console.log("\n── A) REFUND: mijoz to'ladi + zavodga to'ladik → bekor ──");
  const a = await setup('A');
  const cash0 = await boxBal(a.cash.id), bank0 = await boxBal(a.bank.id);
  const order = await makeOrder(a);
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: a.client.id, method: 'CASH', cashboxId: a.cash.id, amount: SALE, date: '2026-07-22' }, 201);
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: a.factory.id, method: 'BANK', cashboxId: a.bank.id, amount: COST_BANK, date: '2026-07-22' }, 201);
  await req('POST', `/orders/${order.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  eq(await boxBal(a.cash.id), cash0 + SALE, 'A: bekordan oldin naqd kassa +24M');
  eq(await boxBal(a.bank.id), bank0 - COST_BANK, 'A: bekordan oldin bank kassa -20M');

  await req('DELETE', `/orders/${order.id}`, { reason: 'egasi testi', mode: 'REFUND' }, 200);

  // Transport yo'q (CLIENT_OWN) ⇒ mijozga hamma puli NAQD qaytdi, balansida hech narsa qolmaydi
  eq(await clientBal(a.client.id), 0, 'A: mijoz balansi 0 (24M naqd qaytarildi)');
  const fa = await factoryOf(a.factory.id);
  eq(fa.balance, 0, "A: zavod balansi 0 (to'lov qaytdi)");
  eq(fa.advanceBank, 0, 'A: zavod bank avansi 0');
  eq(await boxBal(a.cash.id), cash0, 'A: naqd kassa buyurtmadan OLDINGI holatga qaytdi (mijoz puli chiqdi)');
  eq(await boxBal(a.bank.id), bank0, "A: bank kassa OLDINGI holatga qaytdi (zavod to'lovi qaytdi)");

  // ══════════ B) REFUND: mijoz to'ladi, ZAVODGA TO'LAMADIK → bekor ══════════
  console.log("\n── B) REFUND: mijoz to'ladi, zavodga to'lamadik → bekor ──");
  const b = await setup('B');
  const bcash0 = await boxBal(b.cash.id);
  const order2 = await makeOrder(b);
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: b.client.id, method: 'CASH', cashboxId: b.cash.id, amount: SALE, date: '2026-07-22' }, 201);
  eq(await boxBal(b.cash.id), bcash0 + SALE, 'B: bekordan oldin naqd kassa +24M');

  await req('DELETE', `/orders/${order2.id}`, { reason: 'egasi testi' }, 200); // mode yubormaymiz ⇒ REFUND

  eq(await clientBal(b.client.id), 0, 'B: mijoz balansi 0 (puli qaytarildi)');
  eq((await factoryOf(b.factory.id)).balance, 0, 'B: zavod balansi 0');
  eq(await boxBal(b.cash.id), bcash0, 'B: naqd kassa OLDINGI holatga qaytdi');

  // ══════════ C) REFUND: mijoz QISMAN to'ladi → faqat to'lagani qaytadi ══════════
  console.log("\n── C) REFUND: mijoz qisman to'ladi → bekor ──");
  const c = await setup('C');
  const ccash0 = await boxBal(c.cash.id);
  const order3 = await makeOrder(c);
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: c.client.id, method: 'CASH', cashboxId: c.cash.id, amount: 10_000_000, date: '2026-07-22' }, 201);
  await req('DELETE', `/orders/${order3.id}`, { reason: 'qisman', mode: 'REFUND' }, 200);
  eq(await clientBal(c.client.id), 0, 'C: mijoz balansi 0 (10M qaytarildi)');
  eq(await boxBal(c.cash.id), ccash0, 'C: naqd kassa OLDINGI holatga qaytdi (10M chiqdi)');

  // ══════════ D) to'lovsiz bekor: hech narsa qimirlamaydi, xato ham yo'q ══════════
  console.log("\n── D) mijoz to'lamadi → bekor ──");
  const d = await setup('D');
  const dcash0 = await boxBal(d.cash.id);
  const order4 = await makeOrder(d);
  await req('DELETE', `/orders/${order4.id}`, { reason: "to'lovsiz" }, 200);
  eq(await clientBal(d.client.id), 0, 'D: mijoz balansi 0');
  eq(await boxBal(d.cash.id), dcash0, "D: kassa o'zgarmadi");

  // ══════════ E) EGASINING STSENARIYSI — REFUND ══════════
  // 24M mahsulot, transport summa ICHIDA 2M. Mijoz shofyorga 2M, bizga 22M to'ladi.
  // Biz zavodga 20M (bank). Bekor «Ha» ⇒ 22M NAQD qaytadi (kassa oldingi holatga),
  // shofyorga bergan 2M esa balansida KREDIT bo'lib qoladi (diller transportni oladi).
  console.log("\n── E) EGASINING KEYSI (REFUND): 22M naqd qaytadi + 2M kredit ──");
  const e = await setup('E');
  const ecash0 = await boxBal(e.cash.id), ebank0 = await boxBal(e.bank.id);
  const T = 2_000_000;
  const owedToDealer = SALE - T; // 22M
  const orderE = await makeOrder(e, { transportMode: 'CLIENT_PAYS_DRIVER', transportCost: T });
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: e.client.id, method: 'CASH', cashboxId: e.cash.id, amount: owedToDealer, date: '2026-07-22' }, 201);
  await req('POST', '/payments', { kind: 'TRANSPORT_DIRECT', clientId: e.client.id, vehicleId: orderE.vehicleId, method: 'CASH', amount: T, date: '2026-07-22', allocations: [{ orderId: orderE.id, amount: T }] }, 201);
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: e.factory.id, method: 'BANK', cashboxId: e.bank.id, amount: COST_BANK, date: '2026-07-22' }, 201);
  await req('POST', `/orders/${orderE.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  eq(await clientBal(e.client.id), 0, "E: bekordan oldin mijoz balansi 0 (22M qarz, 22M to'landi)");
  eq(await boxBal(e.cash.id), ecash0 + owedToDealer, "E: naqd kassa +22M (shofyor puli kassadan o'tmaydi)");

  await req('DELETE', `/orders/${orderE.id}`, { reason: 'egasi stsenariysi', mode: 'REFUND' }, 200);

  eq(await clientBal(e.client.id), -T, 'E: mijoz balansi = 2M KREDIT (faqat shofyorga bergani)');
  eq((await factoryOf(e.factory.id)).balance, 0, "E: zavod balansi 0 (to'lov qaytdi)");
  eq(await boxBal(e.cash.id), ecash0, 'E: naqd kassa OLDINGI holatga qaytdi (22M mijozga chiqdi)');
  eq(await boxBal(e.bank.id), ebank0, "E: bank kassa OLDINGI holatga qaytdi (zavod to'lovi qaytdi)");

  // ══════════ F) EGASINING KEYSI — VOID_ALL: hamma o'tkazmalar yo'qoladi ══════════
  // Ayni E stsenariysi, lekin «Yo'q — hamma o'tkazmalar yo'qolsin». Natija: mijozda ham,
  // shofyorda ham, kassada ham, zavodda ham iz qolmaydi — buyurtma berilmagandek.
  console.log("\n── F) EGASINING KEYSI (VOID_ALL): hamma o'tkazmalar yo'qoladi ──");
  const f = await setup('F');
  const fcash0 = await boxBal(f.cash.id), fbank0 = await boxBal(f.bank.id);
  const orderF = await makeOrder(f, { transportMode: 'CLIENT_PAYS_DRIVER', transportCost: T });
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: f.client.id, method: 'CASH', cashboxId: f.cash.id, amount: owedToDealer, date: '2026-07-22' }, 201);
  await req('POST', '/payments', { kind: 'TRANSPORT_DIRECT', clientId: f.client.id, vehicleId: orderF.vehicleId, method: 'CASH', amount: T, date: '2026-07-22', allocations: [{ orderId: orderF.id, amount: T }] }, 201);
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: f.factory.id, method: 'BANK', cashboxId: f.bank.id, amount: COST_BANK, date: '2026-07-22' }, 201);
  await req('POST', `/orders/${orderF.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);

  await req('DELETE', `/orders/${orderF.id}`, { reason: 'hammasi yo\'qolsin', mode: 'VOID_ALL' }, 200);

  eq(await clientBal(f.client.id), 0, 'F: mijoz balansi 0 — transport krediti ham YO\'Q');
  eq((await factoryOf(f.factory.id)).balance, 0, 'F: zavod balansi 0');
  eq(await boxBal(f.cash.id), fcash0, 'F: naqd kassa buyurtmadan OLDINGI holatda');
  eq(await boxBal(f.bank.id), fbank0, 'F: bank kassa buyurtmadan OLDINGI holatda');
  // to'lovlarning o'zi ham tirik qolmasligi kerak
  const fPays = (await req('GET', `/payments?clientId=${f.client.id}&pageSize=50`)).body?.items ?? [];
  const liveClientPays = fPays.filter((p) => !p.voidedAt && (p.kind === 'CLIENT_IN' || p.kind === 'TRANSPORT_DIRECT'));
  eq(liveClientPays.length, 0, "F: mijozning CLIENT_IN va TRANSPORT_DIRECT to'lovlari bekor qilingan");

  // ══════════ G) VOID_ALL to'lovsiz buyurtmada ham xatosiz ishlaydi ══════════
  console.log('\n── G) VOID_ALL — to\'lovsiz buyurtma ──');
  const g = await setup('G');
  const gcash0 = await boxBal(g.cash.id);
  const orderG = await makeOrder(g);
  await req('DELETE', `/orders/${orderG.id}`, { reason: 'bo\'sh', mode: 'VOID_ALL' }, 200);
  eq(await clientBal(g.client.id), 0, 'G: mijoz balansi 0');
  eq(await boxBal(g.cash.id), gcash0, "G: kassa o'zgarmadi");

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) { console.log('\nXATOLAR:'); for (const f2 of fails) console.log('  · ' + f2); }
  process.exit(fails.length ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
