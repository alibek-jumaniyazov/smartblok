// «Kassa balansini tahrirlash» — off-book qoldiq tuzatishi (egasi qoidasi, 2026-07-23).
//
// Qoida: ADMIN kassa/bank qoldig'ini xuddi nomini o'zgartirgandek TAHRIRLAY oladi, LEKIN:
//   • qoldiq (karta, /kassa/summary closing, /dashboard/kassa balance) SILJIYDI;
//   • kirim/chiqim raqamlari (summary.in / summary.out / todayIn / todayOut) QIMIRLAMAYDI;
//   • dashboard kirim/chiqim/sof foyda (Payment'dan keladi) QIMIRLAMAYDI;
//   • jurnalda «Balans tuzatildi» sifatida KO'RINADI (audit izi);
//   • storno qilinmaydi — teskari tuzatish kiritiladi;
//   • kassani MINUSGA tushira olmaydi.
//
// Bu test aynan «siljiydi / qimirlamaydi» chegarasini qo'riqlaydi. U buzilsa kassa raqamlari
// jimgina bir-biriga zid bo'lib qoladi va buni hech kim sezmaydi.
//
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (bir marta)
//   cd apps/api
//   DATABASE_URL=...smartblok_test npx prisma migrate deploy && npx prisma generate && npm run build
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/kassa-balance-edit.e2e.mjs

const BASE = process.env.API_URL ?? 'http://localhost:4100/api';
const U = Date.now().toString(36).slice(-6);
let pass = 0;
const fails = [];
const num = (v) => Number(v ?? 0);
const near = (a, b, eps = 1) => Math.abs(num(a) - num(b)) <= eps;
const ok = (c, l) => { if (c) pass++; else fails.push(l); console.log(`${c ? '  ok  ' : ' FAIL '} ${l}`); };
const eq = (a, e, l) => ok(near(a, e), `${l} — kutilgan ${e}, keldi ${a}`);

let admin;
let accountant;
let cashier;

async function req(method, path, body, expect, token = admin) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
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

const boxes = async () => {
  const b = (await req('GET', '/kassa/cashboxes')).body;
  return b.items ?? b;
};
const boxOf = async (id) => (await boxes()).find((b) => b.id === id);
const sumRow = async (id, q = '') => {
  const s = (await req('GET', `/kassa/summary${q}`)).body;
  return (s?.cashboxes ?? []).find((r) => r.id === id);
};
const dashKassa = async (id) => ((await req('GET', '/dashboard/kassa')).body ?? []).find((r) => r.cashboxId === id);
const dashSummary = async () => (await req('GET', '/dashboard/summary')).body;
const journal = async (q = '') => (await req('GET', `/kassa/transactions?pageSize=100${q}`)).body;

const setBalance = (id, body, expect, token) =>
  req('POST', `/kassa/cashboxes/${id}/balance`, body, expect, token);

const main = async () => {
  admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 201, null)).body?.accessToken;
  ok(!!admin, 'admin login');
  accountant = (await req('POST', '/auth/login', { username: 'hisob', password: 'hisob123' }, 201, null)).body?.accessToken;
  ok(!!accountant, 'buxgalter login');
  cashier = (await req('POST', '/auth/login', { username: 'kassa', password: 'kassa123' }, 201, null)).body?.accessToken;
  ok(!!cashier, 'kassir login');

  const cash = (await boxes()).find((b) => b.type === 'CASH' && b.currency === 'UZS');
  ok(!!cash, 'naqd UZS kassa topildi');

  // ── REAL fon: haqiqiy kirim + chiqim + buyurtma + to'lov. Aks holda «O'ZGARMADI»
  //    tekshiruvlari 0 == 0 ni taqqoslab, tuzatish sizib chiqsa ham yashil qolardi.
  const factory = (await req('POST', '/factories', { name: `BalEdit zavod ${U}` }, 201)).body;
  const client = (await req('POST', '/clients', { name: `BalEdit mijoz ${U}` }, 201)).body;
  const product = (await req('POST', '/products', { factoryId: factory.id, name: `B ${U}`, m3PerPallet: 1.728 }, 201)).body;
  for (const [kind, price] of [['FACTORY_CASH', 600000], ['FACTORY_BANK', 625000], ['DEALER_SALE', 750000]])
    await req('POST', `/products/${product.id}/prices`, { kind, pricePerM3: price, effectiveFrom: '2026-07-01' }, 201);

  const TODAY = new Date().toISOString().slice(0, 10);
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'IN', amount: 500_000_000, date: TODAY, note: 'fon kirim' }, 201);
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'OUT', amount: 20_000_000, date: TODAY, note: 'fon chiqim' }, 201);
  await req('POST', '/orders', {
    clientId: client.id, date: TODAY, factoryPayIntent: 'BANK',
    oneTimeVehicle: { name: `Mo ${U}`, plate: `BE${U}${Math.random().toString(36).slice(2, 5)}` },
    transportMode: 'CLIENT_OWN',
    items: [{ productId: product.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
  }, 201);
  await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: client.id, method: 'CASH', cashboxId: cash.id,
    amount: 9_000_000, date: TODAY,
  }, 201);

  // ══════════ 0) boshlang'ich holat ══════════
  const WIN = `?dateFrom=${TODAY}&dateTo=${TODAY}`;
  const b0 = await boxOf(cash.id);
  const s0 = await sumRow(cash.id, WIN);
  const k0 = await dashKassa(cash.id);
  const d0 = await dashSummary();
  const rows0 = num((await journal()).total);

  ok(num(b0.balance) > 0, 'fon real: kassa qoldig\'i noldan katta');
  ok(num(s0.in) > 0, 'fon real: davr kirimi noldan katta');
  ok(num(s0.out) > 0, 'fon real: davr chiqimi noldan katta');
  ok(num(k0.todayIn) > 0, 'fon real: dashboard todayIn noldan katta');
  eq(s0.adjustment, 0, '0: boshida tuzatish yo\'q');
  eq(s0.closing, num(s0.opening) + num(s0.in) - num(s0.out), '0: closing = opening + kirim − chiqim');
  eq(s0.closing, b0.balance, '0: summary closing = karta qoldig\'i');

  // ══════════ A) qoldiqni OSHIRISH (aniq son yoziladi, delta emas) ══════════
  console.log('\n── A) qoldiqni +7 000 000 ga oshirish ──');
  const TARGET_UP = num(b0.balance) + 7_000_000;
  const resA = await setBalance(cash.id, { balance: TARGET_UP, note: "boshlang'ich qoldiq xato edi (test)" }, 201);
  eq(resA.body?.balance, TARGET_UP, 'A: javobda yangi qoldiq');
  eq(resA.body?.delta, 7_000_000, 'A: javobda hisoblangan farq');

  const bA = await boxOf(cash.id);
  const sA = await sumRow(cash.id, WIN);
  const kA = await dashKassa(cash.id);
  const dA = await dashSummary();

  eq(bA.balance, TARGET_UP, 'A: KASSA KARTASIDAGI QOLDIQ siljidi');
  eq(sA.in, s0.in, "A: /kassa/summary KIRIM O'ZGARMADI");
  eq(sA.out, s0.out, "A: /kassa/summary CHIQIM O'ZGARMADI");
  eq(sA.adjustment, 7_000_000, 'A: tuzatish alohida `adjustment` maydonida');
  eq(sA.closing, num(sA.opening) + num(sA.in) - num(sA.out) + num(sA.adjustment),
    'A: closing = opening + kirim − chiqim + tuzatish');
  eq(sA.closing, bA.balance, "A: summary closing = karta qoldig'i (bir ekranda ikki haqiqat yo'q)");
  eq(kA.balance, TARGET_UP, 'A: /dashboard/kassa balansi siljidi');
  eq(kA.todayIn, k0.todayIn, "A: /dashboard/kassa todayIn O'ZGARMADI");
  eq(kA.todayOut, k0.todayOut, "A: /dashboard/kassa todayOut O'ZGARMADI");
  eq(kA.todayAdjustment, 7_000_000, 'A: todayAdjustment alohida ko\'rsatiladi');
  eq(dA.allTime?.collected, d0.allTime?.collected, "A: dashboard KIRIM O'ZGARMADI");
  eq(dA.allTime?.chiqim, d0.allTime?.chiqim, "A: dashboard CHIQIM O'ZGARMADI");
  eq(dA.allTime?.netProfit, d0.allTime?.netProfit, "A: dashboard SOF FOYDA O'ZGARMADI");

  // ── jurnal: KO'RINADI (mijoz/zavod off-book tuzatishidan farqi shu) ──
  eq((await journal()).total, rows0 + 1, 'A: jurnalga bitta qator qo\'shildi');
  const adjList = (await journal('&source=BALANCE_ADJUSTMENT')).items ?? [];
  ok(adjList.length === 1, 'A: jurnalda «Balans tuzatildi» filtri bitta qator beradi');
  if (adjList[0]) {
    eq(adjList[0].amount, 7_000_000, 'A: jurnal qatoridagi summa');
    ok(adjList[0].direction === 'IN', 'A: oshirish = IN qator');
  }

  // ── Kirim filtri tuzatishni KO'RSATMAYDI (aks holda sahifa o'ziga zid bo'lardi) ──
  const inRows = (await journal('&direction=IN')).items ?? [];
  ok(!inRows.some((r) => r.source === 'BALANCE_ADJUSTMENT'), 'A: «Kirim» filtri tuzatishni chiqarmaydi');

  // ══════════ B) qoldiqni KAMAYTIRISH ══════════
  console.log('\n── B) qoldiqni 3 000 000 ga kamaytirish ──');
  const TARGET_DOWN = TARGET_UP - 3_000_000;
  await setBalance(cash.id, { balance: TARGET_DOWN }, 201);

  const bB = await boxOf(cash.id);
  const sB = await sumRow(cash.id, WIN);
  eq(bB.balance, TARGET_DOWN, 'B: qoldiq kamaydi');
  eq(sB.in, s0.in, "B: kirim hamon O'ZGARMADI");
  eq(sB.out, s0.out, "B: chiqim hamon O'ZGARMADI");
  eq(sB.adjustment, 4_000_000, 'B: ikki tuzatish yig\'indisi (+7M − 3M)');
  eq(sB.closing, bB.balance, "B: closing = karta qoldig'i");

  const downList = ((await journal('&source=BALANCE_ADJUSTMENT')).items ?? []).filter((r) => r.direction === 'OUT');
  ok(downList.length === 1, 'B: kamaytirish OUT qator sifatida yozildi');
  if (downList[0]) eq(downList[0].amount, 3_000_000, 'B: OUT qator summasi musbat saqlanadi (CHECK amount > 0)');

  // ══════════ C) aynan shu songa qayta saqlash — hech narsa yozilmaydi ══════════
  console.log('\n── C) o\'zgarishsiz saqlash ──');
  const rowsBeforeC = num((await journal()).total);
  const resC = await setBalance(cash.id, { balance: TARGET_DOWN }, 201);
  eq(resC.body?.delta, 0, 'C: farq nol');
  ok(resC.body?.transaction === null, 'C: yangi qator YOZILMADI');
  eq((await journal()).total, rowsBeforeC, 'C: jurnal uzunligi o\'zgarmadi');
  eq((await boxOf(cash.id)).balance, TARGET_DOWN, 'C: qoldiq joyida');

  // ══════════ D) qoidalar ══════════
  console.log('\n── D) qoidalar ──');
  await setBalance(cash.id, { balance: -1 }, 400);
  ok(true, 'D: manfiy qoldiq rad etildi (400)');
  await setBalance(cash.id, { balance: 1_000_000 }, 403, accountant);
  ok(true, 'D: buxgalter (ACCOUNTANT) tahrirlay olmaydi (403)');
  await setBalance(cash.id, { balance: 1_000_000 }, 403, cashier);
  ok(true, 'D: kassir (CASHIER) tahrirlay olmaydi (403)');
  await req('POST', `/kassa/cashboxes/${'0'.repeat(8)}-0000-0000-0000-000000000000/balance`, { balance: 1 }, 404);
  ok(true, 'D: mavjud bo\'lmagan kassa (404)');

  // storno qilinmaydi — teskari tuzatish kiritiladi
  const adjRow = ((await journal('&source=BALANCE_ADJUSTMENT')).items ?? [])[0];
  ok(!!adjRow, 'D: storno uchun tuzatish qatori topildi');
  if (adjRow) {
    await req('POST', `/kassa/transactions/${adjRow.id}/reverse`, { reason: 'test storno' }, 400);
    ok(true, 'D: tuzatishni storno qilib bo\'lmaydi (400)');
  }

  // rad etilgan chaqiruvlar hech narsani qimirlatmadi
  eq((await boxOf(cash.id)).balance, TARGET_DOWN, 'D: rad etilgan chaqiruvlar qoldiqni qimirlatmadi');
  const sD = await sumRow(cash.id, WIN);
  eq(sD.in, s0.in, 'D: kirim oxirigacha O\'ZGARMADI');
  eq(sD.out, s0.out, 'D: chiqim oxirigacha O\'ZGARMADI');

  // ══════════ E) minusga tushira olmaydi ══════════
  console.log('\n── E) minus qoidasi ──');
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'OUT', amount: 1_000_000, date: TODAY }, 201);
  const bE = num((await boxOf(cash.id)).balance);
  // qoldiqni 0 ga tushirish MUMKIN…
  await setBalance(cash.id, { balance: 0 }, 201);
  eq((await boxOf(cash.id)).balance, 0, 'E: qoldiqni nolga tushirish mumkin');
  // …lekin manfiyga emas (DTO darajasida rad etiladi)
  await setBalance(cash.id, { balance: -5 }, 400);
  ok(true, 'E: manfiy maqsad rad etildi');
  eq((await boxOf(cash.id)).balance, 0, 'E: qoldiq nolda qoldi');
  ok(bE > 0, 'E: fon tekshiruvi — kassada pul bor edi');

  // nol qoldiqda ham kirim/chiqim hamon tegilmagan
  const sE = await sumRow(cash.id, WIN);
  eq(sE.in, s0.in, "E: kirim hamon O'ZGARMADI");
  eq(sE.closing, 0, 'E: closing = 0');

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
  process.exit(0);
};

main().catch((e) => { console.error('kassa-balance-edit E2E crashed:', e); process.exit(1); });
