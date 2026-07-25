// PADDON TARIXI (pallet history) E2E — proves the «jami olingan / jami qaytarilgan /
// hozirgi qoldiq» decomposition published by pallet-stats.ts against a live API.
//
// The netted pallet balance was always trustworthy; what is new is the GROSS breakdown
// beside it. Three things can silently corrupt that breakdown, so each gets its own
// section here:
//   · a REVERSAL landing in the wrong bucket (a cancelled order would then INFLATE
//     «jami olingan» instead of erasing it — the owner's rule is SOF/NET);
//   · the breakdown drifting away from the balance every cap and board enforces;
//   · the four places a balance is published (pallets row root, row.stats, client
//     card `palletBalance`, factory card `palletsHeld`) disagreeing with each other.
//
// Run (isolated DB, never against dev data):
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx prisma migrate deploy
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   node test/_reset-data.mjs && node test/pallet-stats.e2e.mjs
const BASE = process.env.API_URL || 'http://localhost:4100/api';

let failures = 0;
let checks = 0;
const num = (v) => (v == null ? 0 : Number(v));
const eq = (actual, expected, label) => {
  checks++;
  const a = num(actual);
  const e = num(expected);
  if (Math.abs(a - e) > 0.01) {
    failures++;
    console.error(`  ✗ ${label}: expected ${e}, got ${a}`);
  } else {
    console.log(`  ✓ ${label} = ${e}`);
  }
};
const ok = (cond, label) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
};
/**
 * String equality — for DATES, never eq().
 *
 * eq() coerces both sides through Number(), and Number('2026-07-20') is NaN. Since
 * `Math.abs(NaN - NaN) > 0.01` is false, eq() reports a date assertion as PASSING no matter
 * what came back — a wrong day, or null. That turned every «oxirgi harakat» check in this
 * file into a no-op, including the one guarding that a storno row must not masquerade as
 * the last delivery. A green NaN is worse than a red failure.
 */
const is = (actual, expected, label) => {
  checks++;
  if (actual !== expected) {
    failures++;
    console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${label} = ${JSON.stringify(expected)}`);
  }
};

async function req(method, path, body, token, expectStatus) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (expectStatus !== undefined) {
    checks++;
    if (res.status !== expectStatus) {
      failures++;
      console.error(`  ✗ ${method} ${path} → ${res.status} (expected ${expectStatus}): ${text.slice(0, 200)}`);
    } else {
      console.log(`  ✓ ${method} ${path} → ${res.status}`);
    }
  } else if (res.status >= 400) {
    failures++;
    checks++;
    console.error(`  ✗ ${method} ${path} FAILED ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: json };
}

const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
// UTC, deliberately: the API emits `.toISOString()` and day() slices that same UTC string,
// so a local-midnight «today» would disagree with it for five hours every evening in UZT.
const today = new Date().toISOString().slice(0, 10);

/**
 * Log in, waiting out the 5-attempts/min brute-force brake if it trips.
 *
 * A 429 here used to be silently fatal: the token came back `undefined`, and because the
 * `balances()` reader defaulted to the admin token, the whole AGENT-scoping section then
 * re-ran AS ADMIN and reported nine failures that looked like product bugs. A missing token
 * must stop the suite, never quietly become a more privileged one.
 */
async function login(username, password) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // raw fetch, not req(): a 429 we are about to retry successfully is not a test failure,
    // and req() would score it as one.
    const res = await fetch(BASE + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => null);
    if (body?.accessToken) return body.accessToken;
    if (res.status !== 429) break;
    console.log(`  … login throttled (429), waiting out the window before retrying ${username}`);
    await new Promise((r) => setTimeout(r, 62_000));
  }
  console.error(`  ✗ FATAL: could not log in as ${username} — every later assertion would be meaningless`);
  process.exit(1);
}

async function main() {
  console.log('— login —');
  const admin = await login('admin', 'admin123');
  const agentTok = await login('jamol', 'agent123');
  ok(!!admin && !!agentTok, 'admin + agent logins');

  const agents = items((await req('GET', '/agents', undefined, admin)).body);
  const jamol = agents.find((a) => a.name === 'Жамол') || agents[0];
  ok(!!jamol, 'seeded agent present');

  // Own factory + product: every party this suite asserts on is created here, so the
  // expected figures are ABSOLUTE, not deltas off whatever the seed happens to contain.
  // `dealerInHand` is the one genuinely global pool, so that one is measured as a delta.
  console.log('— private catalog (fresh factory + product ⇒ absolute expectations) —');
  const factory = (await req('POST', '/factories', { name: 'P-Stats Zavod' }, admin, 201)).body;
  const factory2 = (await req('POST', '/factories', { name: 'P-Stats Zavod-2 (bo`sh)' }, admin, 201)).body;
  const product = (
    await req('POST', '/products', { factoryId: factory.id, name: 'P-Stats Blok', m3PerPallet: 1.728 }, admin, 201)
  ).body;
  for (const [kind, pricePerM3] of [
    ['FACTORY_CASH', 600000],
    ['FACTORY_BANK', 625000],
    ['DEALER_SALE', 750000],
  ]) {
    await req('POST', `/products/${product.id}/prices`, { kind, pricePerM3, effectiveFrom: '2026-07-01' }, admin, 201);
  }

  const mkClient = async (name, withAgent = true) =>
    (await req('POST', '/clients', { name, ...(withAgent ? { agentId: jamol.id } : {}) }, admin, 201)).body;
  const A = await mkClient('P-Stats Asosiy');   // full life-cycle: order → return → charge
  const B = await mkClient('P-Stats Bekor');    // full cancel
  const C = await mkClient('P-Stats Qisman');   // partial cancel (delivered 6, returned 2)
  const D = await mkClient('P-Stats Toza');     // never trades a pallet
  const X = await mkClient('P-Stats Begona', false); // no agent — must stay invisible to jamol

  const mkOrder = async (client, pallets, date) =>
    (
      await req(
        'POST',
        '/orders',
        {
          clientId: client.id,
          date,
          transportMode: 'CLIENT_OWN',
          items: [{ productId: product.id, palletCount: pallets }],
        },
        admin,
        201,
      )
    ).body;

  // ── payload readers ──────────────────────────────────────────────────────
  // NO default token, on purpose: `balances()` falling back to admin is precisely what let a
  // throttled agent login run the AGENT-scoping section with admin rights and still be read
  // as a product bug. An absent token must blow up here, loudly.
  const balances = async (token) => {
    if (!token) throw new Error('balances() tokensiz chaqirildi — rol qamrovi tekshirilmay qoladi');
    return (await req('GET', '/pallets/balances', undefined, token)).body;
  };
  const clientRow = (bal, id) => bal.clients.find((r) => r.client.id === id);
  const factoryRow = (bal, id) => (bal.factories ?? []).find((r) => r.factory.id === id);
  const cStats = (bal, id) => clientRow(bal, id)?.stats ?? {};
  const fStats = (bal, id) => factoryRow(bal, id)?.stats ?? {};

  const base = await balances(admin);
  const baseInHand = num(base.dealerInHand);
  const inHand = (bal) => num(bal.dealerInHand) - baseInHand;

  /**
   * The conservation identity the whole model rests on: what we owe the factories is
   * exactly what is out at clients + what is loose in our yard + what was written off
   * as lost. `drift` is the API's own statement of it, so both are checked — a green
   * `drift` computed from a broken sum would be worth nothing.
   */
  const conserved = (bal, at) => {
    const t = bal.totals;
    eq(t.drift, 0, `drift 0 (${at})`);
    eq(
      t.factory.balance,
      t.client.balance + num(bal.dealerInHand) + t.client.chargedLost,
      `zavodga qarz = mijozlarda + qo'limizda + yo'qotilgan (${at})`,
    );
  };

  // ══════════ 1) order create books BOTH sides ══════════
  console.log('\n— 1) buyurtma: zavoddan olindi + mijozga berildi (10 dona) —');
  await mkOrder(A, 10, '2026-07-20');
  let bal = await balances(admin);
  eq(cStats(bal, A.id).received, 10, 'A: mijozga jami berilgan 10');
  eq(cStats(bal, A.id).returned, 0, 'A: qaytargan 0');
  eq(cStats(bal, A.id).balance, 10, 'A: hozir mijozda 10');
  eq(cStats(bal, A.id).movements, 1, 'A: bitta harakat qatori');
  eq(fStats(bal, factory.id).received, 10, 'Zavod: jami oldik 10');
  eq(fStats(bal, factory.id).returned, 0, 'Zavod: qaytardik 0');
  eq(fStats(bal, factory.id).balance, 10, 'Zavod: hozir qarzmiz 10');
  eq(inHand(bal), 0, "diller qo'lida hali 0 (mol mijozga ketdi)");
  is(day(cStats(bal, A.id).lastReceivedAt), '2026-07-20', 'A: oxirgi olingan sana = buyurtma sanasi');
  is(day(fStats(bal, factory.id).firstMovementAt), '2026-07-20', 'Zavod: birinchi harakat sanasi');
  ok(cStats(bal, A.id).lastReturnAt === null, 'A: hali qaytarmagan ⇒ lastReturnAt null');
  conserved(bal, 'buyurtmadan keyin');

  // ══════════ 2) client return ══════════
  console.log('\n— 2) mijoz 4 dona qaytardi —');
  await req('POST', '/pallets/client-return', { clientId: A.id, qty: 4, date: '2026-07-21' }, admin, 201);
  bal = await balances(admin);
  eq(cStats(bal, A.id).returned, 4, 'A: mijoz qaytargan 4');
  eq(cStats(bal, A.id).received, 10, 'A: jami berilgan o`zgarmadi (10)');
  eq(cStats(bal, A.id).balance, 6, 'A: hozir mijozda 6');
  eq(cStats(bal, A.id).movements, 2, 'A: ikkita harakat qatori');
  is(day(cStats(bal, A.id).lastReturnAt), '2026-07-21', 'A: oxirgi qaytargan sanasi');
  // a client return is between the dealer and his client — the factory is not in it
  eq(fStats(bal, factory.id).received, 10, 'Zavod: jami oldik tegilmadi');
  eq(fStats(bal, factory.id).returned, 0, 'Zavod: qaytardik hamon 0');
  eq(fStats(bal, factory.id).balance, 10, 'Zavod: qarzimiz hamon 10');
  eq(inHand(bal), 4, "diller qo'lida 4 (mijozdan qaytgan, zavodga hali ketmagan)");
  conserved(bal, 'mijoz qaytarganidan keyin');

  // ══════════ 3) factory return ══════════
  console.log('\n— 3) zavodga 3 dona qaytardik —');
  await req('POST', '/pallets/factory-return', { factoryId: factory.id, qty: 3, date: '2026-07-22' }, admin, 201);
  bal = await balances(admin);
  eq(fStats(bal, factory.id).returned, 3, 'Zavod: zavodga qaytarilgan 3');
  eq(fStats(bal, factory.id).received, 10, 'Zavod: jami oldik hamon 10');
  eq(fStats(bal, factory.id).balance, 7, 'Zavod: hozir qarzmiz 7');
  eq(fStats(bal, factory.id).movements, 2, 'Zavod: ikkita harakat qatori');
  is(day(fStats(bal, factory.id).lastReturnAt), '2026-07-22', 'Zavod: oxirgi qaytarilgan sanasi');
  eq(inHand(bal), 1, "diller qo'lida 1 qoldi");
  eq(cStats(bal, A.id).balance, 6, 'A: mijoz tomoni tegilmadi');
  conserved(bal, 'zavodga qaytarganimizdan keyin');

  // ══════════ 4) charge-lost — the ONLY flow that turns pallets into money ══════════
  console.log('\n— 4) 2 dona yo`qotilgan deb undirildi (130 000/dona) —');
  const moneyBefore = num((await req('GET', `/clients/${A.id}`, undefined, admin)).body.balance);
  await req('POST', '/pallets/charge-lost', { clientId: A.id, qty: 2, date: '2026-07-23', unitPrice: 130000 }, admin, 201);
  bal = await balances(admin);
  eq(cStats(bal, A.id).chargedLost, 2, 'A: yo`qotilgan (undirilgan) 2');
  ok(cStats(bal, A.id).chargedLostAmount === '260000.00', 'A: undirilgan summa "260000.00" (o`nlik satr)');
  eq(cStats(bal, A.id).balance, 4, 'A: hozir mijozda 4 (10−4−2)');
  eq(cStats(bal, A.id).returned, 4, 'A: undirish qaytarganga qo`shilmadi');
  eq(cStats(bal, A.id).movements, 3, 'A: uchta harakat qatori');
  const aCard = (await req('GET', `/clients/${A.id}`, undefined, admin)).body;
  eq(num(aCard.balance) - moneyBefore, 260000, 'A: PUL qarzi 2×130 000 ga oshdi');
  const charge = (aCard.statement ?? []).find((e) => e.source === 'PALLET_CHARGE');
  ok(!!charge, 'CLIENT ledgerda PALLET_CHARGE qatori paydo bo`ldi');
  eq(charge?.amount, 260000, 'ledger qatori summasi 260 000');
  eq(fStats(bal, factory.id).balance, 7, 'Zavod: undirish zavod tomoniga tegmadi');
  eq(inHand(bal), 1, "undirish diller qo'lidagi zaxiraga qo'shilmaydi (paddon qaytmadi)");
  conserved(bal, 'undirishdan keyin');

  // ══════════ 5) THE CRITICAL CASE — full order cancel is NET ══════════
  console.log('\n— 5) BEKOR QILISH (to`liq): «jami olingan» PASAYADI, boshqa katakka ko`chmaydi —');
  const orderB = await mkOrder(B, 5, '2026-07-20');
  bal = await balances(admin);
  eq(cStats(bal, B.id).received, 5, 'B: bekordan oldin jami berilgan 5');
  eq(fStats(bal, factory.id).received, 15, 'Zavod: bekordan oldin jami oldik 15');
  conserved(bal, 'B buyurtmasidan keyin');

  await req('DELETE', `/orders/${orderB.id}`, { reason: 'paddon statistikasi testi' }, admin, 200);
  bal = await balances(admin);
  // SOF (net): the truck never came, so «jami olingan» must shrink back — the whole
  // reason reversals are routed to the bucket of the row they reverse.
  eq(cStats(bal, B.id).received, 0, 'B: bekordan keyin jami berilgan 0 (SOF)');
  eq(fStats(bal, factory.id).received, 10, 'Zavod: jami oldik 15→10 (PASAYDI)');
  // …and the reversal must NOT masquerade as a return or as an adjustment
  eq(cStats(bal, B.id).returned, 0, 'B: storno «qaytargan» katagiga TUSHMADI');
  eq(cStats(bal, B.id).adjustment, 0, 'B: storno «tuzatish» katagiga ham tushmadi');
  eq(fStats(bal, factory.id).returned, 3, 'Zavod: qaytardik hamon 3 (storno bu yerga tushmadi)');
  eq(fStats(bal, factory.id).adjustment, 0, 'Zavod: tuzatish 0');
  eq(cStats(bal, B.id).balance, 0, 'B: qoldiq 0');
  eq(fStats(bal, factory.id).balance, 7, 'Zavod: qarzimiz 7 ga qaytdi');
  // the rows still exist — «movements» counts bookkeeping, the buckets count physics
  eq(cStats(bal, B.id).movements, 2, 'B: 2 qator (berildi + storno) — sonlar 0 bo`lsa ham');
  // a storno row is not a truck arriving: it must not become the «oxirgi olingan» date
  is(day(cStats(bal, B.id).lastReceivedAt), '2026-07-20', 'B: oxirgi olingan sana hamon buyurtma sanasi');
  // reverseForOrder stamps the storno `new Date()`, so «oxirgi harakat» must move to TODAY
  // while «oxirgi olingan» stays back on the order date — the two dates answer different
  // questions and a storno may only ever move the first one.
  is(day(cStats(bal, B.id).lastMovementAt), today, 'B: oxirgi harakat = storno sanasi (bugun)');
  ok(
    day(cStats(bal, B.id).lastMovementAt) > day(cStats(bal, B.id).lastReceivedAt),
    'B: storno sanasi oxirgi olingan sanadan KEYIN',
  );
  eq(inHand(bal), 1, "bekor qilish diller qo'lidagi zaxiraga tegmadi");
  conserved(bal, 'to`liq bekordan keyin');

  // ══════════ 6) partial cancel — only what the client still HOLDS may be reversed ══════════
  console.log('\n— 6) BEKOR (qisman): 6 berildi, 2 qaytdi ⇒ faqat 4 storno bo`ladi —');
  const orderC = await mkOrder(C, 6, '2026-07-20');
  await req('POST', '/pallets/client-return', { clientId: C.id, qty: 2, date: '2026-07-21' }, admin, 201);
  bal = await balances(admin);
  eq(cStats(bal, C.id).balance, 4, 'C: bekordan oldin mijozda 4 (6−2)');
  eq(fStats(bal, factory.id).received, 16, 'Zavod: bekordan oldin jami oldik 16');
  eq(inHand(bal), 3, "bekordan oldin diller qo'lida 3");

  await req('DELETE', `/orders/${orderC.id}`, { reason: 'qisman storno testi' }, admin, 200);
  bal = await balances(admin);
  eq(cStats(bal, C.id).received, 2, 'C: jami berilgan 6−4 = 2 (faqat ushlab turgani storno bo`ldi)');
  eq(cStats(bal, C.id).returned, 2, 'C: qaytargani SAQLANDI (2) — bekor uni bekor qilmaydi');
  eq(cStats(bal, C.id).chargedLost, 0, 'C: undirilgan 0');
  eq(cStats(bal, C.id).adjustment, 0, 'C: tuzatish 0 — qisman storno qoldiq qoldirmadi');
  eq(cStats(bal, C.id).balance, 0, 'C: mijozda 0');
  eq(fStats(bal, factory.id).received, 12, 'Zavod: jami oldik 16−4 = 12 (faqat 4 tasi storno)');
  eq(fStats(bal, factory.id).returned, 3, 'Zavod: qaytardik hamon 3');
  eq(fStats(bal, factory.id).balance, 9, 'Zavod: hozir qarzmiz 9');
  eq(inHand(bal), 3, "diller qo'lidagi 3 dona joyida (mijoz fizik qaytargan mol)");
  conserved(bal, 'qisman bekordan keyin');

  // ══════════ 7) arithmetic identity for EVERY party ══════════
  console.log('\n— 7) arifmetika: har bir tomon uchun ayirma qoldiqqa tushadi —');
  {
    let bad = 0;
    for (const r of bal.clients) {
      const s = r.stats;
      if (Math.abs(s.balance - (s.received - s.returned - s.chargedLost + s.adjustment)) > 0.0001) {
        bad++;
        console.error(`    · mijoz ${r.client.name}: ${JSON.stringify(s)}`);
      }
    }
    ok(bad === 0, `har bir mijozda balance = olingan − qaytargan − yo'qotilgan + tuzatish (${bal.clients.length} ta)`);
    let badF = 0;
    for (const r of bal.factories) {
      const s = r.stats;
      if (Math.abs(s.balance - (s.received - s.returned + s.adjustment)) > 0.0001) {
        badF++;
        console.error(`    · zavod ${r.factory.name}: ${JSON.stringify(s)}`);
      }
    }
    ok(badF === 0, `har bir zavodda balance = oldik − qaytardik + tuzatish (${bal.factories.length} ta)`);
    // the same identity must survive the roll-up, not just the rows
    const tc = bal.totals.client;
    eq(tc.balance, tc.received - tc.returned - tc.chargedLost + tc.adjustment, 'jami mijozlar arifmetikasi');
    const tf = bal.totals.factory;
    eq(tf.balance, tf.received - tf.returned + tf.adjustment, 'jami zavodlar arifmetikasi');
  }

  // ══════════ 8) cross-check: four publishers of the SAME number ══════════
  console.log('\n— 8) bitta raqam — to`rt joyda bir xil —');
  {
    let bad = 0;
    for (const r of bal.clients) {
      const card = (await req('GET', `/clients/${r.client.id}`, undefined, admin)).body;
      const same =
        num(r.balance) === num(r.stats.balance) &&
        num(card.palletBalance) === num(r.balance) &&
        num(card.palletStats?.balance) === num(r.balance) &&
        num(card.palletStats?.received) === num(r.stats.received) &&
        num(card.palletStats?.returned) === num(r.stats.returned);
      if (!same) {
        bad++;
        console.error(`    · ${r.client.name}: row=${r.balance}/${r.stats.balance} card=${card.palletBalance}/${card.palletStats?.balance}`);
      }
    }
    ok(bad === 0, 'mijoz: row.balance = row.stats.balance = card.palletBalance = card.palletStats.balance');

    let badF = 0;
    for (const r of bal.factories) {
      const card = (await req('GET', `/factories/${r.factory.id}`, undefined, admin)).body;
      const same =
        num(r.balance) === num(r.stats.balance) &&
        num(card.palletsHeld) === num(r.balance) &&
        num(card.palletStats?.balance) === num(r.balance) &&
        num(card.palletStats?.received) === num(r.stats.received) &&
        num(card.palletStats?.returned) === num(r.stats.returned);
      if (!same) {
        badF++;
        console.error(`    · ${r.factory.name}: row=${r.balance}/${r.stats.balance} card=${card.palletsHeld}/${card.palletStats?.balance}`);
      }
    }
    ok(badF === 0, 'zavod: row.balance = row.stats.balance = card.palletsHeld = card.palletStats.balance');

    // the list endpoints publish it too (Clients / Zavodlar tables)
    const clientList = items((await req('GET', '/clients?pageSize=100', undefined, admin)).body);
    const listedA = clientList.find((r) => r.id === A.id);
    eq(listedA?.palletBalance, 4, 'ro`yxatdagi A.palletBalance = 4');
    eq(listedA?.palletStats?.received, 10, 'ro`yxatdagi A.palletStats.received = 10');
    const factoryList = items((await req('GET', '/factories?pageSize=100', undefined, admin)).body);
    const listedF = factoryList.find((r) => r.id === factory.id);
    eq(listedF?.palletsHeld, 9, 'ro`yxatdagi zavod.palletsHeld = 9');
    eq(listedF?.palletStats?.received, 12, 'ro`yxatdagi zavod.palletStats.received = 12');

    // totals must be the SUM of the rows, not a separately-computed opinion
    const sum = (rows, k) => rows.reduce((t, r) => t + num(r.stats[k]), 0);
    eq(bal.totals.client.received, sum(bal.clients, 'received'), 'jami mijoz «olingan» = qatorlar yig`indisi');
    eq(bal.totals.client.returned, sum(bal.clients, 'returned'), 'jami mijoz «qaytargan» = qatorlar yig`indisi');
    eq(bal.totals.client.chargedLost, sum(bal.clients, 'chargedLost'), 'jami «yo`qotilgan» = qatorlar yig`indisi');
    eq(bal.totals.factory.received, sum(bal.factories, 'received'), 'jami zavod «oldik» = qatorlar yig`indisi');
    eq(bal.totals.factory.returned, sum(bal.factories, 'returned'), 'jami zavod «qaytardik» = qatorlar yig`indisi');
    ok(bal.totals.client.chargedLostAmount === '260000.00', 'jami undirilgan summa "260000.00"');
  }

  // ══════════ 9) movements really is the journal row count ══════════
  console.log('\n— 9) «movements» = jurnaldagi qatorlar soni —');
  {
    const jA = (await req('GET', `/pallets/transactions?clientId=${A.id}&pageSize=100`, undefined, admin)).body;
    eq(jA.total, cStats(bal, A.id).movements, 'A: jurnal qatorlari = movements');
    const jB = (await req('GET', `/pallets/transactions?clientId=${B.id}&pageSize=100`, undefined, admin)).body;
    eq(jB.total, 2, 'B: jurnalda 2 qator (berildi + storno) — bekor izini o`chirmaydi');
    ok(
      items(jB).some((r) => r.type === 'REVERSAL') && items(jB).some((r) => r.type === 'DELIVERED_TO_CLIENT'),
      'B: jurnalda ikkala tur ham ko`rinadi',
    );
    const jF = (await req('GET', `/pallets/transactions?factoryId=${factory.id}&pageSize=100`, undefined, admin)).body;
    eq(jF.total, fStats(bal, factory.id).movements, 'Zavod: jurnal qatorlari = movements');
  }

  // ══════════ 10) never-traded parties keep the shape (0 ≠ missing) ══════════
  console.log('\n— 10) hech qachon paddon ko`rmagan tomon —');
  {
    const d = cStats(bal, D.id);
    eq(d.movements, 0, 'D: harakat 0');
    eq(d.received, 0, 'D: olingan 0');
    eq(d.balance, 0, 'D: qoldiq 0');
    ok(d.firstMovementAt === null && d.lastMovementAt === null, 'D: sanalar null');
    ok(d.chargedLostAmount === '0' || d.chargedLostAmount === '0.00', 'D: undirilgan summa nol satr');
    const f2 = fStats(bal, factory2.id);
    eq(f2.movements, 0, 'bo`sh zavod: harakat 0');
    eq(f2.balance, 0, 'bo`sh zavod: qoldiq 0');
    eq(f2.chargedLost, 0, 'zavod tomonida «yo`qotilgan» hech qachon bo`lmaydi');
    ok(f2.chargedLostAmount === '0' || f2.chargedLostAmount === '0.00', 'zavod tomonida undirilgan summa nol');
  }

  // ══════════ 11) AGENT scoping ══════════
  console.log('\n— 11) AGENT: faqat o`z mijozlari, zavod tomoni umuman yo`q —');
  {
    const abal = await balances(agentTok);
    ok(abal.factories === undefined, 'agentga `factories` umuman yuborilmaydi');
    ok(abal.dealerInHand === undefined, "agentga «diller qo'lida» yuborilmaydi");
    eq(abal.totals.factory.balance, 0, 'agent: jami zavod qoldig`i 0');
    eq(abal.totals.factory.received, 0, 'agent: jami zavod «oldik» 0');
    eq(abal.totals.factory.returned, 0, 'agent: jami zavod «qaytardik» 0');
    eq(abal.totals.dealerInHand, 0, "agent: «diller qo'lida» 0");

    const ids = abal.clients.map((r) => r.client.id);
    ok(ids.includes(A.id) && ids.includes(B.id) && ids.includes(C.id) && ids.includes(D.id), 'agent o`z mijozlarini ko`radi');
    ok(!ids.includes(X.id), 'agent begona mijozni KO`RMAYDI');
    // his roll-up is HIS clients only — 10 (A) + 0 (B, bekor) + 2 (C, qisman bekor)
    eq(abal.totals.client.received, 12, 'agent jami «berilgan» = faqat o`z mijozlari (12)');
    eq(abal.totals.client.returned, 6, 'agent jami «qaytargan» = 6 (4+2)');
    eq(abal.totals.client.chargedLost, 2, 'agent jami «yo`qotilgan» = 2');
    eq(abal.totals.client.balance, 4, 'agent jami qoldiq = 4');
    // and the breakdown reaches him in full for his own client
    const aRow = abal.clients.find((r) => r.client.id === A.id);
    eq(aRow?.stats?.received, 10, 'agent: A.stats.received 10');
    eq(aRow?.balance, aRow?.stats?.balance, 'agent: row.balance = stats.balance');
  }

  // ══════════ 12) final absolute state ══════════
  console.log('\n— 12) yakuniy holat —');
  bal = await balances(admin);
  eq(fStats(bal, factory.id).received, 12, 'Zavod: jami oldik 12');
  eq(fStats(bal, factory.id).returned, 3, 'Zavod: jami qaytardik 3');
  eq(fStats(bal, factory.id).balance, 9, 'Zavod: hozir qarzmiz 9');
  eq(cStats(bal, A.id).received, 10, 'A: jami berilgan 10');
  eq(cStats(bal, A.id).returned, 4, 'A: qaytargan 4');
  eq(cStats(bal, A.id).chargedLost, 2, 'A: yo`qotilgan 2');
  eq(cStats(bal, A.id).balance, 4, 'A: hozir mijozda 4');
  eq(inHand(bal), 3, "diller qo'lida 3");
  conserved(bal, 'yakun');

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
