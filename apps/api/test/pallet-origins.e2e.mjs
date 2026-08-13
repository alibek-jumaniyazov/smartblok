// «PADDON QARZI QAYSI BUYURTMADAN» E2E (egasi so'rovi, 2026-08-13).
//
// Egasining savoli: «mijoz bizga 15 paddon qarz — o'sha 15 dona 3 ta buyurtmadan kelgan;
// AYNAN qaysi buyurtmalardan ekanini chiqarish kerak, Excel importidan kelgani ham».
//
// Bu to'plam javobning jim turib buzilishi mumkin bo'lgan joylarini qamraydi:
//
//   §1  TAQSIMOT FIFO. Qaytarish eng eski partiyadan yopadi. Teskari tartib «eski
//       buyurtma hamon ochiq» degan yolg'on qoldirardi.
//   §2  KO'RSATILGAN BUYURTMA USTUN. Qaytarish qatorida buyurtma yozilgan bo'lsa, FIFO
//       emas, O'SHA partiya yopiladi — foydalanuvchi bergan yagona aniq ma'lumot
//       e'tiborsiz qolmasin.
//   §3  UNDIRISH ham partiyani yopadi (paddon pulga aylanib, mijozdan chiqib ketdi).
//   §4  USTUNLAR QOLDIQQA TENG. Σ(qarz) + «manba ko'rsatilmagan» === kartochkadagi
//       qoldiq. Bu KAFOLAT: aks holda bitta ekranda bitta savolga ikki xil javob turardi.
//   §5  STORNO. Bekor qilingan qaytarish partiyani QAYTA OCHADI; bekor qilingan buyurtma
//       esa partiyani butunlay yo'q qiladi.
//   §6  QAMROV. AGENT o'z mijozini ko'radi, begonasini — 403. Yo'q mijoz — 404.
//
// Run (izolyatsiyalangan baza, dev ma'lumotiga TEGMAYDI):
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   DATABASE_URL=…smartblok_test node test/_reset-data.mjs && node test/pallet-origins.e2e.mjs
const BASE = process.env.API_URL || 'http://localhost:4100/api';

let failures = 0;
let checks = 0;
const num = (v) => (v == null ? 0 : Number(v));
const eq = (actual, expected, label) => {
  checks++;
  if (Math.abs(num(actual) - num(expected)) > 0.01) {
    failures++;
    console.error(`  ✗ ${label}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`  ✓ ${label} = ${expected}`);
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
    console.error(`  ✗ ${method} ${path} FAILED ${res.status}: ${text.slice(0, 250)}`);
  }
  return { status: res.status, body: json };
}

async function login(username, password) {
  for (let attempt = 0; attempt < 3; attempt++) {
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
  console.error(`  ✗ FATAL: could not log in as ${username}`);
  process.exit(1);
}

async function main() {
  console.log('— login —');
  const admin = await login('admin', 'admin123');
  const agentTok = await login('jamol', 'agent123');

  // /agents xom MASSIV qaytaradi (sahifalanmagan) — `?.items` u yerda undefined bo'ladi
  const agentsRes = (await req('GET', '/agents', undefined, admin)).body;
  const agents = Array.isArray(agentsRes) ? agentsRes : (agentsRes?.items ?? []);
  const jamol = agents.find((a) => a.name === 'Жамол') || agents[0];
  ok(!!jamol, 'seeded agent present');

  console.log('— katalog —');
  const factory = (await req('POST', '/factories', { name: 'Origins Zavod' }, admin, 201)).body;
  const product = (
    await req('POST', '/products', {
      factoryId: factory.id, name: 'Origins Blok', m3PerPallet: 1.728,
      priceFactoryCash: 600000, priceFactoryBank: 625000, pricesEffectiveFrom: '2026-07-01',
    }, admin, 201)
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
  const A = await mkClient('Origins Mijoz');          // asosiy stsenariy
  const X = await mkClient('Origins Begona', false);  // agentsiz — jamol uchun ko'rinmaydi

  const mkOrder = async (client, pallets, date) =>
    (
      await req('POST', '/orders', {
        clientId: client.id, date, transportMode: 'CLIENT_OWN',
        items: [{ productId: product.id, palletCount: pallets }],
      }, admin, 201)
    ).body;

  const origins = async (clientId, token = admin, expect) =>
    (await req('GET', `/pallets/clients/${clientId}/origins`, undefined, token, expect)).body;
  const lotOf = (o, orderNo) => (o?.lots ?? []).find((l) => l.orderNo === orderNo);

  /** KAFOLAT: ustunlar qoldiqqa tushadi — panel kartochka bilan hech qachon bahslashmaydi. */
  const closes = (o, at) => {
    const sum = (o?.lots ?? []).reduce((a, l) => a + l.outstanding, 0) + num(o?.unassigned);
    eq(sum, o?.balance, `Σ(qarz) + manbasiz === qoldiq (${at})`);
  };

  // ══════════ 1) FIFO: eng eski buyurtma birinchi yopiladi ══════════
  console.log('\n— 1) uch buyurtma, 10 dona qaytarildi ⇒ eng eskisi yopiladi —');
  const o1 = await mkOrder(A, 10, '2026-07-10');
  const o2 = await mkOrder(A, 8, '2026-07-15');
  const o3 = await mkOrder(A, 7, '2026-07-20');
  await req('POST', '/pallets/client-return', { clientId: A.id, qty: 10, date: '2026-07-22' }, admin, 201);
  {
    const o = await origins(A.id);
    eq(o.balance, 15, 'qoldiq 15 dona');
    eq(o.openLots, 2, 'ikkita ochiq partiya');
    eq(o.settledLots, 1, 'bitta partiya to`liq yopilgan');
    ok(!lotOf(o, o1.orderNo), 'eng eski buyurtma ro`yxatdan chiqdi (to`liq qaytgan)');
    eq(lotOf(o, o2.orderNo)?.outstanding, 8, `${o2.orderNo}: 8 dona qarz`);
    eq(lotOf(o, o3.orderNo)?.outstanding, 7, `${o3.orderNo}: 7 dona qarz`);
    eq(o.unassigned, 0, 'manbasiz qoldiq yo`q');
    eq(o.cancelledOutstanding, 0, 'bekor qilingan buyurtmada osilgan paddon yo`q');
    ok((o.lots ?? []).every((l) => l.importBatchId == null), 'qo`lda kiritilgan buyurtmada import yorlig`i yo`q');
    closes(o, 'FIFO dan keyin');
  }

  // ══════════ 2) qatorda BUYURTMA ko'rsatilgan bo'lsa — o'sha partiya ══════════
  console.log('\n— 2) qaytarish AYNAN uchinchi buyurtmaga yozildi —');
  await req(
    'POST', '/pallets/client-return',
    { clientId: A.id, qty: 5, date: '2026-07-25', orderId: o3.id },
    admin, 201,
  );
  {
    const o = await origins(A.id);
    eq(lotOf(o, o2.orderNo)?.outstanding, 8, `${o2.orderNo}: tegilmadi (FIFO bo'lganda 8→3 bo'lardi)`);
    eq(lotOf(o, o3.orderNo)?.outstanding, 2, `${o3.orderNo}: 7 − 5 = 2`);
    eq(lotOf(o, o3.orderNo)?.returned, 5, `${o3.orderNo}: qaytargani 5 deb yozildi`);
    closes(o, 'ko`rsatilgan buyurtmadan keyin');
  }

  // ══════════ 3) undirish ham partiyani yopadi ══════════
  console.log('\n— 3) 3 dona yo`qotilgan deb undirildi —');
  await req('POST', '/pallets/charge-lost', { clientId: A.id, qty: 3, date: '2026-07-26' }, admin, 201);
  {
    const o = await origins(A.id);
    eq(o.balance, 7, 'qoldiq 10 − 3 = 7');
    eq(lotOf(o, o2.orderNo)?.chargedLost, 3, `${o2.orderNo}: undirilgani alohida ustunda`);
    eq(lotOf(o, o2.orderNo)?.outstanding, 5, `${o2.orderNo}: 8 − 3 = 5`);
    closes(o, 'undirishdan keyin');
  }

  // ══════════ 4) qaytarishni bekor qilish partiyani QAYTA OCHADI ══════════
  console.log('\n— 4) o`sha 5 donalik qaytarish bekor qilindi —');
  {
    const rows = (await req('GET', `/pallets/transactions?clientId=${A.id}&pageSize=100`, undefined, admin)).body?.items ?? [];
    const ret5 = rows.find((r) => r.type === 'RETURNED_BY_CLIENT' && r.qty === 5);
    ok(!!ret5, 'qaytarish qatori topildi');
    await req('POST', `/pallets/transactions/${ret5.id}/reverse`, { reason: 'boshqa mijozdan olingan ekan' }, admin, 201);
    const o = await origins(A.id);
    eq(o.balance, 12, 'qoldiq 7 + 5 = 12');
    eq(lotOf(o, o3.orderNo)?.outstanding, 7, `${o3.orderNo}: partiya qayta ochildi (2 → 7)`);
    eq(lotOf(o, o3.orderNo)?.returned, 0, `${o3.orderNo}: qaytargani ham 0 ga qaytdi`);
    closes(o, 'qaytarish stornosidan keyin');
  }

  // ══════════ 5) buyurtma bekor qilinsa — partiya butunlay yo'qoladi ══════════
  console.log('\n— 5) uchinchi buyurtma bekor qilindi —');
  await req('DELETE', `/orders/${o3.id}`, { reason: 'origins test' }, admin, 200);
  {
    const o = await origins(A.id);
    ok(!lotOf(o, o3.orderNo), 'bekor qilingan buyurtma partiyasi ro`yxatda YO`Q');
    eq(o.cancelledOutstanding, 0, 'bekor qilingan buyurtmada osilgan paddon yo`q');
    closes(o, 'buyurtma bekor qilingandan keyin');
  }

  // ══════════ 6) qamrov ══════════
  console.log('\n— 6) rollar va agent qamrovi —');
  {
    const own = await origins(A.id, agentTok, 200);
    ok(Array.isArray(own?.lots), 'AGENT o`z mijozining partiyalarini ko`radi');
    await origins(X.id, agentTok, 403);
    await req('GET', '/pallets/clients/00000000-0000-0000-0000-000000000000/origins', undefined, admin, 404);
  }

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
