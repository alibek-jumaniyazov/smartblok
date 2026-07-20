// Auto-FIFO settlement (owner's rule, 2026-07-20): client money closes the OLDEST order
// first and keeps going down the list; the remainder stays as an advance and attaches
// itself to the next order booked. Manual allocation of client money is refused.
//
// Needs a VIRGIN DB + a fresh API on :4100 (the suite creates fixed-name fixtures):
//   see the recipe at the top of e2e-core.mjs.
const BASE = process.env.API_URL || 'http://localhost:4100/api';
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails++; };
const M = (n) => Number(n).toLocaleString('ru-RU').replace(/ /g, ' ');

async function req(method, path, body, tok, expect) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (expect ? r.status !== expect : r.status >= 400) {
    console.log(`  ✗ ${method} ${path} → ${r.status}: ${txt.slice(0, 220)}`); fails++;
  }
  return j;
}

const admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;
const prods = (await req('GET', '/products?pageSize=200', null, admin)).items ?? [];
const product = prods.find((p) => p.prices?.DEALER_SALE) ?? prods[0];
const boxRes = await req('GET', '/kassa/cashboxes', null, admin);
const cashBox = (Array.isArray(boxRes) ? boxRes : boxRes.items ?? []).find((b) => b.type === 'CASH' && b.currency === 'UZS');
const client = await req('POST', '/clients', { name: `FIFO ${Date.now()}`, phone: '+998900002222' }, admin);

// three orders, deliberately created NEWEST-FIRST so we prove ordering is by DATE, not insert order
const mk = async (date, sum) =>
  req('POST', '/orders', {
    clientId: client.id, date, transportMode: 'CLIENT_OWN',
    items: [{ productId: product.id, quantityM3: 10, saleLumpSum: sum }],
  }, admin);

console.log('\n— 3 ta buyurtma (teskari tartibda yaratilgan) —');
const c = await mk('2026-07-14', 8000000);   // 3rd oldest
const b = await mk('2026-07-09', 5000000);   // 2nd
const a = await mk('2026-07-05', 4000000);   // OLDEST
ok(!!a.id && !!b.id && !!c.id, `yaratildi: ${a.orderNo}(05-iyul) ${b.orderNo}(09-iyul) ${c.orderNo}(14-iyul)`);

const owes = async (id) => Number((await req('GET', `/orders/${id}`, null, admin)).clientOutstanding);

console.log('\n— to\'lovdan oldin —');
ok(await owes(a.id) === 4000000, `${a.orderNo} qarzi = ${M(await owes(a.id))}`);
ok(await owes(c.id) === 8000000, `${c.orderNo} qarzi = ${M(await owes(c.id))}`);

console.log('\n— 10 000 000 to\'lov (hech qanday taqsimlash ko\'rsatilmadi) —');
await req('POST', '/payments', {
  kind: 'CLIENT_IN', clientId: client.id, amount: 10000000,
  method: 'CASH', cashboxId: cashBox.id, date: '2026-07-20',
}, admin);

const [oa, ob, oc] = [await owes(a.id), await owes(b.id), await owes(c.id)];
console.log(`  ${a.orderNo} (05-iyul, eng eski) qarzi: ${M(oa)}`);
console.log(`  ${b.orderNo} (09-iyul)            qarzi: ${M(ob)}`);
console.log(`  ${c.orderNo} (14-iyul)            qarzi: ${M(oc)}`);
ok(oa === 0, 'eng eski buyurtma TO\'LIQ yopildi');
ok(ob === 0, 'ikkinchi buyurtma ham to\'liq yopildi');
ok(oc === 7000000, 'uchinchisiga qolgan 1 000 000 tushdi (8M − 1M = 7M)');

console.log('\n— ortiqcha to\'lov → avans —');
await req('POST', '/payments', {
  kind: 'CLIENT_IN', clientId: client.id, amount: 10000000,
  method: 'CASH', cashboxId: cashBox.id, date: '2026-07-20',
}, admin);
ok(await owes(c.id) === 0, 'oxirgi buyurtma ham yopildi');
const cl = await req('GET', `/clients/${client.id}`, null, admin);
ok(Number(cl.balance) === -3000000, `ortiqcha 3 000 000 avans bo'lib qoldi (balans ${M(cl.balance)})`);

console.log('\n— avans turgan mijozga YANGI buyurtma → avtomatik yopilishi kerak —');
const d = await mk('2026-07-21', 2000000);
ok(await owes(d.id) === 0, `${d.orderNo} avansdan avtomatik yopildi`);
const cl2 = await req('GET', `/clients/${client.id}`, null, admin);
ok(Number(cl2.balance) === -1000000, `avans qoldig'i 1 000 000 (balans ${M(cl2.balance)})`);

console.log('\n— qo\'lda taqsimlash TAQIQLANGAN bo\'lishi kerak —');
const pays = (await req('GET', `/payments?clientId=${client.id}&pageSize=10`, null, admin)).items ?? [];
const anyPay = pays.find((p) => p.kind === 'CLIENT_IN');
await req('POST', `/payments/${anyPay.id}/allocations`, { allocations: [{ orderId: d.id, amount: 1 }] }, admin, 400);
ok(true, 'mijoz to\'lovini qo\'lda taqsimlash rad etildi (400)');

console.log(`\n${fails === 0 ? 'FIFO AVTO-TAQSIMLASH TO‘LIQ ISHLADI ✓' : `${fails} XATO ✗`}`);
process.exit(fails ? 1 : 0);
