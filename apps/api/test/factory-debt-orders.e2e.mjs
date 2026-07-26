// Zavodlarga qarzimiz — BUYURTMA darajasida, naqd / o'tkazma / aniq emas bo'yicha. E2E.
//
// Egasining 2026-07-26 dagi qoidalari:
//   D1  «Zavodlarga qarzimiz» kartasi = ochiq buyurtmalar yig'indisi (GROSS), ya'ni
//       naqd + o'tkazma + aniqlanmagan; karta bosilganda ochiladigan ro'yxat AYNAN
//       shu raqamga jamlanadi
//   D2  naqd va o'tkazma alohida kartalar; «to'lov usuli aniq emas» buyurtmalar
//       alohida karta olmaydi — ular asosiy «Zavodlarga qarzimiz» ichida qoladi
//   D3  har bir ochiq buyurtma ALOHIDA qator: /debts/factory-orders, usul bo'yicha
//       filtr, zavod bo'yicha filtr, qidiruv, server tomonidan hisoblangan yakun
//   D4  qatordan to'g'ridan-to'g'ri to'lash mumkin: to'lov O'SHA buyurtmaga
//       taqsimlanadi (avansga tushmaydi) va qator ro'yxatdan chiqadi
//   D5  usulni ro'yxatning o'zidan o'zgartirish qarzni bir kanaldan ikkinchisiga ko'chiradi
//   D6  AGENT bu ro'yxatni umuman ko'ra olmaydi (har qator zavod tannarxini ochadi)
//
// Ishga tushirish:
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/factory-debt-orders.e2e.mjs

const BASE = process.env.API_URL ?? 'http://localhost:4100/api';
const U = Date.now().toString(36).slice(-6);

let pass = 0;
const fails = [];
const ok = (cond, label) => {
  if (cond) pass++;
  else fails.push(label);
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
};
const num = (v) => Number(v ?? 0);
const near = (a, b, eps = 1) => Math.abs(num(a) - num(b)) <= eps;
const eq = (actual, expected, label) =>
  ok(near(actual, expected), `${label} — kutilgan ${expected}, keldi ${actual}`);

async function req(method, path, body, token, expect) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (expect !== undefined && res.status !== expect) {
    fails.push(`${method} ${path} → ${res.status} (kutilgan ${expect}): ${text.slice(0, 300)}`);
    console.log(` FAIL  ${method} ${path} → ${res.status}, kutilgan ${expect}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: parsed };
}

const main = async () => {
  const login = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, undefined, 201);
  const admin = login.body?.accessToken;
  ok(!!admin, 'admin login');
  if (!admin) return;

  const factories = (await req('GET', '/factories?pageSize=50', undefined, admin, 200)).body;
  const factory = (factories.items ?? factories).find((f) => f.name.includes('CAOLS'));
  ok(!!factory, 'seed zavodi topildi');

  const products = (await req('GET', '/products?pageSize=50', undefined, admin, 200)).body;
  const product = (products.items ?? products).find((p) => p.name.includes('600x300x200'));
  ok(!!product, 'seed mahsuloti topildi');

  const boxes = (await req('GET', '/kassa/cashboxes', undefined, admin, 200)).body;
  const list = boxes.items ?? boxes;
  const cashBox = list.find((b) => b.type === 'CASH' && b.currency === 'UZS');
  const bankBox = list.find((b) => b.type === 'BANK');
  ok(!!cashBox && !!bankBox, 'naqd va bank kassalari topildi');

  for (const box of [cashBox, bankBox]) {
    await req('POST', '/kassa/manual', {
      cashboxId: box.id, direction: 'IN', amount: 500_000_000, date: '2026-07-26',
      note: 'test kapital',
    }, admin, 201);
  }

  const client = (await req('POST', '/clients', { name: `Qarz Doska ${U}` }, admin, 201)).body;
  ok(!!client?.id, 'mijoz yaratildi');

  const mkOrder = async (intent, m3) =>
    (await req('POST', '/orders', {
      clientId: client.id, date: '2026-07-26',
      factoryPayIntent: intent,
      oneTimeVehicle: { name: `Doska truck ${U}-${intent}`, plate: `DK${U}${intent[0]}`, driver: 'Test' },
      transportMode: 'CLIENT_OWN',
      items: [{ productId: product.id, quantityM3: m3, palletCount: 10, salePricePerM3: 800_000 }],
    }, admin, 201)).body;

  const summary = () => req('GET', '/debts/summary', undefined, admin, 200).then((r) => r.body);
  const board = (qs = '') =>
    req('GET', `/debts/factory-orders${qs}`, undefined, admin, 200).then((r) => r.body);

  const before = await summary();
  const baseCash = num(before.factoryPayableCash);
  const baseBank = num(before.factoryPayableBank);
  const baseUnknown = num(before.factoryPayableUnknown);
  const baseOrders = num(before.factoryPayableOrders);

  // ═══════════════ D1/D2 — uch kanal, uch buyurtma ═══════════════
  console.log('\n── D1/D2: naqd 10 m³ · o\'tkazma 20 m³ · aniq emas 30 m³ ──');

  // seed narxlari: naqd 600k, bank 625k
  const oCash = await mkOrder('CASH', 10); // 10 × 600k = 6.0 mln
  const oBank = await mkOrder('BANK', 20); // 20 × 625k = 12.5 mln
  const oUnk = await mkOrder('UNKNOWN', 30); // UNKNOWN → bank bazasi: 30 × 625k = 18.75 mln
  ok(!!oCash?.id && !!oBank?.id && !!oUnk?.id, 'uchala buyurtma yaratildi');

  const costCash = num(oCash.costTotal);
  const costBank = num(oBank.costTotal);
  const costUnk = num(oUnk.costTotal);
  eq(costCash, 6_000_000, 'naqd niyatli buyurtma tannarxi zavod NAQD narxida');
  eq(costBank, 12_500_000, "o'tkazma niyatli buyurtma tannarxi zavod O'TKAZMA narxida");

  const s1 = await summary();
  eq(num(s1.factoryPayableCash) - baseCash, costCash, 'D2: naqd kartasi shu buyurtmaga o\'sdi');
  eq(num(s1.factoryPayableBank) - baseBank, costBank, "D2: o'tkazma kartasi shu buyurtmaga o'sdi");
  eq(num(s1.factoryPayableUnknown) - baseUnknown, costUnk, 'D2: aniqlanmagan asosiy kartada qoldi');
  eq(
    num(s1.factoryPayableOrders),
    num(s1.factoryPayableCash) + num(s1.factoryPayableBank) + num(s1.factoryPayableUnknown),
    'D1: asosiy karta = naqd + o\'tkazma + aniqlanmagan',
  );
  eq(num(s1.factoryPayableOrders) - baseOrders, costCash + costBank + costUnk, 'D1: o\'sish = uch buyurtma');

  // ═══════════════ D3 — doska: qator, filtr, yakun ═══════════════
  console.log('\n── D3: /debts/factory-orders ──');

  const all = await board('?pageSize=200');
  const ids = new Set((all.items ?? []).map((r) => r.id));
  ok(ids.has(oCash.id) && ids.has(oBank.id) && ids.has(oUnk.id), 'D3: uchala buyurtma ro\'yxatda');
  eq(num(all.totals.open), num(s1.factoryPayableOrders), 'D3: doska yakuni = kartaning raqami');
  eq(num(all.totals.cash), num(s1.factoryPayableCash), 'D3: doskadagi naqd = kartadagi naqd');
  eq(num(all.totals.bank), num(s1.factoryPayableBank), "D3: doskadagi o'tkazma = kartadagi o'tkazma");
  eq(num(all.totals.unknown), num(s1.factoryPayableUnknown), 'D3: doskadagi aniqlanmagan = kartadagi');

  const row = (all.items ?? []).find((r) => r.id === oCash.id);
  ok(!!row, 'D3: naqd buyurtma qatori topildi');
  eq(row.open, costCash, 'D3: qatordagi qoldiq = tannarx (hali to\'lanmagan)');
  eq(row.factoryPaid, 0, "D3: qatordagi to'langan = 0");
  ok(row.factoryPayIntent === 'CASH', 'D3: qatorda to\'lov usuli ko\'rinadi');
  ok(!!row.factory?.name && !!row.client?.name, 'D3: qatorda zavod va mijoz nomi bor');

  const onlyCash = await board('?intent=CASH&pageSize=200');
  ok(
    (onlyCash.items ?? []).every((r) => r.factoryPayIntent === 'CASH'),
    'D3: usul filtri faqat naqdlarni qoldiradi',
  );
  eq(num(onlyCash.totals.open), num(all.totals.open), 'D3: yakun chizig\'i usul filtridan O\'ZGARMAYDI (qamrovi boshqa)');
  ok(num(onlyCash.filtered.open) <= num(onlyCash.totals.open), 'D3: `filtered` — jadvaldagi qisqargan qamrov');
  eq(num(onlyCash.filtered.open), num(all.totals.cash), 'D3: `filtered.open` = naqd yig\'indisi');

  const byFactory = await board(`?factoryId=${factory.id}&pageSize=200`);
  ok(
    (byFactory.items ?? []).every((r) => r.factory.id === factory.id),
    'D3: zavod filtri faqat shu zavodni qoldiradi',
  );

  const searched = await board(`?search=${encodeURIComponent(oBank.orderNo)}&pageSize=200`);
  ok(
    (searched.items ?? []).length === 1 && searched.items[0].id === oBank.id,
    'D3: buyurtma raqami bo\'yicha qidiruv',
  );

  const bad = await req('GET', '/debts/factory-orders?nosuchparam=1', undefined, admin, 400);
  ok(bad.status === 400, 'D3: notanish filtr JIM emas — 400 qaytadi');

  // ═══════════════ D4 — qatordan to'g'ridan-to'g'ri to'lash ═══════════════
  console.log('\n── D4: qatordan to\'lash — pul avansga tushmaydi ──');

  const fBefore = (await req('GET', `/factories/${factory.id}`, undefined, admin, 200)).body;
  const advBefore = num(fBefore.advanceCash);

  await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: factory.id, method: 'CASH',
    cashboxId: cashBox.id, amount: costCash, date: '2026-07-26',
    allocations: [{ orderId: oCash.id, amount: String(costCash) }],
  }, admin, 201);

  const fAfter = (await req('GET', `/factories/${factory.id}`, undefined, admin, 200)).body;
  eq(num(fAfter.advanceCash), advBefore, 'D4: naqd avans QIMIRLAMADI — pul to\'g\'ri buyurtmaga ketdi');

  const afterPay = await board('?pageSize=200');
  ok(
    !(afterPay.items ?? []).some((r) => r.id === oCash.id),
    'D4: to\'liq to\'langan buyurtma doskadan chiqdi',
  );
  const s2 = await summary();
  eq(num(s2.factoryPayableCash) - baseCash, 0, 'D4: naqd kartasi to\'lovdan keyin qaytdi');
  eq(num(s2.factoryPayableOrders) - baseOrders, costBank + costUnk, 'D4: asosiy karta ham kamaydi');

  const detCash = (await req('GET', `/orders/${oCash.id}`, undefined, admin, 200)).body;
  eq(detCash.factoryOutstanding, 0, 'D4: buyurtma kartasi ham «qarz yo\'q» deydi');

  // qisman to'lov — qator qoladi, lekin qoldiq kamayadi
  const part = Math.round(costBank / 2);
  await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: factory.id, method: 'BANK',
    cashboxId: bankBox.id, amount: part, date: '2026-07-26',
    allocations: [{ orderId: oBank.id, amount: String(part) }],
  }, admin, 201);

  const partial = await board('?pageSize=200');
  const bankRow = (partial.items ?? []).find((r) => r.id === oBank.id);
  ok(!!bankRow, 'D4: qisman to\'langan buyurtma doskada QOLDI');
  eq(bankRow.factoryPaid, part, 'D4: qatorda to\'langani ko\'rinadi');
  eq(bankRow.open, costBank - part, 'D4: qoldiq = tannarx − to\'langani');
  const detBank = (await req('GET', `/orders/${oBank.id}`, undefined, admin, 200)).body;
  eq(bankRow.open, detBank.factoryOutstanding, 'D4: doska qatori va buyurtma kartasi BIR XIL raqamni aytadi');

  // ═══════ D4b — «aniq emas» buyurtma: qarz HAR KANALDA BOSHQACHA ═══════
  // UI shu sababli kanalni OCHIQ so'raydi: doskadagi «Qolgan qarz» o'tkazma bazasida
  // yozilgan, naqd bilan to'lasa server ANIQ boshqa (kichikroq) shiftni qo'yadi.
  console.log("\n── D4b: «aniq emas» buyurtmani naqd bilan to'lash ──");

  const oMix = await mkOrder('UNKNOWN', 12); // bank bazasi: 12 × 625k = 7.5 mln
  const detMix = (await req('GET', `/orders/${oMix.id}`, undefined, admin, 200)).body;
  const remCash = num(detMix.factoryCoverage?.remainingCash);
  const remBank = num(detMix.factoryCoverage?.remainingBank);
  eq(remBank, 7_500_000, 'D4b: o\'tkazma kanalidagi qoldiq');
  eq(remCash, 7_200_000, 'D4b: naqd kanalidagi qoldiq — BOSHQA raqam (12×600k)');

  const mixRow = ((await board('?pageSize=200')).items ?? []).find((r) => r.id === oMix.id);
  eq(mixRow.open, remBank, 'D4b: doska ustuni o\'tkazma bazasidagi qoldiqni ko\'rsatadi');

  // doskadagi raqamni NAQD bilan yuborish — server rad etadi (UI aynan shundan saqlaydi)
  await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: factory.id, method: 'CASH',
    cashboxId: cashBox.id, amount: remBank, date: '2026-07-26',
    allocations: [{ orderId: oMix.id, amount: String(remBank) }],
  }, admin, 400);
  ok(true, "D4b: o'tkazma summasini naqd bilan yopishga urinish 400 qaytardi");

  // kanal tanlanib, o'sha kanalning ANIQ summasi yuborilsa — yopiladi
  await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: factory.id, method: 'CASH',
    cashboxId: cashBox.id, amount: remCash, date: '2026-07-26',
    allocations: [{ orderId: oMix.id, amount: String(remCash) }],
  }, admin, 201);
  const detMix2 = (await req('GET', `/orders/${oMix.id}`, undefined, admin, 200)).body;
  ok(detMix2.factoryCoverage?.settled === true, 'D4b: naqd kanalining aniq summasi buyurtmani yopdi');
  ok(
    !((await board('?pageSize=200')).items ?? []).some((r) => r.id === oMix.id),
    'D4b: yopilgan «aniq emas» buyurtma doskadan chiqdi',
  );

  // ═══════════════ D5 — usulni doskaning o'zidan o'zgartirish ═══════════════
  console.log('\n── D5: «aniq emas» → o\'tkazma ──');

  const s3 = await summary();
  const unkBefore = num(s3.factoryPayableUnknown);
  const bankBefore = num(s3.factoryPayableBank);

  await req('PATCH', `/orders/${oUnk.id}/factory-pay-intent`, { factoryPayIntent: 'BANK' }, admin, 200);

  const s4 = await summary();
  const detUnk = (await req('GET', `/orders/${oUnk.id}`, undefined, admin, 200)).body;
  eq(num(s4.factoryPayableUnknown), unkBefore - costUnk, 'D5: aniqlanmagan uyum kamaydi');
  eq(
    num(s4.factoryPayableBank) - bankBefore,
    num(detUnk.factoryOutstanding),
    "D5: o'tkazma uyumi o'sha qarzga o'sdi",
  );
  eq(
    num(s4.factoryPayableOrders),
    num(s4.factoryPayableCash) + num(s4.factoryPayableBank) + num(s4.factoryPayableUnknown),
    'D5: uch kanal yig\'indisi hamon asosiy kartaga teng',
  );

  const afterIntent = await board('?intent=UNKNOWN&pageSize=200');
  ok(
    !(afterIntent.items ?? []).some((r) => r.id === oUnk.id),
    'D5: buyurtma «aniq emas» ro\'yxatidan chiqdi',
  );

  // ═══════════════ D6 — AGENT ko'ra olmaydi ═══════════════
  console.log('\n── D6: rol chegarasi ──');
  // seed demo agenti (SEED_DEMO_USERS bilan yaratiladi) — «jamol / agent123»
  const agentLogin = await req('POST', '/auth/login', { username: 'jamol', password: 'agent123' });
  if (agentLogin.status === 201 && agentLogin.body?.accessToken) {
    const agentTok = agentLogin.body.accessToken;
    await req('GET', '/debts/factory-orders', undefined, agentTok, 403);
    ok(true, "D6: AGENT zavod qarzi ro'yxatiga 403 oldi");
    // aynan shu sabab: /debts/summary ham AGENT'ga yopiq (u zavod tannarxini oshkor qiladi)
    await req('GET', '/debts/summary', undefined, agentTok, 403);
    ok(true, "D6: AGENT /debts/summary ga ham 403 oldi");
  } else {
    ok(false, 'D6: agent foydalanuvchisi (jamol) topilmadi — rol chegarasi TEKSHIRILMADI');
  }
  await req('GET', '/debts/factory-orders', undefined, undefined, 401);
  ok(true, 'D6: tokensiz so\'rov 401');

  // ═══════════════ Invariant ═══════════════
  console.log('\n── Invariant ──');
  const sFin = await summary();
  const boardFin = await board('?pageSize=200');
  eq(num(boardFin.totals.open), num(sFin.factoryPayableOrders), 'INVARIANT: doska yakuni = karta raqami');
  eq(num(boardFin.totals.count), (boardFin.items ?? []).length, 'INVARIANT: yakundagi son = qatorlar soni');
  eq(
    num(sFin.factoryPayableUnlinked),
    num(sFin.factoryPayableOpen) - num(sFin.factoryPayableOrders),
    'INVARIANT: bog\'lanmagan = daftar qarzi − buyurtmalar yig\'indisi',
  );

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) {
    console.log('\nXATOLAR:');
    for (const f of fails) console.log('  · ' + f);
  }
  process.exit(fails.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
