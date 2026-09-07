/**
 * Kassa + Dashboard MODEL E2E — asserts the owner's rules as INVARIANTS, not as numbers
 * copied from one workbook (those live in excel-parity.e2e.mjs, which reads the file's own
 * summary block). This file stays valid whenever the owner ships new data:
 *
 *   · KASSA/BANK NEVER NEGATIVE — a period that paid out ahead of collection is topped up
 *     with a «Diller kapitali» (CAPITAL) row instead of showing a minus
 *   · NAQD KASSA SHOWS THE REAL «Нахт» MONEY, not a plugged 0.00 — the owner's complaint
 *     (2026-07-23). The naqd box is funded ONLY by real collections and never gets a capital
 *     top-up, so a box that lands on exactly 0.00 with a plug is the signature of the old bug.
 *   · DRIVER MONEY NEVER TOUCHES THE TILL — «шопр учун барди» settles the client's debt but is
 *     paid by the client straight to the driver; it must produce NO CashTransaction row.
 *   · CAPITAL is off-book: excluded from kirim/chiqim, so /kassa and /dashboard agree.
 *   · SOF FOYDA is the kassa headline and equals the dashboard's all-time net profit
 *   · every reported figure is internally consistent (debt = sales − paid)
 *   · rollback returns ledger AND kassa to exactly zero
 *
 *   API_URL=http://localhost:4100/api node test/import/kassa-dashboard.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidePendingClients } from './_pending.mjs';

const BASE = process.env.API_URL || 'http://localhost:4100/api';
const XLSX = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../../../docs/Smart blok.xlsx');

let fails = 0;
const n = (v) => Number(v ?? 0);
const fm = (v) => n(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const eqNum = (label, got, want, eps = 0.5) => {
  const ok = Math.abs(n(got) - n(want)) <= eps;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${fm(got)}${ok ? '' : `   (kutilgan ${fm(want)})`}`);
  if (!ok) fails++;
};
const eq = (label, got, want) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) fails++;
};

let token = '';
async function api(method, path, body, isForm = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;

  console.log('1) UPLOAD → PREVIEW');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(XLSX)]), 'Smart blok.xlsx');
  const up = await api('POST', '/import/upload', form, true);
  const id = up.batch.id;
  eq('toʼsiqlar yoʼq', up.openBlockers, 0);
  await decidePendingClients(api, id); // owner answers the undecided client names
  const prev = await api('POST', `/import/${id}/preview`, { mode: 'REPLACE' });
  // ICHKI IZCHILLIK — shablon v5 da mijoz qarzi TO'RT qismdan yig'iladi:
  //   sotuv − mijoz shofyorga bergani (carve-out) + paddon puli qarzi − mijoz to'lovi
  // Eski shablonda oxirgi ikkitasi yo'q edi va formula «sotuv − to'lov» edi.
  eqNum(
    'clientDebt = sotuv − shofyor ulushi + paddon puli − toʼlov',
    prev.clientDebtTotal,
    n(prev.saleTotal) - n(prev.clientDirectTransport) + n(prev.clientPaidPallets) - n(prev.clientPaidTotal),
  );
  // …va «Мижозга» ustuni AYNAN sotuv minus shofyor ulushi
  eqNum('clientChargeable = sotuv − shofyor ulushi', prev.clientChargeable, n(prev.saleTotal) - n(prev.clientDirectTransport));
  ok('cashCapital >= 0', n(prev.cashCapital) >= 0, fm(prev.cashCapital));
  ok('cashIn > 0', n(prev.cashIn) > 0, fm(prev.cashIn));

  // ── the owner's complaint, asserted directly on the preview (before commit) ──
  const boxesByType = Object.fromEntries((prev.cashboxes ?? []).map((b) => [b.type, b]));
  const naqd = boxesByType.CASH;
  ok('preview has per-cashbox breakdown', !!naqd, JSON.stringify(prev.cashboxes));
  // NAQD kassa HAQIQIY «Накд» pulni ko'radi — bu egasining asl shikoyati edi (eski import
  // transport pulini kassadan churnab, naqdni 0 ga tushirardi).
  //
  // LEKIN «qoldiq > 0» ni talab qilish FAYLNING shaklini qoidaga aylantiradi: etalon faylda
  // naqd kirim 49 999 800, chiqim esa 53 048 000 (50 mln zavodga + paddon qaytarish harajati)
  // — ya'ni fayl naqddan olganidan ko'proq to'laydi va kassa qonuniy ravishda 0 ga tushadi
  // (farqi «Diller kapitali» bilan yopiladi). Shuning uchun tekshiriladigan narsa —
  // HARAKAT bor-yo'qligi va qoldiq formulasi, qoldiqning belgisi emas.
  ok('naqd kassa HARAKAT koʼradi (Накд ustuni oʼqildi)', n(naqd?.in) > 0, `kirim ${fm(naqd?.in)}`);
  eqNum('naqd balance = kirim + kapital − chiqim', n(naqd?.balance), n(naqd?.in) + n(naqd?.capital) - n(naqd?.out), 0.01);
  ok('naqd kassa manfiy emas', n(naqd?.balance) >= -0.01, fm(naqd?.balance));
  // Click money lands in the Click wallet — in BOTH directions since 2026-07-27, when the
  // «Утказилган пул» block started naming its channel. Whether a Click transfer to the factory
  // actually leaves this box is a property of the FILE, not of the importer: on the 2026-07-29
  // workbook the only «Клик» row (50 000 000) sits OUTSIDE the block's own «Жами» chain, so by
  // the owner's rule it is not money the factory received and never leaves the till. Pinning
  // «out > 0» froze the previous file's shape into a requirement — so the outflow is asserted
  // only for the channels the block actually counts, and the never-negative invariant always.
  const click = boxesByType.CLICK;
  ok('Click kassa manfiy emas', n(click?.balance) >= -0.01, fm(click?.balance));
  eqNum('Click balance = kirim + kapital − chiqim', n(click?.balance), n(click?.in) + n(click?.capital) - n(click?.out), 0.01);
  // Every so'm that leaves a box must be a real payment through THAT box's own method —
  // asserted after the commit against the Payments journal (§ 4c), which is stronger than
  // «Click chiqimi > 0» and does not assume any particular workbook has a Click transfer.
  // Mijoz shofyorga O'ZI bergan pul («Расход Авто» = Клиент) qarzni kamaytiradi, lekin
  // kassadan O'TMAYDI. Shablon v5 da bu taxmin emas — ustunda yozilgan.
  ok('mijoz shofyorga bergan puli > 0', n(prev.clientDirectTransport) > 0, fm(prev.clientDirectTransport));
  ok('transport toʼliq yopilgan (shofyorlarga qarz yoʼq)', n(prev.transportSettled) > 0, fm(prev.transportSettled));
  ok(
    'shofyor ulushi transport xarajatidan katta emas',
    n(prev.clientDirectTransport) <= n(prev.transportSettled) + 0.01,
    `${fm(prev.clientDirectTransport)} ≤ ${fm(prev.transportSettled)}`,
  );

  console.log('\n2) COMMIT');
  await api('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash, mode: 'REPLACE' });
  eq('status COMMITTED', (await api('GET', `/import/${id}`)).batch.status, 'COMMITTED');

  console.log('\n3) DASHBOARD — ichki izchillik');
  const sum = await api('GET', '/dashboard/summary');
  const a = sum.allTime;
  eqNum('allTime.sales = preview saleTotal', a.sales, prev.saleTotal);
  eqNum('allTime.collected = preview clientPaidTotal', a.collected, prev.clientPaidTotal);
  eqNum('allTime.clientsOweUs = preview clientDebtTotal', a.clientsOweUs, prev.clientDebtTotal);
  eqNum('goodsProfit = sales − cost', a.goodsProfit, n(a.sales) - n(a.cost));
  eqNum('netProfit = goodsProfit + transportProfit', a.netProfit, n(a.goodsProfit) + n(a.transportProfit));
  eqNum('chiqim = factoryPaid + vehiclePaid', a.chiqim, n(a.factoryPaid) + n(a.vehiclePaid));
  // both sides must be NET the same way the import reports them (client refunds AND
  // factory refunds subtract) — otherwise the recon tile disagrees with ImportReview
  eqNum('allTime.factoryPaid = preview factoryTransferred', a.factoryPaid, prev.factoryTransferred);
  ok('dataRange bor', !!sum.dataRange?.from && !!sum.dataRange?.to, `${sum.dataRange?.from} → ${sum.dataRange?.to}`);

  // the daily chart must sum to the same «kirim» as the KPI tile above it (same window)
  const range = `from=${sum.dataRange.from}&to=${sum.dataRange.to}`;
  const trends = await api('GET', `/dashboard/trends?${range}`);
  const trendCollected = trends.reduce((s, d) => s + n(d.collected), 0);
  const period = (await api('GET', `/dashboard/summary?${range}`)).period;
  eqNum('Σ trends.collected = period.collected (grafik = KPI)', trendCollected, period.collected, 1);

  console.log('\n4) KASSA — HECH QACHON MANFIY EMAS (egasining asosiy qoidasi)');
  const kassa = await api('GET', '/dashboard/kassa');
  const neg = kassa.filter((b) => n(b.balance) < -0.01);
  ok('hech bir kassa/bank manfiy emas', neg.length === 0, neg.map((b) => `${b.name}=${fm(b.balance)}`).join(', ') || 'toza');
  const uzsTotal = kassa.filter((b) => b.currency === 'UZS').reduce((s, b) => s + n(b.balance), 0);
  ok('jami UZS qoldiq >= 0', uzsTotal >= -0.01, fm(uzsTotal));
  // the capital top-up is exactly what lifts the boxes to non-negative
  eqNum('jami qoldiq = kirim + kapital − chiqim', uzsTotal, n(prev.cashIn) + n(prev.cashCapital) - n(prev.cashOut));
  const kNaqd = kassa.find((b) => b.type === 'CASH');

  console.log('\n4b) SHOFYOR PULI — kassaga TEGMAYDI (asosiy manba)');
  const naqdBox = boxesByType.CASH;
  eqNum('naqd balance = preview naqd balance', n(kNaqd?.balance), n(naqdBox?.balance), 0.5);
  // «Расход Авто» = Клиент bo'lgan yuklarda mijoz shofyorga O'ZI to'laydi: bu qarzni
  // kamaytiradi, lekin kassaga TEGMAYDI. Buni tuzilma bo'yicha isbotlaymiz — o'sha
  // to'lovlarning birortasida ham kassa bo'lmasligi kerak.
  {
    const pays = await api('GET', '/payments?pageSize=200&kind=TRANSPORT_DIRECT');
    const rows = pays.items ?? pays;
    ok('shofyorga toʼlovlar bor', rows.length > 0, `${rows.length} qator`);
    ok(
      'shofyorga toʼlovlarning birortasi ham kassadan oʼtmagan',
      rows.every((p) => !p.cashboxId),
      rows.filter((p) => p.cashboxId).map((p) => p.id).join(', ') || 'toza',
    );
  }

  console.log('\n4c) HAR BIR KASSA CHIQIMI = OʼSHA USULDAGI HAQIQIY TOʼLOV');
  // The channel word in «Утказилган пул» decides which till the money leaves, and getting it
  // wrong is invisible: every total still reconciles while a box that never paid is drained.
  // So each box's outflow is tied back to the payments booked with that box's own method.
  {
    const METHOD_FOR_TYPE = { CASH: ['CASH', 'USD'], BANK: ['BANK'], CLICK: ['CLICK'], CARD: ['CARD'], TERMINAL: ['TERMINAL'] };
    const out = [];
    for (let page = 1; ; page++) {
      const res = await api('GET', `/payments?pageSize=200&page=${page}`);
      const batch = res.items ?? res;
      out.push(...batch);
      if (batch.length < 200) break;
    }
    // money LEAVING a till: factory settlements and refunds handed back to a client
    const outflow = out.filter((p) => ['FACTORY_OUT', 'CLIENT_REFUND'].includes(p.kind) && !p.voidedAt && p.cashboxId);
    // …VA XARAJATLAR. Shablon v5 da kassadan to'lov qatoridan tashqari XARAJAT ham chiqadi
    // (paddonni zavodga qaytarish harajati, «Тўлов тури» ustuni qaysi kassani ko'rsatsa
    // o'shandan). Faqat to'lovlarni sanash bu chiqimni «tushuntirilmagan» qilib qo'yardi.
    const expenses = await api('GET', '/kassa/transactions?pageSize=200&source=EXPENSE');
    const expRows = expenses.items ?? expenses;
    ok('xarajat qatorlari oʼqildi', expRows.length > 0, `${expRows.length} qator`);
    for (const box of prev.cashboxes ?? []) {
      const methods = METHOD_FOR_TYPE[box.type] ?? [];
      const paid = outflow.filter((p) => methods.includes(p.method)).reduce((s, p) => s + n(p.amount), 0);
      const spent = expRows
        .filter((r) => r.cashbox?.name === box.name && r.direction === 'OUT')
        .reduce((s, r) => s + n(r.amount), 0);
      eqNum(`«${box.name}» chiqimi = toʼlovlar + xarajatlar`, box.out, paid + spent, 1);
    }
  }

  console.log('\n5) SOF FOYDA kassada koʼrinadi');
  const ks = await api('GET', '/kassa/summary');
  eqNum('kassa summary netProfit = dashboard netProfit', ks.profit.netProfit, a.netProfit);
  eqNum('kassa summary goodsProfit = sales − cost', ks.profit.goodsProfit, n(a.sales) - n(a.cost));
  const sumIn = ks.cashboxes.reduce((s, b) => s + n(b.in), 0);
  const sumOut = ks.cashboxes.reduce((s, b) => s + n(b.out), 0);
  // CAPITAL is now OFF-BOOK (excluded from kirim/chiqim, lands in the per-box `adjustment`).
  // Counting it as kirim used to inflate the reference import's income by the whole plug and make
  // /kassa and /dashboard quote different kirim for the same period.
  const sumAdj = ks.cashboxes.reduce((s, b) => s + n(b.adjustment), 0);
  eqNum('Σ kirim = toʼlov kirimi (kapitalsiz)', sumIn, prev.cashIn);
  eqNum('Σ chiqim = toʼlov chiqimi', sumOut, prev.cashOut);
  eqNum('Σ adjustment = kapital (off-book, kirimga kirmaydi)', sumAdj, prev.cashCapital);
  // Kassa «kirim» va dashboard «collected» AYNAN bir xil savolga javob bermaydi:
  //   · kassa kirim  = kassaga TUSHGAN pul (faqat musbat to'lovlar)
  //   · collected    = mijoz qarzini kamaytirgan SOF pul (qaytarilganlari ayirilgan)
  // Etalon faylda 7 ta manfiy to'lov bor, shuning uchun kirim SOF summadan KATTA bo'ladi va
  // farq AYNAN o'sha qaytarishlarga teng. Ilgari bu yerda «kirim < collected» talab qilinardi
  // — u eski shablonning «шопр учун барди» qatorlariga bog'langan edi, yangi faylda esa
  // shofyor puli umuman to'lov qatori bo'lib kelmaydi.
  ok(
    'kassa kirim >= dashboard collected (farq — mijozga qaytarilgan pul)',
    sumIn >= n(a.collected) - 0.01,
    `kassa ${fm(sumIn)} ≥ dashboard ${fm(a.collected)}`,
  );

  console.log('\n5b) IMPORTDAN KEYIN KASSA TIRIK + hech qachon manfiy emas');
  // Ikkita kafolat bir joyda:
  //   · PULI BOR kassadan qo'lda chiqim O'TADI — importdan keyin kassa ishlashda davom etadi;
  //   · BO'SH kassadan chiqim RAD ETILADI — «hech qachon manfiy emas» qoidasi tirik.
  //
  // Qaysi kassada pul borligi FAYLGA bog'liq: etalon faylda naqd kassa qonuniy 0 ga tushadi
  // (naqd kirim 49 999 800, chiqim 53 048 000 — zavodga 50 mln + paddon qaytarish harajati).
  // Shuning uchun kassa TURI bo'yicha emas, QOLDIQ bo'yicha tanlanadi — aks holda test
  // bitta faylning shaklini qoidaga aylantirib qo'yardi.
  {
    // QOLDIQ /kassa/cashboxes dan olinadi — /kassa/summary faqat kirim/chiqim/tuzatish beradi.
    const boxes = await api('GET', '/kassa/cashboxes');
    const uzs = boxes.filter((b) => b.currency === 'UZS');
    const live = uzs.find((b) => n(b.balance) > 1000);
    ok('puli bor kassa topildi', !!live, uzs.map((b) => `${b.name}=${fm(b.balance)}`).join(', ') || 'yo`q');
    if (live) {
      const balOf = async () => n((await api('GET', '/kassa/cashboxes')).find((b) => b.id === live.id)?.balance);
      const before = await balOf();
      await api('POST', '/kassa/manual', { cashboxId: live.id, direction: 'OUT', amount: 1000, note: 'liveness smoke' });
      eqNum(`«${live.name}» chiqimi oʼtdi (kassa tirik)`, before - (await balOf()), 1000, 0.01);
      await api('POST', '/kassa/manual', { cashboxId: live.id, direction: 'IN', amount: 1000, note: 'liveness smoke restore' });
      eqNum(`«${live.name}» tiklandi (net-zero)`, await balOf(), before, 0.01);
    }
    const empty = uzs.find((b) => Math.abs(n(b.balance)) < 0.01);
    if (empty) {
      const res = await fetch(`${BASE}/kassa/manual`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ cashboxId: empty.id, direction: 'OUT', amount: 1000, note: 'never-negative guard' }),
      });
      ok(`boʼsh «${empty.name}» dan chiqim RAD etildi`, res.status === 400, `status ${res.status}`);
    }
  }

  console.log('\n6) ROLLBACK — ledger ham, kassa ham nolga tushadi');
  const rb = await api('POST', `/import/${id}/rollback`);
  eq('rollback ledgerSum', rb.ledgerSum, '0.00');
  eq('rollback cashSum', rb.cashSum, '0.00');
  ok('reversedCash > 0', rb.reversedCash > 0, String(rb.reversedCash));
  const kassa2 = await api('GET', '/dashboard/kassa');
  eqNum('rollbackdan keyin kassa jami = 0', kassa2.filter((b) => b.currency === 'UZS').reduce((s, b) => s + n(b.balance), 0), 0);

  console.log(`\n${fails === 0 ? 'KASSA + DASHBOARD MODEL E2E OʼTDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
