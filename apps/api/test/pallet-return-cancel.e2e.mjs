// MIJOZ TOMONIDAGI PADDON HARAKATINI BEKOR QILISH (storno) E2E.
//
// Egasi ikki xil xatoni tuzatishni so'radi va ikkalasi ham BITTA endpoint orqali ketadi
// (POST /pallets/transactions/:id/reverse):
//   · 2026-08-01 — «bitta mijozdan paddon oldik, keyin qarasak bu boshqa mijoz ekan»:
//     noto'g'ri RETURNED_BY_CLIENT qatori bekor qilinadi, paddon O'SHA mijozda qoladi;
//   · 2026-08-04 — «yo'qolgan deb undirdik, keyin paddon topildi» (yoki xato mijozdan
//     undirildi): CHARGED_LOST qatori bekor qilinadi va PUL ham qaytadi — undirish yozgan
//     CLIENT ledger qatori (PALLET_CHARGE) stornolanadi.
//
// Bu oqim jim turib daftarni buzishi mumkin bo'lgan joylarni qamraydi, har biri o'z bo'limi:
//
//   §3  IMZO. REVERSAL ning qty'si — signed BALANS deltasi. Qaytarish balansga minus bilan
//       kirgani uchun stornosi +qty bo'lishi shart. Belgi teskari bo'lsa «jami qaytargan»
//       kamayish o'rniga IKKI BARAVAR oshadi (4 → 8), qoldiq esa manfiyga tushadi.
//   §4  Ikki marta bekor qilish. `reversalOfId` UNIQUE — rad javobi qaytargan bo'lsa-yu,
//       qator yozib ulgurgan bo'lsa, bu «rad qilmagan» bilan bir xil xato.
//   §6  ZAXIRA CHEGARASI. Qaytarishni bekor qilish paddonni diller qo'lidagi bo'sh zaxiradan
//       OLADI. Zavodga jo'natib bo'lingan bo'lsa, zaxira manfiyga tushib, keyingi zavodga
//       qaytarish chegarasini (returnToFactory) buzardi. §6b chegarani AYNAN sinaydi.
//   §8  BEKOR QILINGAN BUYURTMA. Buyurtma stornosi mijoz O'SHA PAYTDA ushlab turgan songa
//       qadar qirqiladi. Qaytarishni yo'qqa chiqarish o'sha sonni oshiradi, demak qirqilgan
//       storno davom etishi shart — aks holda bekor qilingan buyurtmaning paddoni mijoz
//       kartochkasida tirilib qolardi. Konservatsiya tenglamasi buni KO'RMAYDI (ikkala
//       tomon teng siljiydi), shuning uchun bu yerda ataylab alohida tekshiriladi.
//   §9  QAMROV. AGENT o'z mijozining qatorini bekor qiladi (u yozgan — u tuzatadi), begonasi
//       esa 403. Ochilmagan rol darvozasi bilan begonani o'tkazib yuborgan qamrov — bitta xato.
//   §11 UNDIRISHNI BEKOR QILISH. Uchta jim xato shu yerda ushlanadi:
//       (a) PUL qaytmasa, mijoz to'lamagan qarz bilan qolib ketadi;
//       (b) «Yo'qotilgan» SONI 0 ga tushib, PULI («chargedLostAmount») o'sha joyda qolsa,
//           ekran «0 dona (260 000 so'm)» deb yolg'on gapiradi — storno qatorida narx yo'q,
//           shuning uchun summa ASL qatordan ayirilishi shart (pallet-stats.ts);
//       (c) AGENT pul amalini bekor qila olmaydi (undirishning o'zi ham unga yopiq).
//   §12 UNDIRISH + BEKOR QILINGAN BUYURTMA — §8 ning pul tomonidagi egizagi.
//
// Run (izolyatsiyalangan baza, dev ma'lumotiga TEGMAYDI):
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx prisma migrate deploy
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   node test/_reset-data.mjs && node test/pallet-return-cancel.e2e.mjs
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
/** String equality — SANALAR uchun har doim shu, eq() emas (Number('2026-07-20') = NaN). */
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
      console.error(`  ✗ ${method} ${path} → ${res.status} (expected ${expectStatus}): ${text.slice(0, 220)}`);
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
const today = new Date().toISOString().slice(0, 10);

/** Login, waiting out the 5-attempts/min brake. Token yo'qligi — FATAL. */
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
  console.error(`  ✗ FATAL: could not log in as ${username} — every later assertion would be meaningless`);
  process.exit(1);
}

async function main() {
  console.log('— login —');
  // ATAYLAB 4 ta: /auth/login daqiqasiga 5 marta. Beshinchisi butun to'plamni 429 ga tiqardi.
  const admin = await login('admin', 'admin123');
  const agentTok = await login('jamol', 'agent123');
  const acc = await login('hisob', 'hisob123');
  const cashier = await login('kassa', 'kassa123');
  ok(!!admin && !!agentTok && !!acc && !!cashier, 'admin + agent + buxgalter + kassir loginlari');

  const agents = items((await req('GET', '/agents', undefined, admin)).body);
  const jamol = agents.find((a) => a.name === 'Жамол') || agents[0];
  ok(!!jamol, 'seeded agent present');

  console.log('— o`z katalogi (yangi zavod + mahsulot ⇒ MUTLAQ kutilmalar) —');
  const factory = (await req('POST', '/factories', { name: 'P-Cancel Zavod' }, admin, 201)).body;
  const product = (
    await req('POST', '/products', {
      factoryId: factory.id, name: 'P-Cancel Blok', m3PerPallet: 1.728,
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
  const A = await mkClient('P-Cancel Xato');     // qaytarish xato yozilgan mijoz
  const Z = await mkClient('P-Cancel Togri');    // haqiqiy qaytargan mijoz
  const Q = await mkClient('P-Cancel Chegara');  // zaxira chegarasi
  const Y = await mkClient('P-Cancel Bekor');    // bekor qilingan buyurtma
  const W = await mkClient('P-Cancel Undirish'); // undirish bekor qilinadi (§11)
  const V = await mkClient('P-Cancel Undirish2');// undirish + bekor qilingan buyurtma (§12)
  const X = await mkClient('P-Cancel Begona', false); // agentsiz — jamol uchun ko'rinmaydi

  const mkOrder = async (client, pallets, date) =>
    (
      await req('POST', '/orders', {
        clientId: client.id, date, transportMode: 'CLIENT_OWN',
        items: [{ productId: product.id, palletCount: pallets }],
      }, admin, 201)
    ).body;

  const balances = async (token) => {
    if (!token) throw new Error('balances() tokensiz chaqirildi — rol qamrovi tekshirilmay qoladi');
    return (await req('GET', '/pallets/balances', undefined, token)).body;
  };
  const clientRow = (bal, id) => bal.clients.find((r) => r.client.id === id);
  const factoryRow = (bal, id) => (bal.factories ?? []).find((r) => r.factory.id === id);
  const cStats = (bal, id) => clientRow(bal, id)?.stats ?? {};
  const fStats = (bal, id) => factoryRow(bal, id)?.stats ?? {};
  const journal = async (clientId, token = admin) =>
    items((await req('GET', `/pallets/transactions?clientId=${clientId}&pageSize=100`, undefined, token)).body);

  const base = await balances(admin);
  const baseInHand = num(base.dealerInHand);
  const inHand = (bal) => num(bal.dealerInHand) - baseInHand;

  /** zavodga qarz = mijozlarda + qo'limizda + yo'qotilgan — modelning tayanchi */
  const conserved = (bal, at) => {
    const t = bal.totals;
    eq(t.drift, 0, `drift 0 (${at})`);
    eq(
      t.factory.balance,
      t.client.balance + num(bal.dealerInHand) + t.client.chargedLost,
      `zavodga qarz = mijozlarda + qo'limizda + yo'qotilgan (${at})`,
    );
  };

  const cancel = (id, token, expect, reason = 'paddon boshqa mijozdan olingan ekan') =>
    req('POST', `/pallets/transactions/${id}/reverse`, { reason }, token, expect);

  // ══════════ 1) buyurtmalar ══════════
  console.log('\n— 1) A ga 10, Z ga 4 dona yuborildi —');
  await mkOrder(A, 10, '2026-07-20');
  await mkOrder(Z, 4, '2026-07-20');
  let bal = await balances(admin);
  eq(cStats(bal, A.id).received, 10, 'A: jami berilgan 10');
  eq(cStats(bal, A.id).balance, 10, 'A: hozir mijozda 10');
  eq(cStats(bal, Z.id).balance, 4, 'Z: hozir mijozda 4');
  eq(fStats(bal, factory.id).balance, 14, 'Zavod: hozir qarzmiz 14');
  eq(inHand(bal), 0, "diller qo'lida 0");
  conserved(bal, 'buyurtmalardan keyin');

  // ══════════ 2) XATO: qaytarish noto'g'ri mijozga yozildi ══════════
  console.log('\n— 2) 4 dona qaytarish XATO mijozga (A) yozildi —');
  const wrongReturn = (
    await req('POST', '/pallets/client-return', { clientId: A.id, qty: 4, date: '2026-07-21' }, admin, 201)
  ).body;
  ok(!!wrongReturn?.id, 'qaytarish qatori id bilan qaytdi');
  bal = await balances(admin);
  eq(cStats(bal, A.id).returned, 4, 'A: qaytargan 4');
  eq(cStats(bal, A.id).balance, 6, 'A: hozir mijozda 6');
  eq(inHand(bal), 4, "diller qo'lida 4");
  conserved(bal, 'xato qaytarishdan keyin');

  // ══════════ 3) BEKOR QILISH — imzo, katak va sana semantikasi ══════════
  console.log('\n— 3) qaytarishni bekor qilish: paddon A da QOLADI —');
  const cancelled = await cancel(wrongReturn.id, admin, 201);
  eq(cancelled.body?.qty, 4, 'storno qatorining qty si +4 (MUSBAT — balans deltasi)');
  is(cancelled.body?.type, 'REVERSAL', 'storno turi REVERSAL');
  is(cancelled.body?.reversalOfId, wrongReturn.id, 'storno asl qatorga bog`landi');
  eq(cancelled.body?.clientPalletBalance, 10, 'javob mijozning yakuniy qoldig`ini aytadi (10)');
  ok(cancelled.body?.factoryId == null, 'stornoda zavod YO`Q (mijoz qaytarishi zavodga tegmaydi)');

  bal = await balances(admin);
  // SOF: storno «qaytargan» katagiga qaytib AYRILADI — sodda yig'ish uni 8 qilardi
  eq(cStats(bal, A.id).returned, 0, 'A: jami qaytargan 0 (SOF — 8 emas!)');
  eq(cStats(bal, A.id).received, 10, 'A: jami berilgan tegilmadi (10)');
  eq(cStats(bal, A.id).adjustment, 0, 'A: storno «tuzatish» katagiga tushmadi');
  eq(cStats(bal, A.id).balance, 10, 'A: hozir mijozda yana 10');
  eq(cStats(bal, A.id).movements, 3, 'A: 3 qator (berildi + qaytardi + storno)');
  eq(inHand(bal), 0, "diller qo'lidagi zaxira 4→0 (paddon mijozda qoldi)");
  eq(fStats(bal, factory.id).received, 14, 'Zavod: jami oldik tegilmadi');
  eq(fStats(bal, factory.id).returned, 0, 'Zavod: qaytardik 0');
  eq(fStats(bal, factory.id).balance, 14, 'Zavod: qarzimiz 14 — bekor qilish zavodga tegmadi');
  eq(cStats(bal, Z.id).balance, 4, 'Z: boshqa mijoz tegilmadi');
  is(day(cStats(bal, A.id).lastMovementAt), today, 'A: oxirgi harakat = storno sanasi (bugun)');
  conserved(bal, 'bekor qilingandan keyin');

  {
    const rows = await journal(A.id);
    eq(rows.length, 3, 'A jurnalida 3 qator (hech nima o`chirilmadi)');
    const src = rows.find((r) => r.id === wrongReturn.id);
    const rev = rows.find((r) => r.type === 'REVERSAL');
    ok(!!src?.reversedBy, 'asl qator server javobida «bekor qilingan» deb belgilangan');
    is(src?.reversedBy?.id, rev?.id, 'reversedBy AYNAN o`sha storno qatoriga ishora qiladi');
    is(rev?.reversalOf?.type, 'RETURNED_BY_CLIENT', 'storno qatori nimani bekor qilganini aytadi');
    is(rev?.note, 'paddon boshqa mijozdan olingan ekan', 'sabab storno izohida saqlandi');
  }

  // ══════════ 4) ikki marta bekor qilib bo'lmaydi ══════════
  console.log('\n— 4) ikkinchi marta bekor qilish RAD etiladi va hech nima yozmaydi —');
  await cancel(wrongReturn.id, admin, 400);
  bal = await balances(admin);
  eq(cStats(bal, A.id).balance, 10, 'A: qoldiq qimirlamadi (14 bo`lib ketmadi)');
  eq(cStats(bal, A.id).movements, 3, 'A: qator soni ham qimirlamadi');
  eq(inHand(bal), 0, "zaxira ham qimirlamadi");
  conserved(bal, 'takroriy raddan keyin');

  // ══════════ 5) egasining hikoyasi oxirigacha: to'g'ri mijozga qayta yozish ══════════
  console.log('\n— 5) o`sha 4 dona TO`G`RI mijozga (Z) yoziladi —');
  await req('POST', '/pallets/client-return', { clientId: Z.id, qty: 4, date: '2026-07-21' }, admin, 201);
  bal = await balances(admin);
  eq(cStats(bal, Z.id).returned, 4, 'Z: qaytargan 4');
  eq(cStats(bal, Z.id).balance, 0, 'Z: hozir mijozda 0');
  eq(cStats(bal, A.id).balance, 10, 'A: tegilmadi (10)');
  eq(inHand(bal), 4, "diller qo'lida yana 4 — paddon o`z egasining hisobidan chiqdi");
  eq(fStats(bal, factory.id).balance, 14, 'Zavod: butun amaliyot davomida qimirlamadi');
  conserved(bal, 'to`g`ri mijozga yozgandan keyin');

  // ══════════ 6) zavodga jo'natilgan paddonni qaytarib bo'lmaydi ══════════
  console.log('\n— 6) zavodga 4 dona jo`natildi ⇒ Z ning qaytarishini bekor qilib bo`lmaydi —');
  await req('POST', '/pallets/factory-return', { factoryId: factory.id, qty: 4, date: '2026-07-22' }, admin, 201);
  bal = await balances(admin);
  eq(inHand(bal), 0, "zaxira 0 — paddon zavodga ketdi");
  const zReturn = (await journal(Z.id)).find((r) => r.type === 'RETURNED_BY_CLIENT');
  ok(!!zReturn, 'Z ning qaytarish qatori topildi');
  const refused = await cancel(zReturn.id, admin, 400);
  ok(
    typeof refused.body?.message === 'string' && refused.body.message.includes('zavodga'),
    'xato matni sababni aytadi (zavodga jo`natilgan)',
  );
  bal = await balances(admin);
  eq(cStats(bal, Z.id).returned, 4, 'Z: qaytargan 4 — rad javobi hech nima yozmadi');
  eq(fStats(bal, factory.id).returned, 4, 'Zavod: qaytardik 4');
  eq(inHand(bal), 0, "zaxira 0 — manfiyga tushmadi");
  conserved(bal, 'raddan keyin');

  // ══════════ 6b) chegara AYNAN: qty == zaxira o'tadi, qty > zaxira o'tmaydi ══════════
  console.log('\n— 6b) chegara: 3 == zaxira ⇒ o`tadi · keyingisi 3 > 0 ⇒ o`tmaydi —');
  await mkOrder(Q, 6, '2026-07-20');
  const q1 = (await req('POST', '/pallets/client-return', { clientId: Q.id, qty: 3, date: '2026-07-21' }, admin, 201)).body;
  const q2 = (await req('POST', '/pallets/client-return', { clientId: Q.id, qty: 3, date: '2026-07-21' }, admin, 201)).body;
  await req('POST', '/pallets/factory-return', { factoryId: factory.id, qty: 3, date: '2026-07-22' }, admin, 201);
  bal = await balances(admin);
  eq(inHand(bal), 3, "chegaradan oldin zaxira 3");
  await cancel(q1.id, admin, 201); // 3 == 3 — chegara INKLYUZIV
  bal = await balances(admin);
  eq(cStats(bal, Q.id).returned, 3, 'Q: qaytargan 6→3');
  eq(cStats(bal, Q.id).balance, 3, 'Q: mijozda 3');
  eq(inHand(bal), 0, "zaxira 0 ga tushdi");
  await cancel(q2.id, admin, 400); // 3 > 0 — endi mumkin emas
  bal = await balances(admin);
  eq(cStats(bal, Q.id).returned, 3, 'Q: ikkinchi rad hech nima yozmadi');
  eq(inHand(bal), 0, "zaxira hamon 0");
  conserved(bal, 'chegaradan keyin');

  // ══════════ 7) faqat MIJOZ TOMONIDAGI ikki tur bekor qilinadi ══════════
  console.log('\n— 7) buyurtma/zavod/storno qatorlari RAD etiladi —');
  {
    const aRows = await journal(A.id);
    const delivered = aRows.find((r) => r.type === 'DELIVERED_TO_CLIENT');
    const reversal = aRows.find((r) => r.type === 'REVERSAL');
    await cancel(delivered.id, admin, 400);              // buyurtmadan kelgan qator
    await cancel(reversal.id, admin, 400);               // stornoning o'zi
    const fRows = items((await req('GET', `/pallets/transactions?factoryId=${factory.id}&pageSize=100`, undefined, admin)).body);
    await cancel(fRows.find((r) => r.type === 'RECEIVED_FROM_FACTORY').id, admin, 400);
    await cancel(fRows.find((r) => r.type === 'RETURNED_TO_FACTORY').id, admin, 400);

    // A ga undirish YOZILADI va shu holicha QOLDIRILADI — quyidagi bo'limlar aynan shu
    // «undirilgan 2» holatiga tayanadi. Undirishni bekor qilishning O'ZI §11 da, alohida
    // mijozda sinaladi (u yerda oldingi/keyingi raqamlar aralashmaydi).
    const moneyBefore = num((await req('GET', `/clients/${A.id}`, undefined, admin)).body.balance);
    await req('POST', '/pallets/charge-lost', { clientId: A.id, qty: 2, date: '2026-07-23', unitPrice: 130000 }, admin, 201);
    const card = (await req('GET', `/clients/${A.id}`, undefined, admin)).body;
    eq(num(card.balance) - moneyBefore, 260000, 'A: undirish mijozga 260 000 qarz yozdi');

    await cancel('00000000-0000-4000-8000-000000000000', admin, 404); // yo'q qator
    await cancel('not-a-uuid', admin, 400);                            // noto'g'ri id
    await req('POST', `/pallets/transactions/${q2.id}/reverse`, { reason: '' }, admin, 400); // sababsiz
    await req('POST', `/pallets/transactions/${q2.id}/reverse`, {}, admin, 400);

    bal = await balances(admin);
    eq(cStats(bal, A.id).balance, 8, 'A: 10 − 2 undirilgan = 8 (raddlar hech nima o`zgartirmadi)');
    eq(cStats(bal, A.id).chargedLost, 2, 'A: undirilgan 2');
    eq(cStats(bal, A.id).chargedLostAmount, 260000, 'A: undirilgan puli 260 000');
    conserved(bal, 'raddlar to`plamidan keyin');
  }

  // ══════════ 8) BEKOR QILINGAN BUYURTMA: qirqilgan storno DAVOM ETADI ══════════
  console.log('\n— 8) bekor qilingan buyurtmaning paddoni TIRILMAYDI —');
  {
    const orderY = await mkOrder(Y, 5, '2026-07-20');
    const yReturn = (
      await req('POST', '/pallets/client-return', { clientId: Y.id, qty: 5, date: '2026-07-21' }, admin, 201)
    ).body;
    bal = await balances(admin);
    eq(cStats(bal, Y.id).balance, 0, 'Y: hammasini qaytardi ⇒ 0');
    eq(inHand(bal), 5, "zaxirada 5");

    // Mijozda 0 qolgani uchun buyurtma stornosi HECH NIMA yozmaydi (allowance = 0)
    await req('DELETE', `/orders/${orderY.id}`, { reason: 'paddon storno testi' }, admin, 200);
    bal = await balances(admin);
    eq(cStats(bal, Y.id).received, 5, 'Y: qirqilgan storno tufayli «jami berilgan» hamon 5');
    eq(cStats(bal, Y.id).balance, 0, 'Y: qoldiq 0');

    // …va endi qaytarish yo'qqa chiqariladi: qirqilgan storno DAVOM ETISHI shart
    await cancel(yReturn.id, admin, 201);
    bal = await balances(admin);
    eq(cStats(bal, Y.id).received, 0, 'Y: bekor qilingan buyurtmaning paddoni «jami berilgan» dan chiqdi');
    eq(cStats(bal, Y.id).returned, 0, 'Y: jami qaytargan ham 0');
    eq(cStats(bal, Y.id).balance, 0, 'Y: mijozda 0 — bekor qilingan buyurtma paddoni TIRILMADI');
    eq(cStats(bal, Y.id).adjustment, 0, 'Y: tuzatish katagi bo`sh');
    eq(inHand(bal), 0, "zaxira 0 ga qaytdi");
    conserved(bal, 'bekor qilingan buyurtma holatidan keyin');
  }

  // ══════════ 9) QAMROV: kim bekor qila oladi ══════════
  console.log('\n— 9) rollar va agent qamrovi —');
  {
    // AGENT o'z mijozining qatorini yozadi VA bekor qiladi
    const own = (
      await req('POST', '/pallets/client-return', { clientId: A.id, qty: 2, date: '2026-07-24' }, agentTok, 201)
    ).body;
    await cancel(own.id, agentTok, 201);
    bal = await balances(admin);
    eq(cStats(bal, A.id).returned, 0, 'A: agent o`z yozganini bekor qildi');
    eq(cStats(bal, A.id).balance, 8, 'A: qoldiq 8 ga qaytdi');

    // begona mijoz — 403, va HECH NIMA yozilmaydi
    await mkOrder(X, 3, '2026-07-20');
    const foreign = (
      await req('POST', '/pallets/client-return', { clientId: X.id, qty: 2, date: '2026-07-21' }, admin, 201)
    ).body;
    await cancel(foreign.id, agentTok, 403);
    bal = await balances(admin);
    eq(cStats(bal, X.id).returned, 2, 'X: begona qaytarish joyida qoldi (403 RAD, storno emas)');
    eq(cStats(bal, X.id).movements, 2, 'X: qator soni o`zgarmadi');

    // yo'q qator agent uchun ham 404 (403 emas — u hech kimga tegishli emas)
    await cancel('00000000-0000-4000-8000-000000000001', agentTok, 404);
    // KASSIR umuman kirolmaydi, BUXGALTER esa kiradi
    await cancel(foreign.id, cashier, 403);
    await cancel(foreign.id, acc, 201);
    bal = await balances(admin);
    eq(cStats(bal, X.id).returned, 0, 'X: buxgalter bekor qildi');

    // AGENT o'z mijozining UNDIRISH qatorini bekor qila OLMAYDI: u PUL yechadi, va
    // undirishning O'ZI ham agentga yopiq (pallets.mutate = A·B). Mijoz «o'ziniki»
    // bo'lgani uchun `assertOwnAgent` o'tkazib yuboradi — darvoza aynan tur bo'yicha.
    const aLost = (await journal(A.id)).find((r) => r.type === 'CHARGED_LOST');
    ok(!!aLost, 'A ning undirish qatori topildi');
    await cancel(aLost.id, agentTok, 403);
    bal = await balances(admin);
    eq(cStats(bal, A.id).chargedLost, 2, 'A: agentning raddi undirishga tegmadi');
    eq(cStats(bal, A.id).chargedLostAmount, 260000, 'A: undirilgan puli ham joyida');
    conserved(bal, 'qamrov bo`limidan keyin');
  }

  // ══════════ 11) UNDIRISHNI BEKOR QILISH: paddon ham, PUL ham qaytadi ══════════
  console.log('\n— 11) undirishni bekor qilish: qarz yechiladi, paddon mijozga qaytadi —');
  {
    await mkOrder(W, 4, '2026-07-20');
    const moneyBefore = num((await req('GET', `/clients/${W.id}`, undefined, admin)).body.balance);
    const lost = (
      await req('POST', '/pallets/charge-lost', { clientId: W.id, qty: 2, date: '2026-07-23', unitPrice: 100000 }, admin, 201)
    ).body;
    bal = await balances(admin);
    eq(cStats(bal, W.id).chargedLost, 2, 'W: undirilgan 2 dona');
    eq(cStats(bal, W.id).chargedLostAmount, 200000, 'W: undirilgan puli 200 000');
    eq(cStats(bal, W.id).balance, 2, 'W: mijozda 4 − 2 = 2');
    eq(num((await req('GET', `/clients/${W.id}`, undefined, admin)).body.balance) - moneyBefore, 200000,
      'W: pul qarzi 200 000 ga oshdi');
    conserved(bal, 'undirishdan keyin');

    // …va bekor qilinadi
    const undone = await cancel(lost.id, admin, 201, 'paddon topildi');
    is(undone.body?.type, 'REVERSAL', 'storno turi REVERSAL');
    is(undone.body?.reversedKind, 'CHARGE', 'javob nima bekor qilinganini aytadi');
    eq(undone.body?.qty, 2, 'storno qty si +2 (MUSBAT — balans deltasi)');
    eq(undone.body?.reversedAmount, 200000, 'javob qarzdan yechilgan summani aytadi');
    eq(undone.body?.clientPalletBalance, 4, 'javob yakuniy paddon qoldig`ini aytadi (4)');
    ok(undone.body?.unitPrice == null, 'storno qatorida NARX yo`q (aks holda pul ikki marta sanalardi)');

    bal = await balances(admin);
    // ⚠ ENG MUHIM IKKI QATOR: son ham, PUL ham birga qaytadi. Ilgari storno qatorida narx
    // bo'lmagani uchun «0 dona (200 000 so'm)» degan yolg'on qolib ketardi.
    eq(cStats(bal, W.id).chargedLost, 0, 'W: yo`qotilgan 0 ga tushdi');
    eq(cStats(bal, W.id).chargedLostAmount, 0, 'W: yo`qotilgan PULI ham 0 ga tushdi');
    eq(cStats(bal, W.id).balance, 4, 'W: paddon mijozga qaytdi (4)');
    eq(cStats(bal, W.id).received, 4, 'W: jami berilgan tegilmadi');
    eq(cStats(bal, W.id).returned, 0, 'W: «qaytargan» katagi bo`sh (undirish u yerga tushmaydi)');
    eq(cStats(bal, W.id).adjustment, 0, 'W: «tuzatish» katagi ham bo`sh');
    eq(num((await req('GET', `/clients/${W.id}`, undefined, admin)).body.balance), moneyBefore,
      'W: PUL qarzi undirishdan oldingi holatga qaytdi');
    eq(inHand(bal), 0, "diller zaxirasi qimirlamadi (yo`qolgan paddon qo`limizga qaytmagan edi)");
    conserved(bal, 'undirish bekor qilingandan keyin');

    {
      const rows = await journal(W.id);
      const src = rows.find((r) => r.id === lost.id);
      const rev = rows.find((r) => r.type === 'REVERSAL');
      ok(!!src?.reversedBy, 'undirish qatori «bekor qilingan» deb belgilandi');
      is(rev?.reversalOf?.type, 'CHARGED_LOST', 'storno nimani bekor qilganini aytadi');
      is(rev?.note, 'paddon topildi', 'sabab storno izohida saqlandi');
    }

    // ikki marta bo'lmaydi — va rad javobi hech nima yozmaydi
    await cancel(lost.id, admin, 400);
    bal = await balances(admin);
    eq(cStats(bal, W.id).balance, 4, 'W: takroriy rad qoldiqni qimirlatmadi');
    eq(num((await req('GET', `/clients/${W.id}`, undefined, admin)).body.balance), moneyBefore,
      'W: takroriy rad pulni ham qimirlatmadi');
    conserved(bal, 'takroriy raddan keyin');
  }

  // ══════════ 12) UNDIRISH + BEKOR QILINGAN BUYURTMA ══════════
  console.log('\n— 12) undirish bekor qilinganda ham bekor buyurtma paddoni TIRILMAYDI —');
  {
    const orderV = await mkOrder(V, 5, '2026-07-20');
    const lostV = (
      await req('POST', '/pallets/charge-lost', { clientId: V.id, qty: 5, date: '2026-07-23', unitPrice: 100000 }, admin, 201)
    ).body;
    bal = await balances(admin);
    eq(cStats(bal, V.id).balance, 0, 'V: hammasi yo`qolgan deb undirildi ⇒ mijozda 0');

    // Mijozda 0 qolgani uchun buyurtma stornosi HECH NIMA yozmaydi (allowance = 0)
    await req('DELETE', `/orders/${orderV.id}`, { reason: 'undirish storno testi' }, admin, 200);
    bal = await balances(admin);
    eq(cStats(bal, V.id).received, 5, 'V: qirqilgan storno tufayli «jami berilgan» hamon 5');

    // …va endi undirish yo'qqa chiqariladi: qirqilgan storno DAVOM ETISHI shart
    await cancel(lostV.id, admin, 201, 'buyurtma ham bekor qilingan edi');
    bal = await balances(admin);
    eq(cStats(bal, V.id).received, 0, 'V: bekor qilingan buyurtmaning paddoni «jami berilgan» dan chiqdi');
    eq(cStats(bal, V.id).chargedLost, 0, 'V: yo`qotilgan 0');
    eq(cStats(bal, V.id).chargedLostAmount, 0, 'V: yo`qotilgan puli ham 0');
    eq(cStats(bal, V.id).balance, 0, 'V: mijozda 0 — bekor qilingan buyurtma paddoni TIRILMADI');
    eq(cStats(bal, V.id).adjustment, 0, 'V: tuzatish katagi bo`sh');
    conserved(bal, 'undirish + bekor buyurtma holatidan keyin');
  }

  // ══════════ 13) yakuniy arifmetika ══════════
  console.log('\n— 13) har bir tomonda ayirma qoldiqqa tushadi —');
  {
    bal = await balances(admin);
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

    // kartochka va ro'yxat bitta raqamni aytadi
    const card = (await req('GET', `/clients/${A.id}`, undefined, admin)).body;
    eq(card.palletBalance, cStats(bal, A.id).balance, 'A: kartochka qoldig`i = ro`yxat qoldig`i');
    eq(card.palletStats?.returned, cStats(bal, A.id).returned, 'A: kartochka «qaytargan» = ro`yxatniki');
    conserved(bal, 'yakun');
  }

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
