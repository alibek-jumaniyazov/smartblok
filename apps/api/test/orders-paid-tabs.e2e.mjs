// Buyurtmalar sahifasining 3 TABI — `GET /orders?paid=paid|unpaid` (egasi qoidasi, 2026-07-22).
//
// Qoida: «barcha» / «to'langan» / «to'lanmagan», QISMAN to'langan «to'lanmagan»da turadi,
// bekor qilingan buyurtma ikkala tabdan ham chiqib ketadi. Filtr `clientOutstanding`
// (savdo summasi − shofyorga ketgan ulush − mijoz to'lagani) bo'yicha ishlaydi, ya'ni uni
// SQL where bilan yozib bo'lmaydi — shuning uchun bu yerda regressiya qo'riqchisi kerak.
//
// Alohida diqqat: MIJOZ PULI O'ZINI O'ZI FIFO bilan taqsimlaydi (eng eski buyurtmadan
// boshlab), shuning uchun bitta to'lov bir buyurtmani yopib, keyingisini qisman qoldiradi —
// aynan shu holat tabda to'g'ri bo'linishi kerak.
//
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (bir marta)
//   cd apps/api
//   DATABASE_URL=...smartblok_test npx prisma migrate deploy && npx tsx prisma/seed.ts
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/orders-paid-tabs.e2e.mjs

const BASE = process.env.API_URL ?? 'http://localhost:4100/api';
const U = Date.now().toString(36).slice(-6);
let pass = 0;
const fails = [];
const num = (v) => Number(v ?? 0);
const ok = (c, l) => { if (c) pass++; else fails.push(l); console.log(`${c ? '  ok  ' : ' FAIL '} ${l}`); };
const eq = (a, e, l) => ok(Math.abs(num(a) - num(e)) <= 1, `${l} — kutilgan ${e}, keldi ${a}`);
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

/** shu mijozning tabdagi buyurtma raqamlari (paginatsiyadan keyin ham to'liq bo'lsin). */
const tab = async (clientId, paid) => {
  const q = `/orders?clientId=${clientId}&pageSize=100${paid ? `&paid=${paid}` : ''}`;
  const r = (await req('GET', q, undefined, 200)).body;
  return { nos: (r.items ?? []).map((o) => o.orderNo).sort(), total: num(r.total) };
};

const main = async () => {
  admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 201)).body?.accessToken;
  ok(!!admin, 'admin login');

  const factory = (await req('POST', '/factories', { name: `Tab zavod ${U}` }, 201)).body;
  const product = (await req('POST', '/products', { factoryId: factory.id, name: `B ${U}`, m3PerPallet: 1.728 }, 201)).body;
  for (const [kind, price] of [['FACTORY_CASH', 600000], ['FACTORY_BANK', 625000], ['DEALER_SALE', 750000]])
    await req('POST', `/products/${product.id}/prices`, { kind, pricePerM3: price, effectiveFrom: '2026-07-01' }, 201);
  const boxes = (await req('GET', '/kassa/cashboxes')).body;
  const cash = (boxes.items ?? boxes).find((b) => b.type === 'CASH' && b.currency === 'UZS');
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'IN', amount: 500_000_000, date: '2026-07-22', note: 'kapital' }, 201);
  const client = (await req('POST', '/clients', { name: `Tab mijoz ${U}` }, 201)).body;

  // Har biri 24 000 000 so'mlik 4 ta buyurtma (32 m³ × 750 000). Sanalar FIFO tartibini
  // belgilaydi — to'lov eng eskisidan boshlab yopadi.
  const SALE = 24_000_000;
  const mk = async (date) =>
    (await req('POST', '/orders', {
      clientId: client.id, date, factoryPayIntent: 'BANK',
      oneTimeVehicle: { name: `Mo ${U}`, plate: `PT${U}${Math.random().toString(36).slice(2, 5)}` },
      transportMode: 'CLIENT_OWN',
      items: [{ productId: product.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
    }, 201)).body;

  const o1 = await mk('2026-07-01'); // to'liq to'lanadi
  const o2 = await mk('2026-07-02'); // qisman to'lanadi  ⇒ «to'lanmagan»
  const o3 = await mk('2026-07-03'); // umuman to'lanmaydi
  const o4 = await mk('2026-07-04'); // bekor qilinadi

  console.log('\n── 0) to\'lovdan oldin: hammasi «to\'lanmagan» ──');
  eq((await tab(client.id)).total, 4, '0: barcha tab — 4 buyurtma');
  eq((await tab(client.id, 'unpaid')).total, 4, "0: to'lanmagan — 4");
  eq((await tab(client.id, 'paid')).total, 0, "0: to'langan — 0");

  // ── FIFO: 30 000 000 = o1 ni to'liq (24M) + o2 ga 6M qoldiq ──
  console.log("\n── 1) 30 000 000 to'lov: FIFO bilan o1 yopiladi, o2 qisman qoladi ──");
  await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: client.id, method: 'CASH', cashboxId: cash.id,
    amount: 30_000_000, date: '2026-07-22',
  }, 201);

  const paid1 = await tab(client.id, 'paid');
  const unpaid1 = await tab(client.id, 'unpaid');
  eq(paid1.total, 1, "1: to'langan — faqat 1 ta");
  ok(paid1.nos.includes(o1.orderNo), `1: to'langan tabda o1 (${o1.orderNo}) bor`);
  eq(unpaid1.total, 3, "1: to'lanmagan — 3 ta");
  ok(unpaid1.nos.includes(o2.orderNo), "1: QISMAN to'langan o2 «to'lanmagan»da (egasi qoidasi)");
  ok(!paid1.nos.includes(o2.orderNo), "1: qisman to'langan o2 «to'langan»da YO'Q");
  ok(unpaid1.nos.includes(o3.orderNo) && unpaid1.nos.includes(o4.orderNo), "1: o3/o4 «to'lanmagan»da");

  // ── qoldiq ustidan to'lash: o2 ham yopiladi ──
  console.log('\n── 2) o2 ning qolgan 18 000 000 i to\'lanadi ──');
  await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: client.id, method: 'CASH', cashboxId: cash.id,
    amount: 18_000_000, date: '2026-07-22',
  }, 201);
  const paid2 = await tab(client.id, 'paid');
  eq(paid2.total, 2, "2: to'langan — 2 ta (o1 + o2)");
  ok(paid2.nos.includes(o2.orderNo), "2: to'liq yopilgan o2 endi «to'langan»da");
  eq((await tab(client.id, 'unpaid')).total, 2, "2: to'lanmagan — 2 ta (o3 + o4)");

  // ── bekor qilingan buyurtma IKKALA tabdan ham chiqadi ──
  console.log('\n── 3) o4 bekor qilinadi — ikkala tabdan ham chiqadi ──');
  await req('DELETE', `/orders/${o4.id}`, { reason: 'test — tab tekshiruvi' }, 200);
  const paid3 = await tab(client.id, 'paid');
  const unpaid3 = await tab(client.id, 'unpaid');
  ok(!paid3.nos.includes(o4.orderNo), "3: bekor qilingan o4 «to'langan»da YO'Q");
  ok(!unpaid3.nos.includes(o4.orderNo), "3: bekor qilingan o4 «to'lanmagan»da ham YO'Q");
  eq(unpaid3.total, 1, "3: to'lanmagan — faqat o3 qoldi");
  // «barcha» tab bekor qilinganni HAMON ko'rsatadi (tarix yo'qolmasin)
  ok((await tab(client.id)).nos.includes(o4.orderNo), "3: «barcha» tabda bekor qilingan o4 KO'RINADI");

  // ── bekor qilish mijozga kredit qoldirgani uchun o3 avtomatik yopilishi mumkin emas:
  //    o4 ning to'lovi yo'q edi, shuning uchun o3 hamon to'lanmagan bo'lib qoladi ──
  eq((await tab(client.id, 'paid')).total, 2, "3: to'langan hamon 2 ta");

  // ── paginatsiya id-to'plam bilan to'qnashmasin ──
  console.log('\n── 4) paginatsiya ──');
  const p1 = (await req('GET', `/orders?clientId=${client.id}&paid=paid&page=1&pageSize=1`, undefined, 200)).body;
  eq(num(p1.total), 2, '4: sahifalangan so\'rovda total butun to\'plamni aytadi');
  eq((p1.items ?? []).length, 1, '4: pageSize hurmat qilinadi');

  // ── `status` va `paid` birga berilsa: status JIMGINA TASHLANMASIN (kesishma bo'lsin) ──
  console.log("\n── 5) status + paid birgalikda ──");
  const withStatus = (await req('GET', `/orders?clientId=${client.id}&pageSize=100&paid=paid&status=COMPLETED`, undefined, 200)).body;
  eq(num(withStatus.total), 2, '5: status=COMPLETED + paid=paid — ikkalasi ham qo\'llanadi');
  const cancelledPaid = (await req('GET', `/orders?clientId=${client.id}&pageSize=100&paid=unpaid&status=CANCELLED`, undefined, 200)).body;
  eq(num(cancelledPaid.total), 0, "5: status=CANCELLED + paid=unpaid — bo'sh (tab bekor qilinganni ko'rsatmaydi)");

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
  process.exit(0);
};

main().catch((e) => { console.error('orders-paid-tabs E2E crashed:', e); process.exit(1); });
