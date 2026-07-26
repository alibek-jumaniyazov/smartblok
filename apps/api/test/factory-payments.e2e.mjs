// «Zavodga hozirgacha jami qancha pul o'tkazdik» + zavodga scope qilingan
// tranzaksiyalar jurnali — E2E.
//
// Tekshiriladigan qoidalar:
//   P1  /factories/:id → paymentTotals = butun tarix (oxirgi 50 emas):
//       paid (bonusdan tashqari) − refunded = netPaid; bonusOffset ALOHIDA turadi
//   P2  /factories ro'yxati har qatorda paymentTotals va oxirida paymentSummary
//       (butun filtr bo'yicha) qaytaradi
//   P3  BEKOR QILINGAN to'lov hech qanday summaga kirmaydi
//   P4  FACTORY_REFUND netto summani kamaytiradi
//   P5  /kassa/transactions?factoryId= — faqat SHU zavodning pul harakatlari
//       (boshqa zavodniki ham, mijoz to'lovi ham chiqmaydi)
//   P6  qidiruv filtri paymentSummary'ni ham toraytiradi (jadval bilan yig'indi
//       hech qachon boshqa-boshqa gapirmaydi)
//
// Ishga tushirish (API 4100 da turgan bo'lsin):
//   node test/factory-payments.e2e.mjs

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

  const card = async (id) => (await req('GET', `/factories/${id}`, undefined, admin, 200)).body;
  const listAll = async (qs = '') => (await req('GET', `/factories?pageSize=200${qs}`, undefined, admin, 200)).body;

  // ── ikkita YANGI zavod: birinchisiga to'laymiz, ikkinchisi nazorat namunasi ──
  const target = (await req('POST', '/factories', { name: `Zavod A ${U}` }, admin, 201)).body;
  const other = (await req('POST', '/factories', { name: `Zavod B ${U}` }, admin, 201)).body;
  ok(!!target?.id && !!other?.id, 'ikkita test zavodi yaratildi');

  const boxes = (await req('GET', '/kassa/cashboxes', undefined, admin, 200)).body;
  const list = boxes.items ?? boxes;
  const cashBox = list.find((b) => b.type === 'CASH' && b.currency === 'UZS');
  const bankBox = list.find((b) => b.type === 'BANK');
  ok(!!cashBox && !!bankBox, 'naqd va bank kassalari topildi');

  for (const box of [cashBox, bankBox]) {
    await req('POST', '/kassa/manual', {
      cashboxId: box.id, direction: 'IN', amount: 300_000_000, date: '2026-07-26',
      note: 'test kapital',
    }, admin, 201);
  }

  // ═══════════════ P1: yangi zavodda jamilar NOLDAN boshlanadi ═══════════════
  console.log('\n── P1: bo\'sh zavodda jamilar nol ──');
  let f = await card(target.id);
  ok(!!f.paymentTotals, 'paymentTotals bloki keladi');
  eq(f.paymentTotals.paid, 0, 'P1: jami to\'langan 0');
  eq(f.paymentTotals.netPaid, 0, 'P1: sof to\'langan 0');
  ok(f.paymentTotals.paymentCount === 0, 'P1: to\'lov soni 0');
  ok(f.paymentTotals.lastPaymentAt === null, 'P1: oxirgi to\'lov sanasi yo\'q');

  // ═══════════════ P1: uchta to'lov — naqd + bank + boshqa zavodga ═══════════════
  console.log('\n── P1: 12 mln naqd + 8 mln bank shu zavodga, 5 mln boshqa zavodga ──');
  const pay1 = (await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: target.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 12_000_000, date: '2026-07-20',
  }, admin, 201)).body;
  const pay2 = (await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: target.id, method: 'BANK',
    cashboxId: bankBox.id, amount: 8_000_000, date: '2026-07-24',
  }, admin, 201)).body;
  const payOther = (await req('POST', '/payments', {
    kind: 'FACTORY_OUT', factoryId: other.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 5_000_000, date: '2026-07-24',
  }, admin, 201)).body;
  ok(!!pay1?.id && !!pay2?.id && !!payOther?.id, 'uchta zavod to\'lovi yaratildi');

  f = await card(target.id);
  eq(f.paymentTotals.paid, 20_000_000, 'P1: jami o\'tkazilgan = 12 + 8');
  eq(f.paymentTotals.refunded, 0, 'P1: hali qaytim yo\'q');
  eq(f.paymentTotals.netPaid, 20_000_000, 'P1: sof to\'langan = jami');
  eq(f.paymentTotals.bonusOffset, 0, 'P1: bonusdan yopilgani yo\'q');
  ok(f.paymentTotals.paymentCount === 2, 'P1: to\'lov soni 2');
  ok(String(f.paymentTotals.firstPaymentAt ?? '').startsWith('2026-07-20'), 'P1: birinchi to\'lov sanasi 20.07');
  ok(String(f.paymentTotals.lastPaymentAt ?? '').startsWith('2026-07-24'), 'P1: oxirgi to\'lov sanasi 24.07');

  // qo'shni zavod ARALASHMAYDI
  const fOther = await card(other.id);
  eq(fOther.paymentTotals.netPaid, 5_000_000, 'P1: boshqa zavodning jamisi alohida');

  // ═══════════════ P4: zavoddan qaytim netto summani kamaytiradi ═══════════════
  console.log('\n── P4: zavoddan 3 mln qaytim ──');
  await req('POST', '/payments', {
    kind: 'FACTORY_REFUND', factoryId: target.id, method: 'CASH',
    cashboxId: cashBox.id, amount: 3_000_000, date: '2026-07-25',
  }, admin, 201);

  f = await card(target.id);
  eq(f.paymentTotals.paid, 20_000_000, 'P4: «jami o\'tkazilgan» qaytimdan O\'ZGARMADI');
  eq(f.paymentTotals.refunded, 3_000_000, 'P4: qaytgan summa alohida ko\'rinadi');
  eq(f.paymentTotals.netPaid, 17_000_000, 'P4: sof = 20 − 3');
  ok(f.paymentTotals.paymentCount === 3, 'P4: hujjatlar soni 3 (qaytim ham hujjat)');

  // ═══════════════ P3: bekor qilingan to'lov hisobga kirmaydi ═══════════════
  console.log('\n── P3: 8 mln lik bank to\'lovini bekor qilamiz ──');
  await req('POST', `/payments/${pay2.id}/void`, { reason: 'test bekor' }, admin, 201);

  f = await card(target.id);
  eq(f.paymentTotals.paid, 12_000_000, 'P3: bekor qilingan to\'lov jamidan chiqdi');
  eq(f.paymentTotals.netPaid, 9_000_000, 'P3: sof = 12 − 3');
  ok(f.paymentTotals.paymentCount === 2, 'P3: hujjatlar soni 2 ga tushdi');

  // ═══════════════ P2: ro'yxatdagi qator + umumiy yig'indi ═══════════════
  console.log('\n── P2: /factories ro\'yxati ──');
  const all = await listAll();
  const rowTarget = (all.items ?? []).find((r) => r.id === target.id);
  ok(!!rowTarget?.paymentTotals, 'P2: ro\'yxat qatorida paymentTotals bor');
  eq(rowTarget.paymentTotals.netPaid, 9_000_000, 'P2: qatordagi sof summa kartadagi bilan bir xil');
  ok(!!all.paymentSummary, 'P2: ro\'yxatda paymentSummary bloki bor');

  // yig'indi qatorlar yig'indisidan katta yoki teng bo'lishi shart (seed zavodlari ham bor),
  // va ikkala test zavodimizni ham o'z ichiga olishi kerak
  const sumRows = (all.items ?? []).reduce((s, r) => s + num(r.paymentTotals?.netPaid), 0);
  eq(all.paymentSummary.netPaid, sumRows, 'P2: umumiy sof = barcha qatorlar yig\'indisi');
  ok(
    num(all.paymentSummary.paid) >= 12_000_000 + 5_000_000,
    'P2: umumiy jami ikkala test zavodini ham qamrab oladi',
  );

  // ═══════════════ P6: qidiruv yig'indini ham toraytiradi ═══════════════
  console.log('\n── P6: qidiruv bilan filtrlangan yig\'indi ──');
  const onlyA = await listAll(`&search=${encodeURIComponent(`Zavod A ${U}`)}`);
  ok((onlyA.items ?? []).length === 1, 'P6: qidiruv bitta zavod qaytardi');
  eq(onlyA.paymentSummary.netPaid, 9_000_000, 'P6: yig\'indi ham FAQAT o\'sha zavodni sanaydi');
  eq(onlyA.paymentSummary.paid, 12_000_000, 'P6: filtrlangan jami to\'g\'ri');

  // ═══════════════ P5: zavodga scope qilingan tranzaksiyalar jurnali ═══════════════
  console.log('\n── P5: /kassa/transactions?factoryId= ──');
  const scoped = (await req('GET', `/kassa/transactions?factoryId=${target.id}&pageSize=100`, undefined, admin, 200)).body;
  const rows = scoped.items ?? [];
  ok(rows.length > 0, 'P5: scope qilingan jurnal bo\'sh emas');
  ok(
    rows.every((r) => r.payment?.factory?.id === target.id || r.bonusTransaction?.factory?.id === target.id),
    'P5: har bir qator AYNAN shu zavodga tegishli',
  );
  ok(
    !rows.some((r) => r.payment?.id === payOther.id),
    'P5: boshqa zavodning to\'lovi jurnalga tushmadi',
  );
  // bekor qilingan to'lovning ASLI ham, STORNOsi ham jurnalda ko'rinadi (audit izi)
  ok(rows.some((r) => r.payment?.id === pay2.id), 'P5: bekor qilingan to\'lov jurnalda qoladi (audit)');
  ok(rows.some((r) => r.source === 'REVERSAL'), 'P5: storno qatori ham ko\'rinadi');

  const unscoped = (await req('GET', '/kassa/transactions?pageSize=100', undefined, admin, 200)).body;
  ok(num(unscoped.total) > num(scoped.total), 'P5: filtrsiz jurnal kattaroq (filtr haqiqatan ishlayapti)');

  // noto'g'ri uuid → 400 (jim e'tiborsiz qoldirish emas)
  await req('GET', '/kassa/transactions?factoryId=not-a-uuid', undefined, admin, 400);
  ok(true, 'P5: noto\'g\'ri factoryId 400 qaytaradi');

  // ── xulosa ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASS: ${pass}   FAIL: ${fails.length}`);
  if (fails.length) {
    console.log('\nMuammolar:');
    for (const f2 of fails) console.log(`  · ${f2}`);
    process.exitCode = 1;
  }
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
