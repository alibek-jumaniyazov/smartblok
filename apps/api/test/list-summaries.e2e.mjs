// Ro'yxat sahifalarining JADVAL TEPASIDAGI yakunlari — E2E.
//
// Egasining qoidasi (2026-07-26): «jami» raqamlar jadval tepasida turadi va HAR DOIM
// joriy filtrga tegishli bo'ladi. Shu yerda tekshiriladigan narsa:
//
//   S1  GET /orders → summary: savdo summasi butun FILTR bo'yicha (sahifa emas)
//   S2  bekor qilingan buyurtma HECH BIR yakunga kirmaydi (egasi qoidasi, 2026-07-28):
//       `sales`/`orders`/`cubeM3`/tannarx/foyda — hammasi faqat TIRIK buyurtmalar.
//       Qatori jadvalda ko'rinib turadi, `cancelledOrders` esa faqat SON (izoh uchun);
//       eski `cancelledSales`/`liveOrders` maydonlari umuman qaytmaydi.
//   S3  filtr (mijoz/zavod/sana) qo'yilganda summary ham torayadi
//   S4  sahifalash summary'ni QIMIRLATMAYDI (page=2 da ham xuddi shu raqam)
//   S5  GET /clients → summary: qarz/avans/sof + qarzdorlar soni, butun filtr bo'yicha
//   S6  GET /clients/:id → paymentTotals (olingan − qaytarilgan = sof), shofyorga
//       bergani ALOHIDA va jamiga qo'shilmaydi
//   S7  /kassa/transactions?clientId= — faqat shu mijozning kassa harakati; shofyorga
//       to'g'ridan-to'g'ri bergan puli u yerda YO'Q (kassadan o'tmagan)
//
// Ishga tushirish (API 4100 da turgan bo'lsin):
//   node test/list-summaries.e2e.mjs

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
  const factory = (factories.items ?? factories)[0];
  const products = (await req('GET', '/products?pageSize=50', undefined, admin, 200)).body;
  const product = (products.items ?? products).find((p) => p.name.includes('600x300x200'));
  ok(!!factory && !!product, 'seed zavodi va mahsuloti topildi');
  if (!product) return;

  const boxes = (await req('GET', '/kassa/cashboxes', undefined, admin, 200)).body;
  const cashBox = (boxes.items ?? boxes).find((b) => b.type === 'CASH' && b.currency === 'UZS');
  await req('POST', '/kassa/manual', {
    cashboxId: cashBox.id, direction: 'IN', amount: 500_000_000, date: '2026-07-26', note: 'test kapital',
  }, admin, 201);

  const clientA = (await req('POST', '/clients', { name: `Yakun A ${U}` }, admin, 201)).body;
  const clientB = (await req('POST', '/clients', { name: `Yakun B ${U}` }, admin, 201)).body;
  ok(!!clientA?.id && !!clientB?.id, 'ikkita test mijozi yaratildi');

  // zavod MAHSULOTdan kelib chiqadi — `factoryId` yuborilmaydi (DTO uni rad etadi)
  const mkOrder = async (clientId, m3, price, extra = {}) =>
    (await req('POST', '/orders', {
      clientId,
      date: '2026-07-26',
      factoryPayIntent: 'BANK',
      transportMode: 'CLIENT_OWN',
      items: [{ productId: product.id, quantityM3: m3, palletCount: 0, salePricePerM3: price }],
      ...extra,
    }, admin, 201)).body;

  // A: 10 m³ × 1 000 000 = 10 mln ; B: 4 m³ × 1 000 000 = 4 mln
  const o1 = await mkOrder(clientA.id, 10, 1_000_000);
  const o2 = await mkOrder(clientB.id, 4, 1_000_000);
  ok(!!o1?.id && !!o2?.id, 'ikkita buyurtma yaratildi');

  // ═══════════════ S1: savdo summasi butun filtr bo'yicha ═══════════════
  console.log('\n── S1: /orders summary ──');
  const listAll = async (qs = '') => (await req('GET', `/orders?pageSize=20${qs}`, undefined, admin, 200)).body;
  let list = await listAll();
  ok(!!list.summary, 'S1: javobda summary bloki bor');
  eq(list.summary.sales, 14_000_000, 'S1: savdo summasi = 10 + 4');
  ok(list.summary.orders === 2, 'S1: buyurtmalar soni 2');
  eq(list.summary.cubeM3, 14, 'S1: hajmi 14 m³');
  ok(list.summary.cancelledOrders === 0, 'S1: hali bekor qilingani yo‘q');
  ok(list.summary.cost != null, 'S1: ADMIN uchun tannarx keladi');
  // Bekor qilinganlarning PULI endi umuman qaytmaydi — maydonning o'zi yo'q.
  ok(!('cancelledSales' in list.summary), 'S1: `cancelledSales` maydoni olib tashlangan');

  // ═══════ S1b: QATORDAGI mahsulot va hajm (egasi so'rovi, 2026-07-28) ═══════
  // Ro'yxatdagi «Mahsulot» va «Hajm» ustunlarini shu ikki maydon oziqlantiradi.
  // Ikkalasi ham SERVERDA hisoblanadi — ekran pozitsiyalarni qo'shmasligi kerak.
  console.log('\n── S1b: qatordagi mahsulot + hajm ──');
  const rowOf = (l, id) => (l.items ?? []).find((r) => r.id === id);
  const r1 = rowOf(list, o1.id);
  ok(!!r1, 'S1b: 1-buyurtma qatori topildi');
  eq(r1?.cubeM3, 10, 'S1b: qatordagi hajm = 10 m³');
  ok(Array.isArray(r1?.products) && r1.products.length === 1, 'S1b: bitta mahsulot havolasi');
  ok(r1?.products?.[0]?.name === product.name, 'S1b: mahsulot NOMI qatorda keladi');
  ok(r1?.products?.[0] && 'size' in r1.products[0], 'S1b: o‘lcham maydoni ham keladi');
  // Xom pozitsiyalar ATAYLAB yuborilmaydi. Ro'yxat kesimi kartochkanikidan tor, uni
  // ham `items` deb atash tipni yolg'onga chiqarardi; bundan tashqari `findAll` da
  // AGENT uchun hech qanday field-strip YO'Q — bu yerga qo'shilgan har qanday narx
  // maydoni to'g'ridan-to'g'ri agentga oqib ketardi.
  ok(r1?.items === undefined, 'S1b: xom `items` ro‘yxat qatorida YO‘Q');
  // Ustunni ko'zda qo'shgan odam tepadagi «Hajmi» yakunini olishi kerak.
  const liveSum = (list.items ?? [])
    .filter((r) => r.status !== 'CANCELLED')
    .reduce((s, r) => s + num(r.cubeM3), 0);
  eq(liveSum, list.summary.cubeM3, 'S1b: tirik qatorlar hajmi = strip yakuni');

  // ═══════════════ S3: mijoz filtri summary'ni ham toraytiradi ═══════════════
  console.log('\n── S3: filtr bilan ──');
  const onlyB = await listAll(`&clientId=${clientB.id}`);
  eq(onlyB.summary.sales, 4_000_000, 'S3: faqat B mijozning savdosi');
  ok(onlyB.summary.orders === 1, 'S3: bitta buyurtma sanaldi');

  // ═══════════════ S4: sahifalash summary'ni qimirlatmaydi ═══════════════
  console.log('\n── S4: sahifalash ──');
  const p1 = (await req('GET', '/orders?pageSize=1&page=1', undefined, admin, 200)).body;
  const p2 = (await req('GET', '/orders?pageSize=1&page=2', undefined, admin, 200)).body;
  ok(p1.items.length === 1 && p2.items.length === 1, 'S4: har sahifada bittadan qator');
  eq(p1.summary.sales, 14_000_000, 'S4: 1-sahifada ham to‘liq summa');
  eq(p2.summary.sales, 14_000_000, 'S4: 2-sahifada ham AYNAN o‘sha summa');

  // ═══════════════ S2: bekor qilingan buyurtma ═══════════════
  console.log('\n── S2: bekor qilingan buyurtma ──');
  // bekor qilish = DELETE /orders/:id (soft-cancel; hech narsa o'chirilmaydi)
  await req('DELETE', `/orders/${o2.id}`, { reason: 'test bekor', mode: 'VOID_ALL' }, admin, 200);
  list = await listAll();
  // Bu S2 ning butun mag'zi: bekor qilingan 4 mln HECH QAYERGA qo'shilmaydi.
  eq(list.summary.sales, 10_000_000, 'S2: `sales` faqat tirik buyurtmani sanaydi (4 mln tushdi)');
  ok(list.summary.orders === 1, 'S2: `orders` ham faqat tiriklarni sanaydi');
  ok(list.summary.cancelledOrders === 1, 'S2: bekor qilinganlar SONI izoh uchun qaytadi');
  eq(list.summary.cubeM3, 10, 'S2: hajm faqat tirik buyurtmalardan');
  eq(list.summary.cost, 10_000_000 - num(list.summary.goodsProfit), 'S2: tannarx ham tirik kesimda');
  // Pul figurasi sifatida bekor qilinganlar butunlay yo'q qilingan.
  ok(!('cancelledSales' in list.summary), 'S2: `cancelledSales` maydoni yo‘q');
  ok(!('liveOrders' in list.summary), 'S2: `liveOrders` maydoni yo‘q (`orders` o‘zi tirik)');
  // ...lekin QATOR jadvalda qoladi (egasi qarori): ko'rsatish ≠ hisoblash.
  ok(!!rowOf(list, o2.id), 'S2: bekor qilingan buyurtma ro‘yxatda KO‘RINADI');
  ok(rowOf(list, o2.id)?.status === 'CANCELLED', 'S2: qator bekor qilingan deb belgilangan');

  // ═══════════════ S5: /clients summary ═══════════════
  console.log('\n── S5: /clients summary ──');
  // A mijoz 10 mln qarzdor; B ga 2 mln avans to'laymiz (buyurtmasi bekor qilingan)
  await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: clientB.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 2_000_000, date: '2026-07-26',
  }, admin, 201);

  const clients = (await req('GET', '/clients?pageSize=200', undefined, admin, 200)).body;
  ok(!!clients.summary, 'S5: javobda summary bloki bor');
  eq(clients.summary.owedToUs, 10_000_000, 'S5: qarzdorlar jami = A ning 10 mln');
  eq(clients.summary.weOweThem, 2_000_000, 'S5: avans jami = B ning 2 mln');
  eq(clients.summary.net, 8_000_000, 'S5: sof = 10 − 2');
  ok(clients.summary.debtors === 1, 'S5: qarzdorlar soni 1');
  ok(clients.summary.inAdvance === 1, 'S5: avansi borlar soni 1');

  // sahifa kichraytirilsa ham yig'indi o'zgarmaydi (server tomonda butun filtr)
  const clientsP1 = (await req('GET', '/clients?pageSize=1&page=1', undefined, admin, 200)).body;
  eq(clientsP1.summary.owedToUs, 10_000_000, 'S5: 1 qatorlik sahifada ham to‘liq yig‘indi');

  // qidiruv bilan torayadi
  const onlyA = (await req('GET', `/clients?pageSize=200&search=${encodeURIComponent(`Yakun A ${U}`)}`, undefined, admin, 200)).body;
  ok((onlyA.items ?? []).length === 1, 'S5: qidiruv bitta mijoz qaytardi');
  eq(onlyA.summary.owedToUs, 10_000_000, 'S5: filtrlangan yig‘indi faqat A ni sanaydi');
  eq(onlyA.summary.weOweThem, 0, 'S5: filtrlanganda B ning avansi kirmaydi');

  // ═══════════════ S6: mijoz kartasidagi to'lov jamilari ═══════════════
  console.log('\n── S6: /clients/:id paymentTotals ──');
  // A dan 6 mln olamiz, 1 mln qaytaramiz
  await req('POST', '/payments', {
    kind: 'CLIENT_IN', clientId: clientA.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 6_000_000, date: '2026-07-26',
  }, admin, 201);
  await req('POST', '/payments', {
    kind: 'CLIENT_REFUND', clientId: clientA.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 1_000_000, date: '2026-07-26',
  }, admin, 201);

  let card = (await req('GET', `/clients/${clientA.id}`, undefined, admin, 200)).body;
  ok(!!card.paymentTotals, 'S6: paymentTotals bloki keladi');
  eq(card.paymentTotals.received, 6_000_000, 'S6: olingan 6 mln');
  eq(card.paymentTotals.refunded, 1_000_000, 'S6: qaytarilgan 1 mln');
  eq(card.paymentTotals.netReceived, 5_000_000, 'S6: sof = 6 − 1');
  eq(card.paymentTotals.paidToDriver, 0, 'S6: shofyorga bergani yo‘q');
  ok(card.paymentTotals.paymentCount === 2, 'S6: hujjatlar soni 2');

  // mijoz shofyorga to'g'ridan-to'g'ri to'laydigan buyurtma
  const o3 = await mkOrder(clientA.id, 5, 1_000_000, {
    transportMode: 'CLIENT_PAYS_DRIVER',
    transportCost: 300_000,
    oneTimeVehicle: { name: `Yakun truck ${U}`, plate: `YK${U}`, driver: 'Test' },
  });
  ok(!!o3?.id, 'S6: CLIENT_PAYS_DRIVER buyurtmasi yaratildi');
  await req('POST', '/payments', {
    kind: 'TRANSPORT_DIRECT', clientId: clientA.id, vehicleId: o3.vehicleId,
    method: 'CASH', amount: 300_000, date: '2026-07-26',
    allocations: [{ orderId: o3.id, amount: 300_000 }],
  }, admin, 201);

  card = (await req('GET', `/clients/${clientA.id}`, undefined, admin, 200)).body;
  eq(card.paymentTotals.received, 6_000_000, 'S6: shofyorga bergani «olingan»ga QO‘SHILMADI');
  eq(card.paymentTotals.netReceived, 5_000_000, 'S6: sof ham o‘zgarmadi');
  eq(card.paymentTotals.paidToDriver, 300_000, 'S6: shofyorga bergani alohida ko‘rinadi');

  // ═══════════════ S7: mijoz bo'yicha kassa jurnali ═══════════════
  console.log('\n── S7: /kassa/transactions?clientId= ──');
  const scoped = (await req('GET', `/kassa/transactions?clientId=${clientA.id}&pageSize=100`, undefined, admin, 200)).body;
  const rows = scoped.items ?? [];
  ok(rows.length > 0, 'S7: scope qilingan jurnal bo‘sh emas');
  ok(rows.every((r) => r.payment?.client?.id === clientA.id), 'S7: har bir qator AYNAN shu mijozniki');
  ok(
    !rows.some((r) => r.payment?.kind === 'TRANSPORT_DIRECT'),
    'S7: shofyorga to‘g‘ridan-to‘g‘ri berilgan pul jurnalda YO‘Q (kassadan o‘tmagan)',
  );
  const unscoped = (await req('GET', '/kassa/transactions?pageSize=100', undefined, admin, 200)).body;
  ok(num(unscoped.total) > num(scoped.total), 'S7: filtrsiz jurnal kattaroq');
  await req('GET', '/kassa/transactions?clientId=not-a-uuid', undefined, admin, 400);
  ok(true, 'S7: noto‘g‘ri clientId 400 qaytaradi');

  // ═══════ S8: bir buyurtmada bir nechta pozitsiya (2026-07-28) ═══════
  // ATAYLAB ENG OXIRIDA: bu yerda yangi buyurtma yaratiladi va u S2/S3/S4 ning
  // mutlaq raqamlarini buzardi.
  //
  // «+N» rozetkasi POZITSIYA emas, MAHSULOT sanaydi: ayni mahsulot ikki qator
  // bo'lib kiritilsa, «+1» bosilgan odam ikkinchi nomni ko'rmasdi.
  console.log('\n── S8: ko‘p pozitsiyali buyurtma ──');
  const multi = (await req('POST', '/orders', {
    clientId: clientA.id,
    date: '2026-07-26',
    factoryPayIntent: 'BANK',
    transportMode: 'CLIENT_OWN',
    items: [
      { productId: product.id, quantityM3: 3, palletCount: 0, salePricePerM3: 1_000_000 },
      { productId: product.id, quantityM3: 2, palletCount: 0, salePricePerM3: 1_000_000 },
    ],
  }, admin, 201)).body;
  ok(!!multi?.id, 'S8: ikki pozitsiyali buyurtma yaratildi');
  const multiRow = rowOf(await listAll(), multi.id);
  ok(!!multiRow, 'S8: qator ro‘yxatda topildi');
  ok(multiRow?.products?.length === 1, 'S8: takrorlangan mahsulot BIR marta sanaladi');
  eq(multiRow?.cubeM3, 5, 'S8: hajm ikkala pozitsiyadan yig‘iladi (3 + 2)');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASS: ${pass}   FAIL: ${fails.length}`);
  if (fails.length) {
    console.log('\nMuammolar:');
    for (const f of fails) console.log(`  · ${f}`);
    process.exitCode = 1;
  }
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
