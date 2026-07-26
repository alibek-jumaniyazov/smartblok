// Bekor qilishning IKKI REJIMI + NAQD/O'TKAZMA KANALLARI ARALASHMASLIGI
// (egasi qoidasi, 2026-07-26 — 2026-07-22 kechqurungi qoidani almashtiradi).
//
// IKKALA REJIMDA HAM:
//   · biz zavodga to'lagan pul AYNAN pul chiqqan kassaga va AYNAN o'sha kanalga qaytadi
//     (naqd → naqd, o'tkazma → o'tkazma). Boshqa kanalning avansiga hech qachon tegilmaydi.
//   · to'lov butunlay shu buyurtmaniki bo'lsa — asl hujjatning STORNOsi yoziladi, ya'ni
//     «huddi kassaga pul kirmagandek, kassadan chiqmagandek».
//   · mijoz SHOFYORGA o'z qo'li bilan bergan puli hujjat sifatida bekor qilinadi (u pul
//     kassamizdan o'tmagan va dillerda mijoz oldida qarz qoldirmaydi).
//
// Farq faqat MIJOZ BIZGA to'lagan pulda:
//   • REFUND   («Balansida kredit bo'lib qoladi», default) — kassa QIMIRLAMAYDI. Savdo
//     qarzi bekor bo'lgani uchun o'sha pul mijozning BALANSIDA KREDIT (avans) bo'lib
//     qoladi va keyingi buyurtmasiga ishlatiladi.
//   • VOID_ALL («To'lamagandek bo'lsin») — to'lov hujjatining o'zi storno qilinadi: pul
//     kassadan chiqadi, mijoz balansi 0. Buyurtma umuman berilmagandek.
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
const paymentsOfFactory = async (id) =>
  (await req('GET', `/payments?factoryId=${id}&pageSize=50&voided=true`)).body?.items ?? [];

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

  // Mijozning puli BIZDA qoladi ⇒ balansida 24M kredit, naqd kassa qimirlamaydi.
  eq(await clientBal(a.client.id), -SALE, 'A: mijoz balansi = 24M KREDIT (puli balansida qoldi)');
  eq(await boxBal(a.cash.id), cash0 + SALE, 'A: naqd kassa QIMIRLAMADI (mijoz puli bizda)');
  const fa = await factoryOf(a.factory.id);
  eq(fa.balance, 0, "A: zavod balansi 0 (to'lov storno qilindi)");
  eq(fa.advanceBank, 0, 'A: zavod bank avansi 0');
  eq(fa.advanceCash, 0, 'A: zavod naqd avansi 0 — naqd kanalga TEGILMAGAN');
  eq(await boxBal(a.bank.id), bank0, "A: bank kassa OLDINGI holatga qaytdi (zavod to'lovi storno)");
  // asl hujjat storno qilinadi — «qaytarish» degan yangi FACTORY_REFUND hujjati YOZILMAYDI
  const aPays = await paymentsOfFactory(a.factory.id);
  eq(aPays.filter((p) => p.kind === 'FACTORY_REFUND').length, 0, 'A: FACTORY_REFUND hujjati yaratilmadi (storno yo\'li)');
  eq(aPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 0, "A: zavodga to'lov bekor qilingan");

  // ══════════ B) REFUND: mijoz to'ladi, ZAVODGA TO'LAMADIK → bekor ══════════
  console.log("\n── B) REFUND: mijoz to'ladi, zavodga to'lamadik → bekor ──");
  const b = await setup('B');
  const bcash0 = await boxBal(b.cash.id);
  const order2 = await makeOrder(b);
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: b.client.id, method: 'CASH', cashboxId: b.cash.id, amount: SALE, date: '2026-07-22' }, 201);
  eq(await boxBal(b.cash.id), bcash0 + SALE, 'B: bekordan oldin naqd kassa +24M');

  await req('DELETE', `/orders/${order2.id}`, { reason: 'egasi testi' }, 200); // mode yubormaymiz ⇒ REFUND

  eq(await clientBal(b.client.id), -SALE, 'B: mijoz balansi = 24M kredit');
  eq((await factoryOf(b.factory.id)).balance, 0, 'B: zavod balansi 0');
  eq(await boxBal(b.cash.id), bcash0 + SALE, 'B: naqd kassa qimirlamadi');

  // ══════════ C) REFUND: mijoz QISMAN to'ladi → to'lagani kredit bo'ladi ══════════
  console.log("\n── C) REFUND: mijoz qisman to'ladi → bekor ──");
  const c = await setup('C');
  const ccash0 = await boxBal(c.cash.id);
  const order3 = await makeOrder(c);
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: c.client.id, method: 'CASH', cashboxId: c.cash.id, amount: 10_000_000, date: '2026-07-22' }, 201);
  await req('DELETE', `/orders/${order3.id}`, { reason: 'qisman', mode: 'REFUND' }, 200);
  eq(await clientBal(c.client.id), -10_000_000, 'C: mijoz balansi = 10M kredit');
  eq(await boxBal(c.cash.id), ccash0 + 10_000_000, 'C: naqd kassa qimirlamadi');

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
  // Biz zavodga 20M (bank). Bekor «balansida qoladi» ⇒ 22M uning BALANSIDA kredit,
  // kassa qimirlamaydi; shofyorga bergan 2M hujjati bekor (kredit YOZILMAYDI).
  console.log("\n── E) EGASINING KEYSI (REFUND): 22M balansda kredit ──");
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

  eq(await clientBal(e.client.id), -owedToDealer, 'E: mijoz balansi = 22M KREDIT (bizga to\'lagani)');
  eq((await factoryOf(e.factory.id)).balance, 0, "E: zavod balansi 0 (to'lov storno qilindi)");
  eq(await boxBal(e.cash.id), ecash0 + owedToDealer, 'E: naqd kassa qimirlamadi');
  eq(await boxBal(e.bank.id), ebank0, "E: bank kassa OLDINGI holatga qaytdi");
  const ePays = (await req('GET', `/payments?clientId=${e.client.id}&pageSize=50&voided=true`)).body?.items ?? [];
  eq(ePays.filter((p) => p.kind === 'TRANSPORT_DIRECT' && !p.voidedAt).length, 0,
    'E: shofyorga to\'lov hujjati REFUND rejimida ham bekor qilindi');

  // ══════════ F) EGASINING KEYSI — VOID_ALL: hamma o'tkazmalar yo'qoladi ══════════
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
  const fPays = (await req('GET', `/payments?clientId=${f.client.id}&pageSize=50&voided=true`)).body?.items ?? [];
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

  // ══════════ H) EGASINING SHIKOYATI: NAQD AVANS O'TKAZMA BEKORIDA TEGILMAYDI ══════════
  // Zavodda 5M NAQD avansimiz turadi (butunlay boshqa pul). Buyurtmani O'TKAZMA bilan
  // yopamiz va bekor qilamiz. Naqd avans 5M JOYIDA turishi, naqd kassa esa qimirlamasligi
  // shart — ilgari `postFactoryRefund` kanal yetmasa ikkinchisidan yechib, ikki cho'ntakni
  // aralashtirib yuborardi.
  console.log("\n── H) NAQD avans o'tkazma bekorida TEGILMAYDI ──");
  const h = await setup('H');
  const hcash0 = await boxBal(h.cash.id), hbank0 = await boxBal(h.bank.id);
  const ADV_CASH = 5_000_000;
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: h.factory.id, method: 'CASH', cashboxId: h.cash.id, amount: ADV_CASH, date: '2026-07-22', note: 'naqd avans' }, 201);
  const orderH = await makeOrder(h);
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: h.factory.id, method: 'BANK', cashboxId: h.bank.id, amount: COST_BANK, date: '2026-07-22' }, 201);
  await req('POST', `/orders/${orderH.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  const hBefore = await factoryOf(h.factory.id);
  eq(hBefore.advanceCash, ADV_CASH, 'H: bekordan oldin naqd avans 5M');
  eq(hBefore.advanceBank, 0, "H: bekordan oldin o'tkazma avans 0 (buyurtmaga yechilgan)");

  await req('DELETE', `/orders/${orderH.id}`, { reason: 'kanal testi', mode: 'REFUND' }, 200);

  const hAfter = await factoryOf(h.factory.id);
  eq(hAfter.advanceCash, ADV_CASH, 'H: NAQD avans 5M JOYIDA — aralashish yo\'q');
  eq(hAfter.advanceBank, 0, "H: o'tkazma avans 0 (to'lov storno qilindi)");
  eq(hAfter.balance, ADV_CASH, 'H: zavod balansi = faqat naqd avans 5M');
  eq(await boxBal(h.cash.id), hcash0 - ADV_CASH, 'H: naqd kassa QIMIRLAMADI (-5M avansdan tashqari)');
  eq(await boxBal(h.bank.id), hbank0, "H: bank kassa OLDINGI holatga qaytdi");

  // ══════════ I) QISMAN yechilgan zavod to'lovi butunlay qaytarilmaydi ══════════
  // 30M o'tkazdik, buyurtmaga faqat 20M yechildi. Bekor qilinganda 10M zavodda TURISHI
  // kerak — ilgari «butunlay shu buyurtmaniki» tekshiruvi faqat taqsimotlarni solishtirib,
  // butun 30M ni storno qilib yuborardi.
  console.log('\n── I) qisman yechilgan zavod to\'lovi: 10M zavodda qoladi ──');
  const i = await setup('I');
  const ibank0 = await boxBal(i.bank.id);
  const BIG = 30_000_000;
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: i.factory.id, method: 'BANK', cashboxId: i.bank.id, amount: BIG, date: '2026-07-22' }, 201);
  const orderI = await makeOrder(i);
  await req('POST', `/orders/${orderI.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  await req('DELETE', `/orders/${orderI.id}`, { reason: 'qisman yechilgan', mode: 'REFUND' }, 200);
  const iAfter = await factoryOf(i.factory.id);
  eq(iAfter.advanceBank, BIG - COST_BANK, 'I: zavodda 10M o\'tkazma avans QOLDI');
  eq(iAfter.advanceCash, 0, 'I: naqd avans 0 — naqd kanalga tegilmagan');
  eq(await boxBal(i.bank.id), ibank0 - (BIG - COST_BANK), 'I: bank kassadan faqat 10M chiqib turgan');
  const iPays = await paymentsOfFactory(i.factory.id);
  eq(iPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 1,
    'I: asl 30M to\'lov TIRIK qoldi (butunlay storno qilinmadi)');

  // ══════════ J) NAQD narxi yo'q mahsulotda naqd bilan hisob-kitob BLOKLANADI ══════════
  console.log('\n── J) zavod NAQD narxi yo\'q ⇒ naqd kanal bloklanadi ──');
  const j = await setup('J');
  const noCash = (await req('POST', '/products', { factoryId: j.factory.id, name: `NB ${U}`, m3PerPallet: 1.728 }, 201)).body;
  for (const [kind, price] of [['FACTORY_BANK', 625000], ['DEALER_SALE', 750000]])
    await req('POST', `/products/${noCash.id}/prices`, { kind, pricePerM3: price, effectiveFrom: '2026-07-01' }, 201);

  const orderBody = {
    clientId: j.client.id, date: '2026-07-22',
    oneTimeVehicle: { name: `Mo ${U}`, plate: `NC${U}${Math.random().toString(36).slice(2, 5)}` },
    transportMode: 'CLIENT_OWN',
    items: [{ productId: noCash.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
  };
  // naqd usulini TANLAB bo'lmaydi — narx yo'q
  const badIntent = await req('POST', '/orders', { ...orderBody, factoryPayIntent: 'CASH' }, 400);
  ok(/naqd narxi belgilanmagan/i.test(JSON.stringify(badIntent.body ?? '')),
    'J: intent=CASH ⇒ 400 «zavod naqd narxi belgilanmagan»');
  // «aniq emas» va o'tkazma bilan yaratish ishlaydi (sotuvni bloklamaydi)
  const orderJ = (await req('POST', '/orders', { ...orderBody, factoryPayIntent: 'BANK' }, 201)).body;
  ok(!!orderJ?.id, 'J: o\'tkazma usuli bilan buyurtma yaratildi');
  const card = (await req('GET', `/orders/${orderJ.id}`)).body;
  eq(card.costTotalBank, COST_BANK, 'J: o\'tkazma tannarxi ko\'rinadi');
  ok(card.costTotalCash === null, 'J: naqd tannarx «—» (null) — ikkinchi kanal raqami QO\'YILMAYDI');
  ok(card.factoryCoverage?.hasCashPrice === false, 'J: hasCashPrice=false');
  ok((card.factoryCoverage?.missingCashPriceProducts ?? []).includes(noCash.name),
    'J: narxi yo\'q mahsulot nomi aytiladi');
  // naqd usuliga o'tish ham bloklanadi
  await req('PATCH', `/orders/${orderJ.id}/factory-pay-intent`, { factoryPayIntent: 'CASH' }, 400);
  ok(true, 'J: factory-pay-intent=CASH ⇒ 400');
  // naqd to'lovni buyurtmaga taqsimlash ham bloklanadi
  const badPay = await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: j.factory.id, method: 'CASH', cashboxId: j.cash.id,
    amount: 1_000_000, date: '2026-07-22', allocations: [{ orderId: orderJ.id, amount: 1_000_000 }],
  }, 400);
  ok(/naqd/i.test(JSON.stringify(badPay.body ?? '')), 'J: naqd to\'lovni taqsimlash ⇒ 400');
  // narx kiritilgach — ishlaydi
  await req('POST', `/products/${noCash.id}/prices`, { kind: 'FACTORY_CASH', pricePerM3: 600000, effectiveFrom: '2026-07-01' }, 201);
  await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: j.factory.id, method: 'CASH', cashboxId: j.cash.id,
    amount: 1_000_000, date: '2026-07-22', allocations: [{ orderId: orderJ.id, amount: 1_000_000 }],
  }, 201);
  const card2 = (await req('GET', `/orders/${orderJ.id}`)).body;
  eq(card2.factoryCoverage?.paidCash, 1_000_000, 'J: narx kiritilgach naqd to\'lov o\'tdi');

  // ══════════ K) EGASINING ASOSIY SHIKOYATI: «naqd» tanlansa NAQD narxda bo'lsin ══════════
  // Buyurtma yaratilganda zavodga beriladigan pul o'tkazma narxida qotib qolardi: naqd
  // tanlansa ham tizim jimgina FACTORY_BANK narxini olardi (chunki mahsulotda naqd narx
  // yo'q edi). Narx bor bo'lsa — tannarx ANIQ naqd narxda yozilishi va kartada ikkala
  // raqam BOSHQA-BOSHQA ko'rinishi shart.
  console.log('\n── K) «naqd» tanlansa tannarx NAQD narxda ──');
  const COST_CASH = 32 * 600_000; // 19 200 000 — o'tkazmada 20 000 000
  const orderK = (await req('POST', '/orders', {
    clientId: j.client.id, date: '2026-07-22', factoryPayIntent: 'CASH',
    oneTimeVehicle: { name: `Mo ${U}`, plate: `KC${U}${Math.random().toString(36).slice(2, 5)}` },
    transportMode: 'CLIENT_OWN',
    items: [{ productId: noCash.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
  }, 201)).body;
  eq(orderK.costTotal, COST_CASH, 'K: naqd tanlangan buyurtma tannarxi NAQD narxda');
  const cardK = (await req('GET', `/orders/${orderK.id}`)).body;
  eq(cardK.costTotalCash, COST_CASH, 'K: kartada naqd tannarx 19 200 000');
  eq(cardK.costTotalBank, COST_BANK, "K: kartada o'tkazma tannarx 20 000 000");
  ok(num(cardK.costTotalCash) !== num(cardK.costTotalBank), 'K: ikkala raqam BIR XIL EMAS');

  // …va o'tkazma tanlansa — o'tkazma narxida (nazorat namunasi)
  const orderK2 = (await req('POST', '/orders', {
    clientId: j.client.id, date: '2026-07-22', factoryPayIntent: 'BANK',
    oneTimeVehicle: { name: `Mo ${U}`, plate: `KB${U}${Math.random().toString(36).slice(2, 5)}` },
    transportMode: 'CLIENT_OWN',
    items: [{ productId: noCash.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
  }, 201)).body;
  eq(orderK2.costTotal, COST_BANK, "K: o'tkazma tanlangan buyurtma tannarxi O'TKAZMA narxda");

  // ══════════ L) bekor qilingan buyurtma ro'yxatda AJRALIB turadi ══════════
  console.log('\n── L) bekor qilingan buyurtma ro\'yxatda ko\'rinadi ──');
  await req('DELETE', `/orders/${orderK2.id}`, { reason: 'ro\'yxat testi', mode: 'REFUND' }, 200);
  const listL = (await req('GET', `/orders?clientId=${j.client.id}&pageSize=200`)).body?.items ?? [];
  const rowL = listL.find((o) => o.id === orderK2.id);
  ok(!!rowL, 'L: bekor qilingan buyurtma ro\'yxatdan yo\'qolmaydi');
  ok(rowL?.status === 'CANCELLED', 'L: ro\'yxat qatorida status = CANCELLED (UI «Bekor» deb belgilaydi)');

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) { console.log('\nXATOLAR:'); for (const f2 of fails) console.log('  · ' + f2); }
  process.exit(fails.length ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
