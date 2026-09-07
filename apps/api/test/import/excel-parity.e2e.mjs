// ═══════ EXCEL PARITY — «docs/Smart blok.xlsx» (shablon v5) ═══════
//
// Bu to'plamning yagona savoli: IMPORTDAN KEYIN sayt egasining Excel'i bilan bir xil
// raqamni aytadimi?
//
// Har bir kutilgan son faylning O'Z katagidan olingan (SUBTOTAL qatorlari, «Мижозлар
// қолдиғи» va «Поставшиклар ҳисоби» varaqlari) — qo'lda hisoblangan emas. Shu sabab
// workbook almashtirilsa test o'zi tushadi va yolg'on yashil bermaydi.
//
// ATAYLAB FARQ QILADIGAN YAGONA JOY — ZAVOD PADDON PULI. Excel zavod qarziga paddon
// pulini qo'shadi, sayt esa paddonni DONA bo'lib sanaydi (egasining qarori, 2026-09-04).
// Farq test ichida AYNAN hisoblanadi va tekshiriladi — ya'ni u «tushuntirilgan farq»,
// «yopib qo'yilgan farq» emas.
//
// Ishga tushirish:
//   cd apps/api
//   DATABASE_URL=…smartblok_test API_PORT=4100 node dist/main.js &
//   DATABASE_URL=…smartblok_test node test/_reset-data.mjs && node test/import/excel-parity.e2e.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.API_URL || 'http://localhost:4100/api';
const FILE = process.env.WORKBOOK || resolve(process.cwd(), '../../docs/Smart blok.xlsx');

let checks = 0;
let failures = 0;
const N = (v) => (v == null ? 0 : Number(v));
const eq = (actual, expected, label, tol = 1) => {
  checks++;
  if (Math.abs(N(actual) - N(expected)) > tol) {
    failures++;
    console.error(`  ✗ ${label}: kutilgan ${expected}, keldi ${actual} (farq ${(N(actual) - N(expected)).toFixed(2)})`);
  } else console.log(`  ✓ ${label} = ${expected}`);
};
const ok = (cond, label) => {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${label}`); } else console.log(`  ✓ ${label}`);
};

async function req(method, path, body, token, expectStatus) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (expectStatus !== undefined) {
    checks++;
    if (res.status !== expectStatus) {
      failures++;
      console.error(`  ✗ ${method} ${path} → ${res.status} (kutilgan ${expectStatus}): ${text.slice(0, 300)}`);
    }
  } else if (res.status >= 400) {
    failures++; checks++;
    console.error(`  ✗ ${method} ${path} FAILED ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: json };
}

async function login(username, password) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(BASE + '/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => null);
    if (body?.accessToken) return body.accessToken;
    if (res.status !== 429) break;
    console.log('  … login throttled, kutamiz');
    await new Promise((r) => setTimeout(r, 62_000));
  }
  console.error('  ✗ FATAL: login bo`lmadi');
  process.exit(1);
}

// ── EGASINING O'Z RAQAMLARI (fayl kataklaridan) ──
const G = {
  shipments: 415,
  cube: 12780.504,
  factoryGoods: 7451239050, // «Сумма Приход» SUBTOTAL
  palletsTaken: 7392, // «Поддон Шт»
  saleTotal: 9100435039.914066, // «Сумма Продажа»
  transport: 945196105.199, // «Авто услу»
  clientCharge: 8375011039.942068, // «Мижозга» = «Мижозлар қолдиғи» C61
  clientPaidGoods: 7532732040, // «Товарга» = «Мижозлар қолдиғи» D61
  clientPaidPallets: 370890000, // «Поддон пули» = I61
  palletsPaidQty: 2853, // «Тўлаган дона» = H61
  palletsReturned: 4036, // «Қайтарган» = G61
  clientPalletDebt: 503, // «ПОДДОН ҚАРЗИ (дона)» = J61 (belgisi bo`yicha 503 dona qarz)
  goodsDebt: -842278999.942068, // «ТОВАР ҚАРЗИ» = E61 (manfiy = mijoz qarzdor)
  factoryPaid: 7321989420, // «Оплата поставшику» SUBTOTAL
  factoryPaidKoals: 2395089420,
  factoryPaidMentora: 4926900000,
  palletsToFactory: 3392, // «Поддон қайтариш заводга» SUBTOTAL
  palletsToFactoryKoals: 2421,
  palletsToFactoryMentora: 971,
  returnExpense: 19368000, // «Қайтариш харажати жами»
  palletBasePrice: 130000,
  dealerInHand: 644, // «Қолдиқ (қайтарилмаган) поддон»
  factoryPalletDebt: 4000, // «Акт (умумий)» T — zavodga paddon qarzi (dona)
};

async function main() {
  console.log('— login —');
  const admin = await login('admin', 'admin123');

  console.log('\n— faylni yuklash —');
  const buf = readFileSync(FILE);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'Smart blok.xlsx');
  const up = await fetch(BASE + '/import/upload', {
    method: 'POST', headers: { authorization: `Bearer ${admin}` }, body: form,
  });
  const staged = await up.json().catch(() => null);
  checks++;
  if (up.status !== 201 && up.status !== 200) {
    failures++;
    console.error(`  ✗ yuklash → ${up.status}: ${JSON.stringify(staged).slice(0, 400)}`);
    process.exit(1);
  }
  const batchId = staged.batch.id;
  console.log(`  ✓ partiya ${batchId}`);

  eq(staged.rowsByKind.SHIPMENT, G.shipments, 'staged yuk qatorlari');
  eq(staged.rowsByKind.CLIENT_PAYMENT, 194, 'staged to`lov qatorlari');
  eq(staged.rowsByKind.FACTORY_PAYMENT, 58, 'staged zavod to`lovlari');
  eq(staged.rowsByKind.PALLET_RETURN, 88, 'staged paddon qaytarishlari');
  eq(staged.rowsByKind.FACTORY_PALLET_RETURN, 12, 'staged zavodga qaytarishlar');
  eq(staged.incompleteRows?.length ?? 0, 7, 'to`ldirilmagan qatorlar sanab berildi');
  eq(staged.pendingEntities, 0, 'aniqlanmagan mijoz nomi yo`q (справочник to`liq)');
  eq(staged.openBlockers, 0, 'hal qilinmagan to`siq yo`q');
  ok(staged.commitReady, 'partiya yuborishga tayyor');

  console.log('\n— preview (REPLACE) —');
  const pv = (await req('POST', `/import/${batchId}/preview`, { mode: 'REPLACE' }, admin)).body;
  ok(!!pv?.previewHash, 'preview hosil bo`ldi');

  console.log('\n— yuborish —');
  const res = (await req('POST', `/import/${batchId}/commit`, { confirmToken: pv.previewHash, mode: 'REPLACE' }, admin)).body;

  console.log('\n— 1) YUKLAR va MIJOZ PULI —');
  eq(res.orders, G.shipments, 'buyurtmalar soni');
  eq(res.saleTotal, G.saleTotal, 'sotuv jami (Сумма Продажа)');
  eq(res.clientChargeable, G.clientCharge, 'mijozga yoziladigan summa (Мижозга)');
  eq(res.clientDirectTransport, N(G.saleTotal) - N(G.clientCharge), 'mijoz shofyorga bergani (P − T)');
  eq(res.clientPaidGoods, G.clientPaidGoods, 'mol uchun to`lov (Товарга)');
  eq(res.clientPaidPallets, G.clientPaidPallets, 'paddon uchun to`lov (Поддон пули)');
  eq(res.clientPaidTotal, N(G.clientPaidGoods) + N(G.clientPaidPallets), 'mijoz to`lovi jami (Жами сумма)');
  // MIJOZ QARZI: sotuv − shofyor ulushi + paddon qarzi − to'lov jami
  //            = «Мижозга» + «Поддон пули» − «Жами сумма» = «ТОВАР ҚАРЗИ» ning teskarisi
  eq(res.clientDebtTotal, -N(G.goodsDebt), 'mijozlar qarzi (ТОВАР ҚАРЗИ, ishorasi teskari)');

  console.log('\n— 2) ZAVOD (pul tomoni — BLOK puli) —');
  eq(res.factoryGoodsTaken, G.factoryGoods, 'zavoddan olingan blok puli (Сумма Приход)');
  eq(res.factoryTransferred, G.factoryPaid, 'zavodga to`langan (Оплата поставшику)');
  eq(res.factoryBalance, N(G.factoryPaid) - N(G.factoryGoods), 'zavod qoldig`i = to`langan − olingan');
  {
    const koals = res.factories.find((f) => f.name === 'Коалс');
    const mentora = res.factories.find((f) => f.name === 'Ментора');
    ok(!!koals && !!mentora, 'ikkala zavod ham alohida hisobda');
    eq(koals?.paid, G.factoryPaidKoals, 'Коалс ga to`langan');
    eq(mentora?.paid, G.factoryPaidMentora, 'Ментора ga to`langan');
    eq(N(koals?.goodsTaken) + N(mentora?.goodsTaken), G.factoryGoods, 'zavodlar bo`yicha olingan jami = «Сумма Приход»');
    eq(N(koals?.balance) + N(mentora?.balance), res.factoryBalance, 'zavodlar qoldig`i umumiy qoldiqqa yig`iladi');
  }
  {
    // KANAL IZOLYATSIYASI (egasi qoidasi 2026-07-26): naqd buyurtma faqat naqd avansdan
    // yopiladi. Kesim TO'LIQ bo'lishi shart — aks holda bir qism mol hech qaysi kanalga
    // tushmay, «Qarzlar» sahifasidagi ikkita kartochka jamiga teng chiqmasdi.
    const ch = res.factoryByChannel ?? [];
    eq(ch.reduce((a, c) => a + N(c.goods), 0), G.factoryGoods, 'kanallar bo`yicha mol jami = «Сумма Приход»');
    eq(ch.reduce((a, c) => a + c.orders, 0), G.shipments, 'kanallar bo`yicha buyurtmalar jami');
    eq(N(res.factorySettled), ch.reduce((a, c) => a + N(c.paid), 0), 'yopilgan summa kanallar bo`yicha yig`iladi');
    // avans + yopilgan = zavodga to`langan (bir so`m ham yo`qolmaydi)
    eq(
      N(res.factoryAdvanceBank) + N(res.factoryAdvanceCash) + N(res.factorySettled),
      G.factoryPaid,
      'zavodga to`langan = qolgan avans + yopilganiga sarflangan',
    );
  }

  console.log('\n— 3) PADDON (DONA) —');
  eq(res.pallets.delivered, G.palletsTaken, 'mijozlarga berilgan paddon');
  eq(res.pallets.returnedByClients, G.palletsReturned, 'mijozlardan qaytgan');
  eq(res.pallets.paidByClients, G.palletsPaidQty, 'puli to`langan');
  eq(res.pallets.clientDebt, G.clientPalletDebt, 'mijozlarda qolgan (7392 − 4036 − 2853)');
  eq(res.pallets.returnedToFactory, G.palletsToFactory, 'zavodga qaytarilgan');
  eq(res.pallets.dealerInHand, G.dealerInHand, 'bizning omborda (Қолдиқ)');
  {
    const koals = res.factories.find((f) => f.name === 'Коалс');
    const mentora = res.factories.find((f) => f.name === 'Ментора');
    eq(koals?.palletsReturned, G.palletsToFactoryKoals, 'Коалс ga qaytarilgan paddon');
    eq(mentora?.palletsReturned, G.palletsToFactoryMentora, 'Ментора ga qaytarilgan paddon');
    eq(N(koals?.palletsOwed) + N(mentora?.palletsOwed), G.factoryPalletDebt, 'zavodlarga paddon qarzi (dona)');
  }
  // KONSERVATSIYA TENGLAMASI: zavodga qarzimiz == mijozlarda + omborda + puli to`langan.
  // Paddon pulini to`lash paddonni PULGA aylantiradi (mijozdan chiqadi), lekin ZAVOD
  // oldidagi majburiyatni kamaytirmaydi — u paddon jismonan qayerdaligini bilmaydi.
  eq(
    G.factoryPalletDebt,
    res.pallets.clientDebt + res.pallets.dealerInHand + res.pallets.paidByClients,
    'zavod qarzi == mijozlarda + omborda + puli to`langan',
    0,
  );

  console.log('\n— 4) EXCEL BILAN ATAYLAB FARQ: zavod paddon puli —');
  {
    const expected = N(G.palletBasePrice) * (N(G.palletsTaken) - N(G.palletsToFactory)) - N(G.returnExpense);
    eq(res.palletMoneyGap.gap, expected, 'tushuntirilgan farq (paddon puli − qaytarilgani − harajat)');
    eq(res.palletMoneyGap.returnExpense, G.returnExpense, 'paddon qaytarish harajati xarajat bo`lib yozildi');
    // Excel zavod qoldig'i = sayt qoldig'i − farq
    const excelFactory = N(res.factoryBalance) - N(res.palletMoneyGap.gap);
    eq(excelFactory, -629881630, 'farq qo`shilganda Excel «Ҳисобот» qoldig`iga tushadi');
  }

  console.log('\n— 5) TRANSPORT —');
  eq(res.transportSettled, G.transport, 'transport xarajati to`liq yopilgan (shofyorlarga qarz yo`q)');
  eq(res.vehicleBalance, 0, 'mashina hisobi nolga tushdi');

  console.log('\n— 6) KASSA —');
  ok(res.cashboxes.every((b) => N(b.balance) >= 0), 'birorta kassa manfiy emas');
  eq(
    N(res.cashIn) - N(res.cashOut) + N(res.cashCapital),
    res.cashboxes.reduce((a, b) => a + N(b.balance), 0),
    'kassa qoldiqlari kirim/chiqim bilan mos',
  );

  console.log('\n— 7) SAYT EKRANLARI shu raqamni ko`rsatadimi —');
  {
    // Qarzlar sahifasi qarzdorlar va avans bergan mijozlarni ALOHIDA ko`rsatadi
    // (egasi ikkalasini bir raqamga qo`shishni rad etgan) — SOFI Excel raqamiga tushadi.
    const debts = (await req('GET', '/debts/summary', undefined, admin)).body;
    eq(
      N(debts?.clientsOweUs) - N(debts?.weOweClients), -N(G.goodsDebt),
      'Qarzlar sahifasi: mijozlar qarzi (sof) = «ТОВАР ҚАРЗИ»',
    );
    eq(debts?.palletsOwedToFactories, G.factoryPalletDebt, 'Qarzlar sahifasi: zavodlarga paddon qarzi');
  }
  {
    const pallets = (await req('GET', '/pallets/balances', undefined, admin)).body;
    eq(pallets?.totals?.drift, 0, 'paddon konservatsiya tenglamasi yopiq (drift 0)');
    eq(pallets?.totals?.dealerInHand, G.dealerInHand, 'Paddonlar sahifasi: bizning omborda');
    eq(pallets?.totals?.factory?.balance, G.factoryPalletDebt, 'Paddonlar sahifasi: zavodlarga qarz');
    // «Мижозларда» sahifada FAQAT qarzdor mijozlar yig`indisi (manfiy qoldiqlar qo`shilmaydi).
    // Farq — faylning O`Z «Текширув» varag`i sanaydigan «ошиқча поддон»: 7 mijozda 422 dona,
    // ular paddonni fayl davridan OLDIN olgan. 925 − 422 = 503.
    eq(
      N(pallets?.totals?.client?.balance), G.clientPalletDebt,
      'Paddonlar sahifasi: mijozlardagi SOF qoldiq',
    );
  }
  {
    const orders = (await req('GET', '/orders?pageSize=1', undefined, admin)).body;
    eq(orders?.total ?? orders?.meta?.total, G.shipments, 'Buyurtmalar ro`yxati: jami');
  }

  console.log(`\n${checks} tekshiruv, ${failures} xato`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
