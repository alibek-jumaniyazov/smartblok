// Bekor qilishning IKKI REJIMI + NAQD/O'TKAZMA KANALLARI ARALASHMASLIGI
// (egasi qoidasi, 2026-07-29 — 2026-07-26 qoidasini almashtiradi).
//
// BITTA savol IKKALA tomonni hal qiladi — «To'langan pullar avansda qoladimi?»:
//
//   • REFUND («Ha — avansda qoladi», default) — BEKOR QILISH PULNI QIMIRLATMAYDI. Pul
//     jismonan qayerda bo'lsa o'sha yerda turaveradi:
//       · mijoz BIZGA to'lagani bizda qoladi ⇒ uning balansida KREDIT (avans);
//       · biz ZAVODGA o'tkazganimiz zavodda qoladi ⇒ o'z KANALIDAGI avansimiz
//         (naqd → naqd avans, o'tkazma → o'tkazma avans);
//       · KASSA UMUMAN QIMIRLAMAYDI — hech kim hech kimga pul qaytarmagan.
//     EGASINING SHIKOYATI shu yerda edi: ilgari «Ha» tanlansa ham zavod to'lovi storno
//     qilinardi, ya'ni tizim «zavod pulni qaytardi» deb YOLG'ON yozib, bank kassasida
//     hech kim bermagan pulni ko'rsatardi va zavodda haqiqatda turgan avansni o'chirardi.
//
//   • VOID_ALL («Yo'q — to'lamagandek bo'lsin») — xato kiritishni tozalash: IKKALA
//     tomonning ham hujjati storno qilinadi. Zavod puli AYNAN pul chiqqan kassaga va
//     AYNAN o'sha kanalga qaytadi (naqd → naqd, o'tkazma → o'tkazma); boshqa kanalning
//     avansiga hech qachon tegilmaydi. Mijoz balansi 0, kassa buyurtmadan oldingi holatda.
//
// Ikkalasida ham: mijoz SHOFYORGA o'z qo'li bilan bergan puli hujjat sifatida bekor
// qilinadi (u pul kassamizdan o'tmagan va dillerda mijoz oldida qarz qoldirmaydi).
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
  // zavod narxlari yaratishda majburiy (2026-07-28) — sana ATAYLAB beriladi, aks holda
  // qatorlar «bugun» bilan yozilib, test ishga tushgan kunga bog'liq bo'lib qolardi
  const product = (await req('POST', '/products', {
    factoryId: factory.id, name: `B ${U}-${tag}`, m3PerPallet: 1.728,
    priceFactoryCash: 600000, priceFactoryBank: 625000, pricesEffectiveFrom: '2026-07-01',
  }, 201)).body;
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
  // ⭐ EGASINING TALABI (2026-07-29): zavodda ham avans QOLADI.
  const fa = await factoryOf(a.factory.id);
  eq(fa.advanceBank, COST_BANK, "A: ⭐ zavodda 20M O'TKAZMA AVANS QOLDI (pul zavodda turibdi)");
  eq(fa.advanceCash, 0, 'A: zavod naqd avansi 0 — naqd kanalga TEGILMAGAN');
  eq(fa.balance, COST_BANK, 'A: zavod balansi = 20M avans');
  eq(await boxBal(a.bank.id), bank0 - COST_BANK, 'A: ⭐ bank kassa QAYTMADI — pul haqiqatda zavodda');
  // hech qanday «qaytarish» hujjati ham, storno ham yozilmaydi: to'lov TIRIK qoladi
  const aPays = await paymentsOfFactory(a.factory.id);
  eq(aPays.filter((p) => p.kind === 'FACTORY_REFUND').length, 0, 'A: FACTORY_REFUND hujjati yaratilmadi');
  eq(aPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 1, "A: ⭐ zavodga to'lov TIRIK qoldi (storno YO'Q)");

  // …va o'sha avans haqiqatan ISHLATILADI: yangi buyurtmaga yechib bo'ladi (pul osilib
  // qolmadi). Bu tekshiruvsiz «avans ko'rinadi-yu, sarflab bo'lmaydi» holati sezilmasdi.
  const orderA2 = await makeOrder(a);
  await req('POST', `/orders/${orderA2.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  const fa2 = await factoryOf(a.factory.id);
  eq(fa2.advanceBank, 0, 'A: qolgan avans yangi buyurtmaga to‘liq yechildi');
  eq((await req('GET', `/orders/${orderA2.id}`)).body?.factoryPaid, COST_BANK,
    'A: ⭐ bekor qilingan buyurtmaning avansi YANGI buyurtmani yopdi');

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
  eq((await factoryOf(e.factory.id)).advanceBank, COST_BANK, 'E: ⭐ zavodda 20M avans QOLDI');
  eq(await boxBal(e.cash.id), ecash0 + owedToDealer, 'E: naqd kassa qimirlamadi');
  eq(await boxBal(e.bank.id), ebank0 - COST_BANK, 'E: ⭐ bank kassa ham qimirlamadi (pul zavodda)');
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
  const ff = await factoryOf(f.factory.id);
  eq(ff.balance, 0, 'F: zavod balansi 0');
  eq(ff.advanceBank, 0, "F: zavodda avans QOLMAYDI («Yo'q» tanlandi)");
  eq(ff.advanceCash, 0, 'F: naqd avans ham 0');
  eq(await boxBal(f.cash.id), fcash0, 'F: naqd kassa buyurtmadan OLDINGI holatda');
  eq(await boxBal(f.bank.id), fbank0, 'F: bank kassa buyurtmadan OLDINGI holatda');
  const fFactoryPays = await paymentsOfFactory(f.factory.id);
  eq(fFactoryPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 0,
    "F: zavodga to'lov hujjati storno qilindi");
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
  eq(hAfter.advanceBank, COST_BANK, "H: ⭐ o'tkazma avans 20M ga qaytdi (o'z kanalida)");
  eq(hAfter.balance, ADV_CASH + COST_BANK, 'H: zavod balansi = 5M naqd + 20M o‘tkazma avans');
  eq(await boxBal(h.cash.id), hcash0 - ADV_CASH, 'H: naqd kassa QIMIRLAMADI (-5M avansdan tashqari)');
  eq(await boxBal(h.bank.id), hbank0 - COST_BANK, 'H: ⭐ bank kassa qimirlamadi (pul zavodda qoldi)');

  // ══════════ I) QISMAN yechilgan zavod to'lovi — BUTUN 30M zavodda qoladi ══════════
  // 30M o'tkazdik, buyurtmaga faqat 20M yechildi. «Ha — avansda qoladi» da BUTUN 30M
  // zavodda turishi kerak: 10M umuman tegilmagan, yechilgan 20M esa avansiga qaytdi.
  console.log('\n── I) qisman yechilgan zavod to\'lovi: butun 30M zavodda qoladi ──');
  const i = await setup('I');
  const ibank0 = await boxBal(i.bank.id);
  const BIG = 30_000_000;
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: i.factory.id, method: 'BANK', cashboxId: i.bank.id, amount: BIG, date: '2026-07-22' }, 201);
  const orderI = await makeOrder(i);
  await req('POST', `/orders/${orderI.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  await req('DELETE', `/orders/${orderI.id}`, { reason: 'qisman yechilgan', mode: 'REFUND' }, 200);
  const iAfter = await factoryOf(i.factory.id);
  eq(iAfter.advanceBank, BIG, 'I: ⭐ zavodda BUTUN 30M o\'tkazma avans QOLDI');
  eq(iAfter.advanceCash, 0, 'I: naqd avans 0 — naqd kanalga tegilmagan');
  eq(await boxBal(i.bank.id), ibank0 - BIG, 'I: ⭐ bank kassadan butun 30M chiqib turgan (qaytmadi)');
  const iPays = await paymentsOfFactory(i.factory.id);
  eq(iPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 1,
    'I: asl 30M to\'lov TIRIK qoldi');
  eq(iPays.filter((p) => p.kind === 'FACTORY_REFUND').length, 0,
    'I: qisman qaytarish hujjati ham YOZILMAYDI');

  // ══════════ M) NAQD kanal: «Ha — avansda qoladi» naqd pulda ham ishlaydi ══════════
  // Butun fayl o'tkazma (BANK) bilan yozilgan edi, ya'ni naqd yarmi umuman sinalmagan:
  // `advanceCash` tekshiruvlari 0 ni 0 bilan solishtirardi. Bu yerda pul NAQD kanaldan
  // chiqadi va naqd avans bo'lib qaytishi, naqd KASSA esa qimirlamasligi shart.
  console.log('\n── M) NAQD kanal: avans naqd cho\'ntagida qoladi ──');
  const m = await setup('M');
  const COST_CASH_M = 32 * 600_000; // 19 200 000 — naqd narxida
  const mcash0 = await boxBal(m.cash.id), mbank0 = await boxBal(m.bank.id);
  const orderM = await makeOrder(m, { factoryPayIntent: 'CASH' });
  eq(orderM.costTotal, COST_CASH_M, 'M: naqd tanlangan buyurtma tannarxi NAQD narxda');
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: m.factory.id, method: 'CASH', cashboxId: m.cash.id, amount: COST_CASH_M, date: '2026-07-22' }, 201);
  await req('POST', `/orders/${orderM.id}/factory-advance-draw`, { bucket: 'ADVANCE_CASH', date: '2026-07-22' }, 201);
  eq((await factoryOf(m.factory.id)).advanceCash, 0, 'M: bekordan oldin naqd avans 0 (buyurtmaga yechilgan)');

  await req('DELETE', `/orders/${orderM.id}`, { reason: 'naqd kanal', mode: 'REFUND' }, 200);

  const mAfter = await factoryOf(m.factory.id);
  eq(mAfter.advanceCash, COST_CASH_M, 'M: ⭐ NAQD avans 19.2M zavodda QOLDI');
  eq(mAfter.advanceBank, 0, "M: o'tkazma avansga TEGILMAGAN");
  eq(await boxBal(m.cash.id), mcash0 - COST_CASH_M, 'M: ⭐ naqd kassa QAYTMADI — pul zavodda');
  eq(await boxBal(m.bank.id), mbank0, "M: bank kassa umuman qimirlamadi");
  const mPays = await paymentsOfFactory(m.factory.id);
  eq(mPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 1, "M: naqd to'lov TIRIK qoldi");
  eq(mPays.filter((p) => p.kind === 'FACTORY_REFUND').length, 0, 'M: qaytarish hujjati yozilmadi');
  // naqd avans yangi NAQD buyurtmaga yechiladi — pul osilib qolmadi
  const orderM2 = await makeOrder(m, { factoryPayIntent: 'CASH' });
  await req('POST', `/orders/${orderM2.id}/factory-advance-draw`, { bucket: 'ADVANCE_CASH', date: '2026-07-22' }, 201);
  eq((await req('GET', `/orders/${orderM2.id}`)).body?.factoryPaid, COST_CASH_M,
    'M: ⭐ naqd avans yangi buyurtmani yopdi');
  eq((await factoryOf(m.factory.id)).advanceCash, 0, 'M: naqd avans to‘liq sarflandi');

  // ══════════ N) VOID_ALL + QISMAN yechilgan to'lov: faqat ULUSH qaytadi ══════════
  // «Yo'q» yo'lidagi yagona kanalga-qat'iy qaytarish kodi (postCancelRefund) hech qachon
  // sinalmagan edi — F bo'limida to'lov butunlay shu buyurtmaniki bo'lgani uchun oddiy
  // storno ishlardi. Bu yerda 30M dan faqat 20M yechilgan: kassaga AYNAN 20M qaytishi,
  // qolgan 10M zavodda turishi va NAQD kanalga tegilmasligi kerak.
  console.log('\n── N) VOID_ALL: qisman yechilgan to\'lovdan faqat ulush qaytadi ──');
  const n = await setup('N');
  const ADV_CASH_N = 7_000_000; // boshqa cho'ntakdagi begona pul — unga tegilmasligi shart
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: n.factory.id, method: 'CASH', cashboxId: n.cash.id, amount: ADV_CASH_N, date: '2026-07-22', note: 'naqd avans' }, 201);
  const ncash0 = await boxBal(n.cash.id), nbank0 = await boxBal(n.bank.id);
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: n.factory.id, method: 'BANK', cashboxId: n.bank.id, amount: BIG, date: '2026-07-22' }, 201);
  const orderN = await makeOrder(n);
  await req('POST', `/orders/${orderN.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);

  await req('DELETE', `/orders/${orderN.id}`, { reason: 'qisman + void', mode: 'VOID_ALL' }, 200);

  const nAfter = await factoryOf(n.factory.id);
  eq(nAfter.advanceBank, BIG - COST_BANK, "N: zavodda yechilmagan 10M o'tkazma avans QOLDI");
  eq(nAfter.advanceCash, ADV_CASH_N, 'N: ⭐ begona NAQD avans 7M TEGILMAGAN (kanallar aralashmadi)');
  eq(await boxBal(n.bank.id), nbank0 - (BIG - COST_BANK), 'N: bank kassaga AYNAN 20M qaytdi');
  eq(await boxBal(n.cash.id), ncash0, 'N: naqd kassa umuman qimirlamadi');
  const nPays = await paymentsOfFactory(n.factory.id);
  const nRefunds = nPays.filter((p) => p.kind === 'FACTORY_REFUND' && !p.voidedAt);
  eq(nRefunds.length, 1, "N: bitta FACTORY_REFUND hujjati yozildi");
  eq(nRefunds[0]?.amount, COST_BANK, 'N: qaytarish summasi = yechilgan ULUSH (20M), butun 30M emas');
  eq(nPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 2, "N: ikkala asl to'lov TIRIK");

  // ══════════ O) BITTA to'lov IKKI buyurtmani yopgan — biri bekor qilinsa ══════════
  // `whollyThisOrder` aynan shu holat uchun qattiqlashtirilgan edi, lekin testi yo'q edi:
  // order1 bekor qilinganda order2 ning yopilgani ochilib ketmasligi shart.
  console.log('\n── O) bitta to\'lov ikki buyurtmada: biri bekor bo\'lsa ikkinchisi tegilmaydi ──');
  const o = await setup('O');
  const obank0 = await boxBal(o.bank.id);
  const BOTH = 40_000_000; // 2 × 20M
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: o.factory.id, method: 'BANK', cashboxId: o.bank.id, amount: BOTH, date: '2026-07-22' }, 201);
  const orderO1 = await makeOrder(o);
  const orderO2 = await makeOrder(o);
  await req('POST', `/orders/${orderO1.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  await req('POST', `/orders/${orderO2.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', date: '2026-07-22' }, 201);
  eq((await factoryOf(o.factory.id)).advanceBank, 0, 'O: bekordan oldin avans 0 (ikkalasiga yechilgan)');

  await req('DELETE', `/orders/${orderO1.id}`, { reason: 'ikkitadan biri', mode: 'REFUND' }, 200);

  eq((await factoryOf(o.factory.id)).advanceBank, COST_BANK, 'O: ⭐ faqat bekor qilinganning 20M avansi qaytdi');
  const cardO2 = (await req('GET', `/orders/${orderO2.id}`)).body;
  eq(cardO2?.factoryPaid, COST_BANK, 'O: ⭐ IKKINCHI buyurtma yopilganicha qoldi');
  eq(cardO2?.factoryOutstanding, 0, 'O: ikkinchi buyurtmada zavod qarzi ochilib ketmadi');
  eq(await boxBal(o.bank.id), obank0 - BOTH, 'O: bank kassa qimirlamadi (butun 40M zavodda)');
  const oPays = await paymentsOfFactory(o.factory.id);
  eq(oPays.filter((p) => p.kind === 'FACTORY_OUT' && !p.voidedAt).length, 1, "O: ulashilgan to'lov TIRIK");
  eq(oPays.filter((p) => p.kind === 'FACTORY_REFUND').length, 0, 'O: qaytarish hujjati yozilmadi');

  // ══════════ P) bekor qilingan buyurtma o'z REJIMINI eslab qoladi ══════════
  // Rejim saqlanmasa kartochka bekordan keyin «pulim qani?» degan savolga javob bera
  // olmaydi — egasining shikoyati aynan shu edi.
  console.log('\n── P) bekor qilish rejimi buyurtmada saqlanadi ──');
  const cardM = (await req('GET', `/orders/${orderM.id}`)).body;
  ok(cardM?.cancelMoneyMode === 'REFUND', 'P: REFUND bilan bekor qilingan buyurtmada cancelMoneyMode=REFUND');
  const cardN = (await req('GET', `/orders/${orderN.id}`)).body;
  ok(cardN?.cancelMoneyMode === 'VOID_ALL', 'P: VOID_ALL bilan bekor qilinganda cancelMoneyMode=VOID_ALL');
  eq(cardM?.clientPaid, 0, "P: bekor qilingan buyurtmada «mijoz to'ladi» = 0 (to'lovsiz buyurtma)");

  // ══════════ J) NAQD narxi yo'q mahsulotda naqd bilan hisob-kitob BLOKLANADI ══════════
  console.log('\n── J) zavod NAQD narxi yo\'q ⇒ naqd kanal bloklanadi ──');
  const j = await setup('J');
  const noCash = (await req('POST', '/products', {
    factoryId: j.factory.id, name: `NB ${U}`, m3PerPallet: 1.728,
    priceFactoryCash: 600000, priceFactoryBank: 625000, pricesEffectiveFrom: '2026-07-01',
  }, 201)).body;
  // …va NAQD qatori olib tashlanadi: bu bo'lim aynan «naqd narxi yo'q» holatini tekshiradi
  const noCashRows = (await req('GET', `/products/${noCash.id}/prices`)).body ?? [];
  for (const row of noCashRows.filter((r) => r.kind === 'FACTORY_CASH'))
    await req('DELETE', `/products/${noCash.id}/prices/${row.id}`, undefined, 200);
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
  const badIntentText = JSON.stringify(badIntent.body ?? '');
  ok(/zavod \(naqd\) narxi kiritilmagan/i.test(badIntentText),
    'J: intent=CASH ⇒ 400 «zavod (naqd) narxi kiritilmagan»');
  // Xabar SANANI aytishi SHART (2026-07-28). Sanasiz matn egasini aylanma yo'lga solardi:
  // narx kiritiladi (bugungi sana bilan), eski buyurtmaga qaytiladi — xuddi shu xabar.
  ok(badIntentText.includes('22.07.2026'),
    'J: xabarda buyurtma SANASI bor — narx qaysi kundan kerakligi aytiladi');
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
