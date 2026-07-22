// Zavod avansi + naqd/o'tkazma aralash tannarx + poddon (faqat son) — E2E.
//
// Egasining 2026-07-21 dagi qoidalari:
//   R1  buyurtmada 3 ta tanlov (naqd / o'tkazma / aniq emas); «aniq emas» ikkala narxni
//       ko'rsatadi va buyurtma ARALASH yopilishi mumkin
//   R2  zavoddagi avans buyurtma qarzini O'ZI yopmaydi — faqat «avansdan yechish» bosilganda
//   R3  avans naqd/bank bo'yicha AJRATIB ko'rsatiladi; qaysi cho'ntakdan yechilsa, o'sha narx
//   R4  poddon faqat SONDA — zavod tomonida hech qanday pul yo'q
//   R5  har bir amalni bekor qilish mumkin, zanjir buzilmaydi
//
// Ishga tushirish:
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (bir marta)
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx prisma migrate deploy
//   DATABASE_URL=...smartblok_test npx tsx prisma/seed.ts
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/factory-advance.e2e.mjs

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
  // ── kirish ──
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

  // kassalarni to'ldiramiz (zavodga to'lov chiqim qiladi)
  for (const box of [cashBox, bankBox]) {
    await req('POST', '/kassa/manual', {
      cashboxId: box.id, direction: 'IN', amount: 500_000_000, date: '2026-07-21',
      note: 'test kapital',
    }, admin, 201);
  }

  const client = (await req('POST', '/clients', { name: `Avans Test ${U}` }, admin, 201)).body;
  ok(!!client?.id, 'mijoz yaratildi');

  const advanceOf = async () => {
    const f = (await req('GET', `/factories/${factory.id}`, undefined, admin, 200)).body;
    return f;
  };

  // ═══════════════ R3 — avans ikki kanalga ajraladi ═══════════════
  console.log('\n── R3: zavodga naqd 10 mln + o\'tkazma 20 mln ──');

  const payCash = (await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: factory.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 10_000_000, date: '2026-07-21',
  }, admin, 201)).body;
  const payBank = (await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: factory.id, method: 'BANK',
    cashboxId: bankBox.id, amount: 20_000_000, date: '2026-07-21',
  }, admin, 201)).body;
  ok(!!payCash?.id && !!payBank?.id, 'ikkala zavod to\'lovi yaratildi');

  let f = await advanceOf();
  eq(f.advanceCash, 10_000_000, 'R3: naqd avans');
  eq(f.advanceBank, 20_000_000, 'R3: bank avans');
  eq(f.advanceTotal, 30_000_000, 'R3: jami avans');
  const payableBefore = num(f.payable);

  // ═══════════════ R1 — «aniq emas» buyurtma, ikki narx ═══════════════
  console.log('\n── R1: «to\'lov usuli aniq emas» buyurtma ──');

  // 32 m³ → naqd 600k = 19.2 mln, bank 625k = 20.0 mln
  const order = (await req('POST', '/orders', {
    clientId: client.id, date: '2026-07-21',
    factoryPayIntent: 'UNKNOWN',
    oneTimeVehicle: { name: `Avans truck ${U}`, plate: `AV${U}`, driver: 'Test' },
    transportMode: 'CLIENT_OWN',
    items: [{ productId: product.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750_000 }],
  }, admin, 201)).body;
  ok(!!order?.id, 'buyurtma yaratildi');
  ok(order.factoryPayIntent === 'UNKNOWN', 'R1: tanlov UNKNOWN saqlandi');

  let det = (await req('GET', `/orders/${order.id}`, undefined, admin, 200)).body;
  eq(det.costTotalCash, 19_200_000, 'R1: naqd bo\'yicha tannarx (32×600k)');
  eq(det.costTotalBank, 20_000_000, 'R1: bank bo\'yicha tannarx (32×625k)');

  // ═══════════════ R4 — poddon puli YO'Q ═══════════════
  console.log('\n── R4: poddon faqat sonda ──');
  eq(det.costTotal, 20_000_000, 'R4: tannarxda poddon puli yo\'q (19 poddon × 130k qo\'shilmadi)');

  // ═══════════════ R2 — avans avtomatik yechilmaydi ═══════════════
  console.log('\n── R2: yuklashdan keyin ham avans o\'z joyida ──');

  f = await advanceOf();
  eq(f.advanceCash, 10_000_000, 'R2: yuklashdan keyin naqd avans O\'ZGARMADI');
  eq(f.advanceBank, 20_000_000, 'R2: yuklashdan keyin bank avans O\'ZGARMADI');
  eq(num(f.payable), payableBefore - 20_000_000, 'R2: zavod qarzi ALOHIDA paydo bo\'ldi');

  det = (await req('GET', `/orders/${order.id}`, undefined, admin, 200)).body;
  eq(det.factoryOutstanding, 20_000_000, 'R2: buyurtma zavod qarzi to\'liq ochiq');

  // ═══════════════ R2/R3 — qisman yechish ═══════════════
  console.log('\n── R2/R3: naqd avansdan 5 mln yechamiz ──');

  const drawResp = (await req('POST', `/orders/${order.id}/factory-advance-draw`, {
    bucket: 'ADVANCE_CASH', amount: 5_000_000, date: '2026-07-21',
  }, admin, 201)).body;
  // the endpoint must return the REFRESHED card (not undefined) — the UI reads it to warn
  // on a short draw. A `return $transaction(...)` instead of `await` made this dead code once.
  ok(drawResp?.id === order.id && drawResp?.factoryCoverage != null, 'draw javobi yangilangan kartani qaytaradi');
  eq(drawResp?.factoryCoverage?.paidCash, 5_000_000, 'draw javobida naqd ulush ko\'rinadi');

  f = await advanceOf();
  eq(f.advanceCash, 5_000_000, 'R3: naqd avans 5 mln ga kamaydi');
  eq(f.advanceBank, 20_000_000, 'R3: bank avans TEGILMADI');

  det = (await req('GET', `/orders/${order.id}`, undefined, admin, 200)).body;
  ok(det.costStatus === 'PARTIAL', 'R1: buyurtma PARTIAL');
  // 5 mln naqd narxida 5/19.2 = 26.04% ni yopadi; qolgan 73.96% bank narxida
  // tannarx = 5 000 000 + 0.739583×20 000 000 = 19 791 666.67
  eq(det.costTotal, 19_791_666.67, 'R1: ARALASH tannarx (naqd ulush + bank qoldiq)');
  eq(det.factoryCoverage.paidCash, 5_000_000, 'R3: naqd bilan to\'langan');
  eq(det.factoryCoverage.paidBank, 0, 'R3: bank bilan hali to\'lanmagan');

  // ═══════════════ chegara — buyurtma pulidan ko'p yechib bo'lmaydi ═══════════════
  console.log('\n── Chegara: ortiqcha yechishga ruxsat yo\'q ──');
  await req('POST', `/orders/${order.id}/factory-advance-draw`, {
    bucket: 'ADVANCE_BANK', amount: 50_000_000,
  }, admin, 400);
  ok(true, 'R2: buyurtma summasidan ko\'p yechish 400 qaytardi');

  // ═══════════════ R1 — qolganini bank avansidan yopamiz ═══════════════
  console.log('\n── R1: qolganini bank avansidan yopamiz ──');
  const remainingBank = num(det.factoryCoverage.remainingBank);
  eq(remainingBank, 14_791_666.67, 'R1: bank narxida qolgan summa');

  await req('POST', `/orders/${order.id}/factory-advance-draw`, {
    bucket: 'ADVANCE_BANK',
  }, admin, 201); // summasiz = kerakligicha

  det = (await req('GET', `/orders/${order.id}`, undefined, admin, 200)).body;
  ok(det.costStatus === 'FINAL', 'R1: to\'liq yopilgach FINAL');
  eq(det.costTotal, 19_791_666.67, 'R1: yakuniy aralash tannarx o\'zgarmadi');
  eq(det.factoryOutstanding, 0, 'R1: buyurtma zavod oldida yopildi');

  f = await advanceOf();
  eq(f.advanceCash, 5_000_000, 'R3: naqd avansning qolgani joyida');
  eq(f.advanceBank, 20_000_000 - 14_791_666.67, 'R3: bank avansdan aynan kerakligi yechildi');

  // ═══════════════ R5 — bitta taqsimotni bekor qilish ═══════════════
  console.log('\n── R5: bitta yechishni bekor qilamiz ──');
  const pay = (await req('GET', `/payments/${payCash.id}`, undefined, admin, 200)).body;
  const alloc = (pay.allocations ?? []).find((a) => a.orderId === order.id && !a.voidedAt);
  ok(!!alloc, 'R5: naqd yechish taqsimoti topildi');

  await req('POST', `/payments/${payCash.id}/allocations/${alloc.id}/void`, {
    reason: 'test bekor qilish',
  }, admin, 201);

  f = await advanceOf();
  eq(f.advanceCash, 10_000_000, 'R5: naqd avans TO\'LIQ qaytdi');

  det = (await req('GET', `/orders/${order.id}`, undefined, admin, 200)).body;
  ok(det.costStatus === 'PARTIAL', 'R5: buyurtma yana PARTIAL');
  eq(det.factoryCoverage.paidCash, 0, 'R5: naqd ulush yo\'qoldi');

  // ═══════════════ R4 — zavodga poddon qaytarish pul harakatlantirmaydi ═══════════════
  console.log('\n── R4: poddon qaytarish puli yo\'q ──');
  await req('POST', '/pallets/client-return', {
    clientId: client.id, qty: 10, date: '2026-07-21',
  }, admin, 201);

  const beforeReturn = await advanceOf();
  await req('POST', '/pallets/factory-return', {
    factoryId: factory.id, qty: 10, date: '2026-07-21',
  }, admin, 201);
  const afterReturn = await advanceOf();

  eq(afterReturn.balance, beforeReturn.balance, 'R4: poddon qaytarish zavod balansini O\'ZGARTIRMADI');
  eq(afterReturn.advanceCash, beforeReturn.advanceCash, 'R4: naqd avans tegilmadi');
  eq(afterReturn.payable, beforeReturn.payable, 'R4: zavod qarzi tegilmadi');
  eq(afterReturn.palletsHeld, num(beforeReturn.palletsHeld) - 10, 'R4: poddon SONI 10 ga kamaydi');

  // ═══════════════ invariant — cho'ntaklar yig'indisi = balans ═══════════════
  // ═══════════════ REGRESSIYA — ko'rikda topilgan xatolar ═══════════════
  console.log('\n── Regressiya: faqat zavod to\'lovi taqsimoti alohida bekor qilinadi ──');
  // Mijoz to'lovi FIFO dvigatelining ixtiyorida — uni qo'lda bekor qilish buyurtmani
  // «to'lanmagan», mijoz daftarini esa «to'langan» qilib qo'yardi (keyin FIFO uni jimgina
  // qaytarardi). Shuning uchun bu yo'l faqat FACTORY_OUT uchun ochiq.
  const cin = (await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: client.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 1_000_000, date: '2026-07-21',
  }, admin, 201)).body;
  const cinAlloc = (cin.allocations ?? []).find((a) => !a.voidedAt);
  if (cinAlloc) {
    await req('POST', `/payments/${cin.id}/allocations/${cinAlloc.id}/void`, { reason: 'test' }, admin, 400);
    ok(true, "mijoz to'lovi taqsimotini alohida bekor qilish rad etildi (400)");
  } else {
    ok(true, "mijoz to'loviga taqsimot biriktirilmadi — tekshirish o'tkazib yuborildi");
  }

  console.log('\n── Regressiya: kanaldagi avansdan ko\'p sarflab bo\'lmaydi ──');
  const bAfter = await advanceOf();
  const overAsk = num(bAfter.advanceCash) + 5_000_000;
  await req('POST', `/orders/${order.id}/factory-advance-draw`, {
    bucket: 'ADVANCE_CASH', amount: overAsk,
  }, admin, 400);
  ok(true, 'kanalda yo\'q pulni yechishga urinish 400 qaytardi');

  console.log('\n── Invariant ──');
  f = await advanceOf();
  eq(num(f.payable) + num(f.advanceCash) + num(f.advanceBank), num(f.balance),
    'INVARIANT: qarz + naqd avans + bank avans = umumiy balans');

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) {
    console.log('\nXATOLAR:');
    for (const f2 of fails) console.log('  · ' + f2);
  }
  process.exit(fails.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
