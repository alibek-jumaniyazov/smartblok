// NARX KITOBI SANAGA BOG'LIQ — egasining «narx qo'shsam ham kiritilmagan deyapti» shikoyati.
//
// Muammoning ildizi: narx qatori `effectiveFrom` bilan yoziladi, buyurtma esa narxni O'Z
// SANASIDA o'qiydi. Egasi narxni bugun kiritardi, buyurtmalar esa o'tgan oydan edi —
// natijada har uchala ekran (Mahsulotlar / buyurtma kartasi / hisob-kitob) bir-biriga zid
// gapirardi va hech biri SANANI aytmasdi.
//
// Bu paket quyidagilarni qotiradi:
//   A) zavod narxlari mahsulot yaratishda MAJBURIY (egasi qarori, 2026-07-28);
//   B) bugungi sana bilan kiritilgan narx eski buyurtmani QAMRAMAYDI — va rad etish xabari
//      buyurtma sanasini hamda narx qaysi kundan kuchda ekanini AYTADI;
//   C) sanani orqaga surish o'sha buyurtmani darhol ochadi;
//   D) ro'yxat uch holatni farqlaydi: kuchdagi narx / kelajakda kuchga kiradigan / yo'q;
//   E) noto'g'ri sana bilan kiritilgan narx versiyasini o'chirib bo'ladi;
//   F) o'sha kunning narxini qayta yozish yangi versiya yaratmaydi — tuzatadi.
//
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (bir marta)
//   cd apps/api
//   DATABASE_URL=...smartblok_test npx prisma migrate deploy && npx tsx prisma/seed.ts
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/product-prices.e2e.mjs

const BASE = process.env.API_URL ?? 'http://localhost:4100/api';
const U = Date.now().toString(36).slice(-6);
let pass = 0;
const fails = [];
const ok = (c, l) => { if (c) pass++; else fails.push(l); console.log(`${c ? '  ok  ' : ' FAIL '} ${l}`); };
const eq = (a, e, l) => ok(String(a) === String(e), `${l} — kutilgan ${e}, keldi ${a}`);
let admin;

async function req(method, path, body, expect) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer ' + admin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let j; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (expect !== undefined && res.status !== expect) {
    fails.push(`${method} ${path} -> ${res.status} (kutilgan ${expect}): ${text.slice(0, 220)}`);
    console.log(` FAIL  ${method} ${path} -> ${res.status}: ${text.slice(0, 180)}`);
  }
  return { status: res.status, body: j };
}

const ORDER_DAY = '2026-07-05';   // buyurtma — o'tmishda (import qilingan tarix kabi)
const LATE_DAY = '2026-07-20';    // narx «bugun» kiritilgandek — buyurtmadan KEYIN
const listOf = async (id) => {
  const r = (await req('GET', `/products?pageSize=200`)).body;
  return (r.items ?? r).find((p) => p.id === id);
};

async function main() {
  admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 201)).body?.accessToken;
  ok(!!admin, 'login');
  if (!admin) return;

  const factory = (await req('POST', '/factories', { name: `Z ${U}` }, 201)).body;
  const client = (await req('POST', '/clients', { name: `M ${U}` }, 201)).body;

  // ══════════ A) zavod narxlari yaratishda MAJBURIY ══════════
  console.log('\n── A) narxsiz mahsulot yaratilmaydi ──');
  const bad = await req('POST', '/products', { factoryId: factory.id, name: `X ${U}`, m3PerPallet: 1.728 }, 400);
  ok(/priceFactoryCash|priceFactoryBank/i.test(JSON.stringify(bad.body ?? '')),
    'A: zavod narxisiz POST /products ⇒ 400, maydon nomi aytiladi');

  const halfBad = await req('POST', '/products', {
    factoryId: factory.id, name: `X2 ${U}`, m3PerPallet: 1.728, priceFactoryCash: 600000,
  }, 400);
  ok(/priceFactoryBank/i.test(JSON.stringify(halfBad.body ?? '')), 'A: faqat bitta narx ham yetarli emas');

  // ══════════ B) KECHIKKAN sana bilan kiritilgan narx eski buyurtmani qamramaydi ══════════
  console.log('\n── B) narx buyurtmadan KEYINGI sana bilan kiritilsa — qamramaydi ──');
  const prod = (await req('POST', '/products', {
    factoryId: factory.id, name: `B ${U}`, m3PerPallet: 1.728,
    priceFactoryCash: 600000, priceFactoryBank: 625000, pricesEffectiveFrom: LATE_DAY,
  }, 201)).body;
  ok(!!prod?.id, 'B: mahsulot narxlar bilan yaratildi');

  const order = (await req('POST', '/orders', {
    clientId: client.id, date: ORDER_DAY, transportMode: 'CLIENT_OWN',
    items: [{ productId: prod.id, quantityM3: 10, salePricePerM3: 750000 }],
  }, 201)).body;
  ok(!!order?.id, 'B: narx kuchda bo\'lmasa ham SOTUV bloklanmaydi (tannarx keyin aniqlanadi)');

  const refuse = await req('PATCH', `/orders/${order.id}/factory-pay-intent`, { factoryPayIntent: 'CASH' }, 400);
  const refuseText = JSON.stringify(refuse.body ?? '');
  ok(/kuchda emas/i.test(refuseText),
    'B: xabar «narx umuman yo\'q» emas, «bu sanada KUCHDA EMAS» deydi');
  ok(refuseText.includes('05.07.2026'), 'B: xabarda BUYURTMA sanasi bor');
  ok(refuseText.includes('20.07.2026'), 'B: xabarda narx qaysi kundan kuchda ekani bor');

  // ══════════ C) sanani orqaga surish o'sha buyurtmani ochadi ══════════
  console.log('\n── C) sanani orqaga surish ──');
  await req('POST', `/products/${prod.id}/prices`, {
    kind: 'FACTORY_CASH', pricePerM3: 600000, effectiveFrom: '2026-07-01',
  }, 201);
  await req('PATCH', `/orders/${order.id}/factory-pay-intent`, { factoryPayIntent: 'CASH' }, 200);
  const card = (await req('GET', `/orders/${order.id}`)).body;
  ok(card?.factoryCoverage?.hasCashPrice === true, 'C: orqaga surilgan narx eski buyurtmani qamradi');
  eq(card?.costTotal, 6000000, 'C: tannarx naqd narxida (10 m³ × 600 000)');

  // ══════════ D) ro'yxat UCH holatni farqlaydi ══════════
  console.log('\n── D) ro\'yxatdagi uch holat ──');
  const row = await listOf(prod.id);
  ok(!!row?.prices?.FACTORY_CASH, 'D: kuchdagi narx `prices` da');
  eq(row?.firstPriceFrom?.FACTORY_CASH?.slice(0, 10), '2026-07-01', 'D: `firstPriceFrom` eng erta sanani beradi');
  eq(row?.oldestOrderDate?.slice(0, 10), ORDER_DAY, 'D: `oldestOrderDate` eng eski buyurtma sanasi');
  ok(!row?.prices?.DEALER_SALE, 'D: kiritilmagan sotuv narxi `prices` da yo\'q');

  // kelajak sanali narx «yo'q» bo'lib ko'rinmasligi kerak
  const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  await req('POST', `/products/${prod.id}/prices`, { kind: 'DEALER_SALE', pricePerM3: 800000, effectiveFrom: future }, 201);
  const row2 = await listOf(prod.id);
  ok(!row2?.prices?.DEALER_SALE, 'D: kelajak sanali narx hali KUCHDA emas');
  eq(row2?.pendingPrices?.DEALER_SALE?.effectiveFrom?.slice(0, 10), future,
    'D: …lekin `pendingPrices` da ko\'rinadi — «kiritilmagan» bilan adashtirilmaydi');

  // ══════════ E) noto'g'ri sanali versiyani o'chirish ══════════
  console.log('\n── E) narx versiyasini o\'chirish ──');
  const before = (await req('GET', `/products/${prod.id}/prices`)).body ?? [];
  const wrong = before.find((r) => r.kind === 'DEALER_SALE' && r.effectiveFrom.slice(0, 10) === future);
  ok(!!wrong, 'E: o\'chiriladigan qator topildi');
  await req('DELETE', `/products/${prod.id}/prices/${wrong.id}`, undefined, 200);
  const after = (await req('GET', `/products/${prod.id}/prices`)).body ?? [];
  eq(after.length, before.length - 1, 'E: qator o\'chdi');
  ok(!(await listOf(prod.id))?.pendingPrices?.DEALER_SALE, 'E: ro\'yxatda ham yo\'qoldi');
  // boshqa mahsulotning qatorini o'chirib bo'lmaydi
  const other = (await req('POST', '/products', {
    factoryId: factory.id, name: `C ${U}`, m3PerPallet: 1.728,
    priceFactoryCash: 1, priceFactoryBank: 2, pricesEffectiveFrom: '2026-07-01',
  }, 201)).body;
  const mine = ((await req('GET', `/products/${prod.id}/prices`)).body ?? [])[0];
  await req('DELETE', `/products/${other.id}/prices/${mine.id}`, undefined, 404);
  ok(true, 'E: begona mahsulotning narx qatori o\'chirilmaydi (404)');

  // ══════════ F) o'sha kunning narxi TUZATILADI, dublikat yaratilmaydi ══════════
  console.log('\n── F) bir kunga ikkinchi marta yozish ──');
  const n0 = ((await req('GET', `/products/${prod.id}/prices`)).body ?? []).length;
  await req('POST', `/products/${prod.id}/prices`, { kind: 'FACTORY_CASH', pricePerM3: 610000, effectiveFrom: '2026-07-01' }, 201);
  const rows = (await req('GET', `/products/${prod.id}/prices`)).body ?? [];
  eq(rows.length, n0, 'F: yangi versiya yaratilmadi — o\'sha kun tuzatildi');
  eq(rows.find((r) => r.kind === 'FACTORY_CASH' && r.effectiveFrom.slice(0, 10) === '2026-07-01')?.pricePerM3, '610000',
    'F: qiymat yangilandi');

  console.log(`\n${fails.length ? 'FAILED' : 'PASSED'} — ok: ${pass}, fail: ${fails.length}`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
