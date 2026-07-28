// BUYURTMA SANASINI TAHRIRLASH — `PATCH /orders/:id/admin { date }` (egasi so'rovi, 2026-07-28).
//
// Qoida: sana kalendar tuzatishi, narx qarori EMAS. Shuning uchun:
//   • buyurtmaning o'zi va `dueDate` (mijozning to'lov muddati) yangi sanaga ko'chadi;
//   • buyurtmadan TUG'ILGAN qatorlar — mijoz savdo qarzi (ORDER_SALE), zavod tannarxi
//     (ORDER_COST + COST_ADJUSTMENT), shofyor xarajati (TRANSPORT_COST) va poddon
//     yetkazib berish harakatlari — o'sha kunga BIRGA ko'chadi;
//   • PUL qatorlari (PAYMENT) o'z sanasida QOLADI — pul haqiqatda o'sha kuni qimirlagan;
//   • summalar (savdo, tannarx, transport) QIMIRLAMAYDI — narx kitobi yangi sanada
//     boshqacha bo'lsa ham buyurtma o'z narxlarida qoladi.
//
// Nega test kerak: sana faqat `Order.date` da o'zgarsa, buyurtma bir oyda, uning qarzi
// boshqa oyda ko'rinib qolardi — jimgina, chunki ikkala raqam ham alohida-alohida to'g'ri
// bo'lib turaveradi. Bu test aynan shu ajralishni qo'riqlaydi.
//
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (bir marta)
//   cd apps/api
//   DATABASE_URL=...smartblok_test npx prisma migrate deploy && npx tsx prisma/seed.ts
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/order-date-edit.e2e.mjs

const BASE = process.env.API_URL ?? 'http://localhost:4100/api';
const U = Date.now().toString(36).slice(-6);
let pass = 0;
const fails = [];
const num = (v) => Number(v ?? 0);
const ok = (c, l) => { if (c) pass++; else fails.push(l); console.log(`${c ? '  ok  ' : ' FAIL '} ${l}`); };
const eq = (a, e, l) => ok(Math.abs(num(a) - num(e)) <= 1, `${l} — kutilgan ${e}, keldi ${a}`);
/** ISO sanani YYYY-MM-DD ga keltiradi (server UTC yarim tunda saqlaydi) */
const day = (v) => (v ? String(v).slice(0, 10) : null);
const eqDay = (a, e, l) => ok(day(a) === e, `${l} — kutilgan ${e}, keldi ${day(a)}`);

let admin;
let agent;

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

const OLD_DATE = '2026-05-10';
const NEW_DATE = '2026-07-15';
const PAY_DATE = '2026-06-20';

/** bitta tarafning ledger hisobvarag'i (sana + manba bo'yicha o'qish uchun) */
const statement = async (account, partyId) =>
  ((await req('GET', `/debts/statement?account=${account}&partyId=${partyId}`, undefined, 200)).body?.entries ?? []);
const rowsOf = (entries, source) => entries.filter((e) => e.source === source && !e.reversalOfId);
const datesOf = (entries, source) => [...new Set(rowsOf(entries, source).map((e) => day(e.date)))];

const main = async () => {
  admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 201, null)).body?.accessToken;
  ok(!!admin, 'admin login');

  // ── setup: zavod + mahsulot + narxlar + kassa + mijoz (10 kunlik to'lov muddati) ──
  const factory = (await req('POST', '/factories', { name: `Sana zavod ${U}` }, 201)).body;
  const product = (await req('POST', '/products', {
    factoryId: factory.id, name: `Blok ${U}`, m3PerPallet: 1.728,
    priceFactoryCash: 600000, priceFactoryBank: 625000, pricesEffectiveFrom: '2026-01-01',
  }, 201)).body;
  for (const [kind, price] of [['FACTORY_CASH', 600000], ['FACTORY_BANK', 625000], ['DEALER_SALE', 750000]])
    await req('POST', `/products/${product.id}/prices`, { kind, pricePerM3: price, effectiveFrom: '2026-01-01' }, 201);

  const boxes = (await req('GET', '/kassa/cashboxes')).body;
  const cash = (boxes.items ?? boxes).find((b) => b.type === 'CASH' && b.currency === 'UZS');
  const bank = (boxes.items ?? boxes).find((b) => b.type === 'BANK' && b.currency === 'UZS');
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'IN', amount: 500_000_000, date: OLD_DATE, note: 'kapital' }, 201);
  await req('POST', '/kassa/manual', { cashboxId: bank.id, direction: 'IN', amount: 500_000_000, date: OLD_DATE, note: 'kapital' }, 201);

  const client = (await req('POST', '/clients', { name: `Sana mijoz ${U}`, paymentTermDays: 10 }, 201)).body;

  // ── buyurtma: 32 m³ × 750 000 = 24 000 000, transport DILLER zimmasida (shofyor qarzi
  //    yozilsin), 19 poddon (poddon harakati yozilsin), zavodga o'tkazma bilan ──
  const order = (await req('POST', '/orders', {
    clientId: client.id, date: OLD_DATE, factoryPayIntent: 'BANK',
    oneTimeVehicle: { name: `Moshina ${U}`, plate: `SD${U}` },
    transportMode: 'DEALER_ABSORBED', transportCost: 1_500_000,
    items: [{ productId: product.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
  }, 201)).body;
  ok(!!order?.id, 'buyurtma yaratildi');
  const vehicleId = order.vehicle?.id;
  ok(!!vehicleId, 'moshina biriktirildi');

  const SALE = 24_000_000;
  const COST = num(order.costTotal);
  eq(order.saleTotal, SALE, 'savdo summasi 32 × 750 000');

  // ── mijoz puli BOSHQA kunda: PAYMENT qatori o'z sanasida qolishi kerak ──
  await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: client.id, method: 'CASH', cashboxId: cash.id,
    amount: 10_000_000, date: PAY_DATE,
  }, 201);

  // ── Zavodga NAQD to'lov: buyurtma o'tkazma bazasida yozilgan (625 000), naqd narx esa
  //    600 000 — shuning uchun hisob-kitob tannarxni siljitadi va COST_ADJUSTMENT qatori
  //    tug'iladi. AYNAN u buyurtma sanasida yoziladi, demak sana bilan birga ko'chishi shart:
  //    aks holda tannarx bir oyda, uning tuzatmasi boshqasida qolib ketardi.
  const COST_CASH = 32 * 600_000;
  ok(Math.abs(COST - 32 * 625_000) <= 1, "tannarx o'tkazma bazasida yozilgan (625 000)");
  await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: factory.id, method: 'CASH', cashboxId: cash.id,
    amount: COST_CASH, date: PAY_DATE,
    allocations: [{ orderId: order.id, amount: String(COST_CASH) }],
  }, 201);

  const before = (await req('GET', `/orders/${order.id}`, undefined, 200)).body;
  const saleBefore = num(before.saleTotal);
  const costBefore = num(before.costTotal);
  const transportBefore = num(before.transportCost);

  /** dashboard davr savdosi — ko'chirish uni bir oydan ikkinchisiga olib o'tishi kerak */
  const periodSales = async (from, to) =>
    num((await req('GET', `/dashboard/summary?from=${from}&to=${to}`, undefined, 200)).body?.period?.sales);
  const mayBefore = await periodSales('2026-05-01', '2026-05-31');
  const julBefore = await periodSales('2026-07-01', '2026-07-31');

  console.log('\n── 0) ko\'chirishdan OLDIN: hamma narsa eski sanada ──');
  eqDay(before.date, OLD_DATE, '0: buyurtma sanasi');
  eqDay(before.dueDate, '2026-05-20', '0: to\'lov muddati = sana + 10 kun');

  const cliBefore = await statement('CLIENT', client.id);
  ok(datesOf(cliBefore, 'ORDER_SALE').join() === OLD_DATE, `0: ORDER_SALE ${OLD_DATE} da`);
  ok(datesOf(cliBefore, 'PAYMENT').join() === PAY_DATE, `0: to'lov ${PAY_DATE} da`);
  const facBefore = await statement('FACTORY', factory.id);
  ok(datesOf(facBefore, 'ORDER_COST').join() === OLD_DATE, `0: ORDER_COST ${OLD_DATE} da`);
  ok(datesOf(facBefore, 'COST_ADJUSTMENT').join() === OLD_DATE, `0: COST_ADJUSTMENT ${OLD_DATE} da`);
  const vehBefore = await statement('VEHICLE', vehicleId);
  ok(datesOf(vehBefore, 'TRANSPORT_COST').join() === OLD_DATE, `0: TRANSPORT_COST ${OLD_DATE} da`);

  // ═════════════ SANANI KO'CHIRAMIZ ═════════════
  console.log(`\n── 1) sana ${OLD_DATE} → ${NEW_DATE} ──`);
  const patched = (await req('PATCH', `/orders/${order.id}/admin`, { date: NEW_DATE }, 200)).body;
  eqDay(patched.date, NEW_DATE, '1: buyurtma yangi sanada');
  eqDay(patched.dueDate, '2026-07-25', '1: to\'lov muddati YANGI sanadan qayta hisoblandi');

  console.log('\n── 2) summalar QIMIRLAMADI (sana narx qarori emas) ──');
  eq(patched.saleTotal, saleBefore, '2: savdo summasi o\'zgarmadi');
  eq(patched.costTotal, costBefore, '2: zavod tannarxi o\'zgarmadi');
  eq(patched.transportCost, transportBefore, '2: transport xarajati o\'zgarmadi');

  console.log('\n── 3) buyurtmadan tug\'ilgan qatorlar BIRGA ko\'chdi ──');
  const cliAfter = await statement('CLIENT', client.id);
  ok(datesOf(cliAfter, 'ORDER_SALE').join() === NEW_DATE, `3: ORDER_SALE ${NEW_DATE} ga ko'chdi`);
  const facAfter = await statement('FACTORY', factory.id);
  ok(datesOf(facAfter, 'ORDER_COST').join() === NEW_DATE, `3: ORDER_COST ${NEW_DATE} ga ko'chdi`);
  ok(
    datesOf(facAfter, 'COST_ADJUSTMENT').join() === NEW_DATE,
    `3: COST_ADJUSTMENT ham ko'chdi (tannarx va uning tuzatmasi bir davrda)`,
  );
  const vehAfter = await statement('VEHICLE', vehicleId);
  ok(datesOf(vehAfter, 'TRANSPORT_COST').join() === NEW_DATE, `3: TRANSPORT_COST ${NEW_DATE} ga ko'chdi`);

  console.log('\n── 4) PUL qatori o\'z sanasida QOLDI ──');
  ok(
    datesOf(cliAfter, 'PAYMENT').join() === PAY_DATE,
    `4: mijoz to'lovi hamon ${PAY_DATE} da — pul o'sha kuni qimirlagan`,
  );
  ok(
    datesOf(facAfter, 'PAYMENT').join() === PAY_DATE,
    `4: zavod to'lovi ham ${PAY_DATE} da qoldi`,
  );

  console.log('\n── 5) poddon harakatlari ham ko\'chdi ──');
  const palletDates = (q) =>
    req('GET', `/pallets/transactions?pageSize=100&${q}`, undefined, 200).then((r) =>
      (r.body?.items ?? r.body ?? [])
        .filter((t) => t.order?.id === order.id || t.orderId === order.id)
        .map((t) => day(t.date)),
    );
  const cliPallets = await palletDates(`clientId=${client.id}`);
  const facPallets = await palletDates(`factoryId=${factory.id}`);
  ok(cliPallets.length > 0 && cliPallets.every((d) => d === NEW_DATE), `5: mijozga yetkazilgan poddon ${NEW_DATE} da`);
  ok(facPallets.length > 0 && facPallets.every((d) => d === NEW_DATE), `5: zavoddan olingan poddon ${NEW_DATE} da`);

  console.log('\n── 6) davr hisobotlari: buyurtma ESKI oyda YO\'Q, YANGI oyda BOR ──');
  const inRange = async (from, to) => {
    const r = (await req('GET', `/orders?clientId=${client.id}&pageSize=100&dateFrom=${from}&dateTo=${to}`, undefined, 200)).body;
    return (r.items ?? []).some((o) => o.id === order.id);
  };
  ok(!(await inRange('2026-05-01', '2026-05-31')), '6: may oyida topilmaydi');
  ok(await inRange('2026-07-01', '2026-07-31'), '6: iyul oyida topiladi');
  eq(mayBefore - (await periodSales('2026-05-01', '2026-05-31')), SALE, '6: dashboard may davri shu savdoga kamaydi');
  eq((await periodSales('2026-07-01', '2026-07-31')) - julBefore, SALE, '6: iyul davri esa xuddi shunga oshdi');

  console.log('\n── 7) balanslar QIMIRLAMADI (ko\'chirish pul harakati emas) ──');
  const cli = (await req('GET', `/clients/${client.id}`, undefined, 200)).body;
  eq(cli.balance, SALE - 10_000_000, '7: mijoz balansi o\'sha-o\'sha');
  const closing = (await req('GET', `/debts/statement?account=FACTORY&partyId=${factory.id}`, undefined, 200)).body;
  ok(closing?.entries?.length > 0, '7: zavod hisobvarag\'i o\'qiladi');

  console.log('\n── 8) chegara holatlari ──');
  // bir xil sana → hech narsa buzilmaydi (idempotent)
  const same = (await req('PATCH', `/orders/${order.id}/admin`, { date: NEW_DATE }, 200)).body;
  eqDay(same.date, NEW_DATE, '8: bir xil sana qayta yuborilsa ham sana o\'sha');
  eq(same.saleTotal, saleBefore, '8: takroriy saqlashda summa ham o\'zgarmadi');
  // sanasiz patch eski xatti-harakatni buzmaydi
  const noteOnly = (await req('PATCH', `/orders/${order.id}/admin`, { note: 'sanasiz tahrir' }, 200)).body;
  eqDay(noteOnly.date, NEW_DATE, '8: sanasiz patch sanani QIMIRLATMAYDI');
  ok(noteOnly.note === 'sanasiz tahrir', '8: izoh saqlandi');
  // noto'g'ri sana → 400
  await req('PATCH', `/orders/${order.id}/admin`, { date: 'kecha' }, 400);
  ok(true, '8: noto\'g\'ri sana 400 bilan rad etiladi');
  // AGENT bu eshikni ocholmaydi (ADMIN-only)
  agent = (await req('POST', '/auth/login', { username: 'jamol', password: 'agent123' }, undefined, null)).body?.accessToken;
  if (agent) {
    await req('PATCH', `/orders/${order.id}/admin`, { date: '2026-08-01' }, 403, agent);
    ok(true, '8: AGENT sanani tahrirlay olmaydi (403)');
  } else {
    console.log('  --   AGENT demo foydalanuvchisi yo\'q — 403 tekshiruvi o\'tkazib yuborildi');
  }

  console.log('\n── 9) bekor qilingan buyurtmaning sanasi tahrirlanmaydi ──');
  await req('DELETE', `/orders/${order.id}`, { reason: 'test — sana tekshiruvi', mode: 'VOID_ALL' }, 200);
  await req('PATCH', `/orders/${order.id}/admin`, { date: '2026-08-01' }, 400);
  ok(true, '9: bekor qilingan buyurtmada 400');

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) {
    console.log('\nFAILS:');
    for (const f of fails) console.log(' · ' + f);
    process.exit(1);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
