// «Balansni nazorat qilish» — off-book balans tuzatishi (egasi qoidasi, 2026-07-22).
//
// Qoida: ADMIN mijoz yoki zavod balansini QO'LDA tuzatishi mumkin, LEKIN bu tuzatish
//   • O'SHA tomonning balansida va uning «amallar» (statement) ro'yxatida KO'RINADI;
//   • dashboard va qarzlar yig'indisiga (kompaniya rollupi) CHIQMAYDI;
//   • kassaga UMUMAN tegmaydi (tranzaksiyalar jurnalida ham yo'q).
//
// Bu test aynan shu «ko'rinadi / ko'rinmaydi» chegarasini qo'riqlaydi — u buzilsa
// dashboard raqamlari jimgina siljib ketadi va buni hech kim sezmaydi.
//
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (bir marta)
//   cd apps/api
//   DATABASE_URL=...smartblok_test npx prisma migrate deploy && npx tsx prisma/seed.ts
//   DATABASE_URL=...smartblok_test API_PORT=4100 node dist/main.js &
//   node test/offbook-balance.e2e.mjs

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

const clientBal = async (id) =>
  num((await req('GET', `/debts/statement?account=CLIENT&partyId=${id}`)).body?.closingBalance);
const factoryOf = async (id) => (await req('GET', `/factories/${id}`)).body;
const dash = async () => (await req('GET', '/dashboard/summary')).body;
const debtSummary = async () => (await req('GET', '/debts/summary')).body;
const kassaRowCount = async () => num((await req('GET', '/kassa/transactions?pageSize=1')).body?.total);

const main = async () => {
  admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 201, null)).body?.accessToken;
  ok(!!admin, 'admin login');
  accountant = (await req('POST', '/auth/login', { username: 'hisob', password: 'hisob123' }, 201, null)).body?.accessToken;
  ok(!!accountant, 'buxgalter login');

  const factory = (await req('POST', '/factories', { name: `OffBook zavod ${U}` }, 201)).body;
  const client = (await req('POST', '/clients', { name: `OffBook mijoz ${U}` }, 201)).body;

  // ── REAL fon: bitta buyurtma + qisman to'lov, ya'ni kompaniya rollupi NOLDAN FARQLI.
  //    Aks holda «o'zgarmadi» tekshiruvlari 0 == 0 ni taqqoslab, off-book sizib chiqsa ham
  //    yashil qolardi — testning butun ma'nosi shu fonda.
  const product = (await req('POST', '/products', { factoryId: factory.id, name: `B ${U}`, m3PerPallet: 1.728 }, 201)).body;
  for (const [kind, price] of [['FACTORY_CASH', 600000], ['FACTORY_BANK', 625000], ['DEALER_SALE', 750000]])
    await req('POST', `/products/${product.id}/prices`, { kind, pricePerM3: price, effectiveFrom: '2026-07-01' }, 201);
  const boxes = (await req('GET', '/kassa/cashboxes')).body;
  const cash = (boxes.items ?? boxes).find((b) => b.type === 'CASH' && b.currency === 'UZS');
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'IN', amount: 500_000_000, date: '2026-07-22', note: 'kapital' }, 201);
  await req('POST', '/orders', {
    clientId: client.id, date: '2026-07-22', factoryPayIntent: 'BANK',
    oneTimeVehicle: { name: `Mo ${U}`, plate: `OB${U}${Math.random().toString(36).slice(2, 5)}` },
    transportMode: 'CLIENT_OWN',
    items: [{ productId: product.id, quantityM3: 32, palletCount: 19, salePricePerM3: 750000 }],
  }, 201);
  await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: client.id, method: 'CASH', cashboxId: cash.id,
    amount: 9_000_000, date: '2026-07-22',
  }, 201);

  // ══════════ 0) boshlang'ich holat ══════════
  const d0 = await dash();
  const s0 = await debtSummary();
  const rows0 = await kassaRowCount();
  const cb0 = await clientBal(client.id);
  const fb0 = await factoryOf(factory.id);
  eq(cb0, 15_000_000, "boshida mijoz qarzi 24M − 9M to'lov");
  ok(num(s0.clientsOweUs) > 0, 'fon real: clientsOweUs noldan katta');
  ok(num(s0.factoryPayableOpen) > 0, 'fon real: factoryPayableOpen noldan katta');

  // ══════════ A) MIJOZ — qarzini oshirish (+) ══════════
  console.log('\n── A) mijoz balansini +5 000 000 ga tuzatish ──');
  const ADD = 5_000_000;
  await req('POST', `/clients/${client.id}/adjust-balance`, { amount: ADD, note: 'qo\'lda tuzatildi (test)' }, 201);

  eq(await clientBal(client.id), cb0 + ADD, 'A: mijoz balansi tuzatish qiymatiga siljidi');

  const stmt = (await req('GET', `/debts/statement?account=CLIENT&partyId=${client.id}`)).body;
  const offRow = (stmt?.entries ?? []).find((r) => r.source === 'OFFBOOK_ADJUSTMENT');
  ok(!!offRow, "A: tuzatish mijozning «amallar» ro'yxatida ko'rinadi");
  if (offRow) eq(num(offRow.amount), ADD, 'A: amallar qatoridagi summa');

  const d1 = await dash();
  const s1 = await debtSummary();
  eq(num(s1.clientsOweUs), num(s0.clientsOweUs), 'A: qarzlar yig\'indisi (clientsOweUs) O\'ZGARMADI');
  eq(num(s1.weOweClients), num(s0.weOweClients), 'A: qarzlar yig\'indisi (weOweClients) O\'ZGARMADI');
  eq(num(d1.allTime?.netProfit ?? d1.netProfit), num(d0.allTime?.netProfit ?? d0.netProfit), 'A: dashboard sof foyda O\'ZGARMADI');
  eq(await kassaRowCount(), rows0, 'A: kassa tranzaksiyalari qo\'shilmadi (jurnalda ko\'rinmaydi)');

  // ══════════ B) MIJOZ — qarzini kamaytirish (−), avansga o'tkazish ══════════
  console.log('\n── B) mijoz balansini −8 000 000 ga tuzatish (kreditga o\'tadi) ──');
  await req('POST', `/clients/${client.id}/adjust-balance`, { amount: -8_000_000 }, 201);
  eq(await clientBal(client.id), cb0 + ADD - 8_000_000, "B: ikkita tuzatish yig'indisi (jami −3 000 000)");

  const s2 = await debtSummary();
  eq(num(s2.clientsOweUs), num(s0.clientsOweUs), 'B: clientsOweUs hamon O\'ZGARMADI');
  eq(num(s2.weOweClients), num(s0.weOweClients), 'B: weOweClients hamon O\'ZGARMADI (kredit ham off-book)');

  // ══════════ C) ZAVOD — qarzimizni oshirish ══════════
  console.log('\n── C) zavod balansini tuzatish ──');
  const FADJ = -4_000_000; // <0 ⇒ zavodga qarzimiz ortadi (PAYABLE)
  await req('POST', `/factories/${factory.id}/adjust-balance`, { amount: FADJ, note: 'zavod tuzatishi (test)' }, 201);

  const fb1 = await factoryOf(factory.id);
  eq(num(fb1.balance) - num(fb0.balance), FADJ, 'C: zavod balansi tuzatish qiymatiga siljidi');

  const s3 = await debtSummary();
  eq(num(s3.factoryPayableOpen), num(s0.factoryPayableOpen), 'C: factoryPayableOpen O\'ZGARMADI');
  eq(num(s3.factoryAdvance), num(s0.factoryAdvance), 'C: factoryAdvance O\'ZGARMADI');
  eq(await kassaRowCount(), rows0, 'C: kassa hamon tegilmagan');

  // ══════════ D) qoidalar ══════════
  console.log('\n── D) qoidalar ──');
  await req('POST', `/clients/${client.id}/adjust-balance`, { amount: 0 }, 400);
  ok(true, 'D: nol summa rad etildi (400)');
  await req('POST', `/clients/${client.id}/adjust-balance`, { amount: 1_000_000 }, 403, accountant);
  ok(true, 'D: buxgalter (ACCOUNTANT) tuzatolmaydi (403)');
  await req('POST', `/factories/${factory.id}/adjust-balance`, { amount: 1_000_000 }, 403, accountant);
  ok(true, 'D: buxgalter zavod balansini ham tuzatolmaydi (403)');

  // tuzatishdan keyin ham mijoz balansi o'zgarmagan bo'lishi kerak (rad etilgan chaqiruvlar)
  eq(await clientBal(client.id), cb0 + ADD - 8_000_000, 'D: rad etilgan chaqiruvlar balansni qimirlatmadi');

  console.log(`\n${pass} ok, ${fails.length} fail`);
  if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
  process.exit(0);
};

main().catch((e) => { console.error('offbook-balance E2E crashed:', e); process.exit(1); });
