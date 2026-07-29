/**
 * ZAVOD HISOBI parity — SELF-VERIFYING against Лист1's «Завод» block AND the per-order
 * «Завотга толов» / «тўлов тури» columns.
 *
 *      Олинган   Σ (Блок Куб × Цена Приход)      ← what the trucks cost
 *      Берилган  «Утказилган пул» → «Жами»       ← what the owner declares was transferred
 *      ────────────────────────────────────
 *      qolgani   Берилган − Олинган              ← «zavodda qolgan bizni pulimiz»
 *
 * The owner reads that bottom number as ONE figure, so the site must too. WHICH truck each
 * so'm bought used to be a guess (oldest first); since 2026-07-29 the sheet answers it per
 * row, and his rule is literal: «Завотга толов» = «Сумма Приход» ⇒ that truck is settled,
 * «Завотга толов» = 0 ⇒ it joins the factory debt on its own «тўлов тури» channel. So the
 * three pockets no longer collapse to «PAYABLE 0»: PAYABLE is exactly Σ(mol − toʼlov).
 *
 * Expectations come from the workbook, never from constants — a new file just works.
 *
 *   API_URL=http://localhost:4100/api node test/import/factory-book.e2e.mjs
 * (requires `nest build` — it reads the compiled parsers to learn the expectations)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { decidePendingClients } from './_pending.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(HERE, '../../package.json'));
const P = '../../dist/import/parse/';
const { WorkbookReader } = require(join(HERE, P, 'workbook.reader.js'));
const { parseJurnal, parseFactoryTransfers, parseFactoryDeclaredTotal } = require(join(HERE, P, 'jurnal.parser.js'));
const { classifyOrderChannel } = require(join(HERE, '../../dist/import/commit/import-commit.service.js'));

const BASE = process.env.API_URL || 'http://localhost:4100/api';
const XLSX = process.argv[2] ?? join(HERE, '../../../../docs/Smart blok.xlsx');

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
  // ── «Завод» bloki, faylning o'zidan ──
  const wb = await WorkbookReader.fromFile(XLSX);
  const ship = parseJurnal(wb);
  const transfers = parseFactoryTransfers(wb);
  const olingan = ship.reduce((a, r) => a + (r.cube !== null && r.costPrice ? Number(r.cube) * Number(r.costPrice) : 0), 0);
  // «Берилган» is anchored on the block's OWN «Жами» cell, NOT on Σ of the rows this same
  // parser read. Deriving both sides from parseFactoryTransfers made this suite structurally
  // incapable of failing: when the 2026-07-27 layout change silently dropped all 21 transfers,
  // berilgan computed to 0, the API also reported 0, and every assertion below went green
  // while certifying «zavodga 2,76 mlrd QARZDORMIZ» as correct.
  const declared = parseFactoryDeclaredTotal(wb);
  // Rows the block's own «Жами» steps over are NOT money the factory received (owner rule,
  // 2026-07-29) — they are parsed, reported, and left out of the import.
  const counted = transfers.filter((t) => t.inDeclaredTotal);
  const parsedSum = counted.reduce((a, f) => a + Number(f.amount ?? 0), 0);
  eq('«Утказилган пул» bloki o‘qildi', transfers.length > 0, true);
  eq('«Жами» katagi o‘qildi', declared != null, true);
  eqNum('Σ «Жами»dagi o‘tkazmalar == «Жами»', parsedSum, Number(declared ?? 0), 1);
  const berilgan = Number(declared ?? parsedSum);
  const qolgan = berilgan - olingan;

  // ── «Завотга толов» / «тўлов тури»: per-truck settlement, per-channel debt ──
  const perOrder = ship.some((r) => r.factoryPaid !== null);
  const clamp = (r) => Math.max(0, Math.min(Number(r.factoryPaid ?? 0), Number(r.cube ?? 0) * Number(r.costPrice ?? 0)));
  const goodsOf = (r) => Number(r.cube ?? 0) * Number(r.costPrice ?? 0);
  const tolangan = perOrder ? ship.reduce((a, r) => a + clamp(r), 0) : Math.min(olingan, berilgan);
  const zavodQarzi = perOrder ? olingan - tolangan : Math.max(0, olingan - berilgan);
  const chan = { naqd: { n: 0, goods: 0, paid: 0 }, otkazma: { n: 0, goods: 0, paid: 0 } };
  for (const r of ship) {
    const m = classifyOrderChannel(r.factoryPayChannel ?? '');
    const s = m !== null && m !== 'BANK' ? chan.naqd : chan.otkazma;
    s.n++; s.goods += goodsOf(r); s.paid += clamp(r);
  }

  // per-channel split: the block records HOW each transfer travelled since 2026-07-27
  const byChannel = {};
  for (const t of counted) {
    const k = (t.channel || '').trim() || '(bo‘sh ⇒ bank)';
    byChannel[k] = (byChannel[k] ?? 0) + Number(t.amount ?? 0);
  }
  console.log(`Excel «Завод»: Олинган ${fm(olingan)} · Берилган ${fm(berilgan)} (${counted.length}/${transfers.length} o‘tkazma) → qolgan ${fm(qolgan)}`);
  console.log(`  kanallar: ${Object.entries(byChannel).map(([k, v]) => `${k} ${fm(v)}`).join(' · ')}`);
  if (transfers.length !== counted.length) {
    console.log(`  «Жами» qamramagan (import qilinmaydi): ${transfers.filter((t) => !t.inDeclaredTotal).map((t) => `r${t.origin.excelRow} ${t.channel} ${fm(t.amount)}`).join(' · ')}`);
  }
  if (perOrder) {
    console.log(`  «Завотга толов»: to‘langan ${fm(tolangan)} · zavodga qarz ${fm(zavodQarzi)}`);
    console.log(`     o‘tkazma ${chan.otkazma.n} ta: mol ${fm(chan.otkazma.goods)} / qarz ${fm(chan.otkazma.goods - chan.otkazma.paid)}`);
    console.log(`     naqd     ${chan.naqd.n} ta: mol ${fm(chan.naqd.goods)} / qarz ${fm(chan.naqd.goods - chan.naqd.paid)}`);
  }
  console.log('');

  token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;

  console.log('1) UPLOAD → PREVIEW (REPLACE)');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(XLSX)]), 'Smart blok.xlsx');
  const up = await api('POST', '/import/upload', form, true);
  const id = up.batch.id;
  await decidePendingClients(api, id);
  const prev = await api('POST', `/import/${id}/preview`, { mode: 'REPLACE' });
  eqNum('preview Олинган', prev.factoryGoodsTaken, olingan);
  eqNum('preview Берилган', prev.factoryTransferred, berilgan);
  eqNum('preview zavodda qolgan pulimiz', prev.factoryBalance, qolgan);
  // «Завотга толов» decides what is bought, not the pool's size
  eqNum('preview yopilgan mol puli = Σ «Завотга толов»', prev.factorySettled, tolangan);
  eqNum('preview yopilmagan mol qarzi', prev.factoryPayable, -zavodQarzi);
  eqNum('uchta cho‘ntak yig‘indisi = qoldiq',
    n(prev.factoryPayable) + n(prev.factoryAdvanceBank) + n(prev.factoryAdvanceCash), qolgan);
  eq('«Жами» qamramagan qatorlar import qilinmadi', prev.factoryTransfersSkipped, transfers.length - counted.length);
  if (perOrder) {
    const got = Object.fromEntries((prev.factoryByChannel ?? []).map((c) => [c.channel, c]));
    eqNum('naqd kanal qarzi', got.naqd?.debt ?? 0, chan.naqd.goods - chan.naqd.paid);
    eqNum('o‘tkazma kanal qarzi', got["o'tkazma"]?.debt ?? 0, chan.otkazma.goods - chan.otkazma.paid);
    eq('«Завотга толов» to‘liq qoplandi', prev.factoryUnfunded, '0.00');
  }

  // ── Kanal → kassa: pul AYNAN o‘zi chiqqan kassadan chiqishi kerak ──
  // This is the assertion the 2026-07-27 layout change needed and nobody had: it is not
  // enough that the TOTAL reconciles — a naqd transfer booked as a bank transfer reconciles
  // just as perfectly while draining a box that never paid.
  const CASHBOX_FOR_CHANNEL = { bank: 'BANK', naxt: 'CASH', naqd: 'CASH', click: 'CLICK', karta: 'CARD' };
  const boxOut = Object.fromEntries((prev.cashboxes ?? []).map((c) => [c.type, n(c.out)]));
  for (const [ch, amount] of Object.entries(byChannel)) {
    const type = CASHBOX_FOR_CHANNEL[ch.toLowerCase()] ?? 'BANK';
    // the bank box also carries client refunds, so it is a floor rather than an equality
    const ok = boxOut[type] >= amount - 0.5;
    console.log(`${ok ? '  ✓' : '  ✗'} «${ch}» ${fm(amount)} → ${type} kassasidan chiqdi (chiqim ${fm(boxOut[type])})`);
    if (!ok) fails++;
  }

  console.log('\n2) COMMIT');
  await api('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash, mode: 'REPLACE' });

  console.log('\n3) ZAVOD KARTASI');
  const f = (await api('GET', '/factories')).items[0];
  eqNum('factories.balance = qolgan', f.balance, qolgan);
  eqNum('factories.payable = yopilmagan qarz', f.payable, -zavodQarzi);
  eqNum('qarz + naqd avans + oʼtkazma avans = qolgan', n(f.payable) + n(f.advanceCash) + n(f.advanceBank), qolgan);
  // EKRANGA chiqadigan qiymatlar: egasi brutto choʼntakni («oʼtkazma 489 470 806») hech
  // qayerda koʼrmasligi kerak (2026-07-29) — kartochka ham, roʼyxat ham sof qiymatni beradi
  eqNum('kartochka: sof avans = «Завод» qoldigʼi', f.advanceNetTotal, Math.max(0, qolgan));
  eqNum('kartochka: sof naqd + sof oʼtkazma = sof', n(f.advanceNetCash) + n(f.advanceNetBank), Math.max(0, qolgan));
  eqNum('poddon zavodda hisobda', f.palletsHeld, ship.reduce((a, r) => a + (r.palletQty ?? 0), 0));

  console.log('\n4) DASHBOARD va QARZLAR — bitta raqam hamma joyda');
  // The three LEDGER pockets do NOT auto-net (owner rule, 2026-07-21) — but what the owner
  // READS is his «Завод» block's bottom line, «Берилган − Олинган». So the buckets stay gross
  // and the reported figure is the subtraction: `factoryAdvanceNet`. Both are asserted, since
  // showing the gross under the label «Zavodda qolgan pulimiz» is exactly the complaint that
  // produced this rule (489 470 806 on screen against 391 595 430 in the file).
  const advance = Math.max(0, qolgan) + zavodQarzi; // = Σ ADVANCE_* buckets (brutto)
  const d = await api('GET', '/dashboard/summary');
  eqNum('dashboard.factoryAdvanceTotal (ledger brutto — ekranga chiqmaydi)', d.factoryAdvanceTotal, advance);
  eqNum('dashboard.factoryAdvanceNet = «Завод» qoldigʼi', d.factoryAdvanceNet, qolgan);
  eqNum('dashboard.weOweFactories (sof)', d.weOweFactories, Math.max(0, -qolgan));
  eqNum('allTime.factoryAdvanceNet', d.allTime.factoryAdvanceNet, qolgan);
  const debts = await api('GET', '/debts/summary');
  eqNum('debts.factoryAdvance (brutto)', debts.factoryAdvance, advance);
  eqNum('debts.factoryAdvanceNet = «Завод» qoldigʼi', debts.factoryAdvanceNet, qolgan);
  eqNum('debts.weOweFactories (sof)', debts.weOweFactories, Math.max(0, -qolgan));
  // the OPEN goods debt is what «Завотга толов» leaves behind — no longer 0 by construction
  eqNum('debts.factoryPayableOpen', debts.factoryPayableOpen, zavodQarzi);
  eqNum('brutto − qarz = sof', n(debts.factoryAdvance) - n(debts.factoryPayableOpen), n(debts.factoryAdvanceNet));
  // …and the file's own «Нахт / банк» split of that bottom line
  eqNum('sof avans naqd + oʼtkazma = sof', n(debts.factoryAdvanceNetCash) + n(debts.factoryAdvanceNetBank), qolgan);
  if (perOrder) {
    // «тўлов тури» → Qarzlar sahifasidagi naqd / oʼtkazma kartochkalari. Bu ikki raqam
    // faqat order.factoryPayIntent toʼgʼri yozilgandagina toʼgʼri chiqadi.
    eqNum('debts.factoryPayableCash = naqd qarzimiz', debts.factoryPayableCash, chan.naqd.goods - chan.naqd.paid);
    eqNum('debts.factoryPayableBank = oʼtkazma qarzimiz', debts.factoryPayableBank, chan.otkazma.goods - chan.otkazma.paid);
    eqNum('«aniq emas» qarz yoʼq', debts.factoryPayableUnknown, 0);
  }

  console.log('\n5) BUYURTMALAR tannarxi aniqlangan');
  // pageSize is capped at 200 — page through so a bigger workbook stays covered
  const items = [];
  for (let page = 1; ; page++) {
    const res = await api('GET', `/orders?pageSize=200&page=${page}`);
    const batch = res.items ?? res;
    items.push(...batch);
    if (batch.length < 200) break;
  }
  const settled = items.filter((o) => o.costStatus === 'FINAL').length;
  eq('buyurtmalar oʼqildi', items.length, prev.orders);
  eq('preview soni bilan bir xil', prev.factoryOrdersSettled, settled);
  // «Завотга толов» = mol narxi ⇒ FINAL; 0 < toʼlov < narx ⇒ PARTIAL; 0 ⇒ PROVISIONAL
  const wantFinal = perOrder ? ship.filter((r) => goodsOf(r) > 0 && clamp(r) >= goodsOf(r) - 0.5).length : items.length;
  eq('tannarxi FINAL boʼlgan buyurtmalar = toʼliq toʼlanganlar', settled, wantFinal);
  eq('qisman toʼlanganlar PARTIAL', items.filter((o) => o.costStatus === 'PARTIAL').length,
    perOrder ? ship.filter((r) => clamp(r) > 0 && clamp(r) < goodsOf(r) - 0.5).length : 0);

  // «тўлов тури» → order.factoryPayIntent: this is what puts an unpaid truck on the naqd
  // card in Qarzlar instead of the o‘tkazma one. Wrong here = every total still reconciles.
  if (perOrder) {
    const cashOrders = items.filter((o) => o.factoryPayIntent === 'CASH').length;
    eq('naqd buyurtmalar soni = «Нахт» qatorlar', cashOrders, chan.naqd.n);
    eq('«aniq emas» buyurtma yoʼq', items.filter((o) => o.factoryPayIntent === 'UNKNOWN').length, 0);

    // KANAL IZOLYATSIYASI (egasi qoidasi, 2026-07-29): naqd buyurtmani oʼtkazma avansidan
    // yopib boʼlmaydi. Bu yerda BUYURTMANING oʼzida sinaladi — importda ham, jonli ishda ham
    // bir xil qoida boʼlishi shart, aks holda import qatʼiyroq boʼlib qolardi.
    const openCash = items.find((o) => o.factoryPayIntent === 'CASH' && o.costStatus !== 'FINAL');
    if (openCash) {
      let refused = false;
      try {
        await api('POST', `/orders/${openCash.id}/factory-advance-draw`, { bucket: 'ADVANCE_BANK', amount: 1000 });
      } catch (e) {
        refused = /o'tkazma|oʼtkazma|naqd/i.test(String(e.message));
      }
      eq('naqd buyurtma oʼtkazma avansidan yopilmaydi', refused, true);
    } else {
      console.log('  – ochiq naqd buyurtma yoʼq — kanal izolyatsiyasi sinovi oʼtkazib yuborildi');
    }
  }

  console.log('\n6) ROLLBACK — zavod hisobi nolga tushadi');
  const rb = await api('POST', `/import/${id}/rollback`);
  eq('rollback ledgerSum', rb.ledgerSum, '0.00');
  eqNum('rollbackdan keyin zavod balansi', (await api('GET', '/factories')).items[0]?.balance ?? 0, 0);

  console.log(`\n${fails === 0 ? 'ZAVOD HISOBI E2E OʼTDI ✓ — «Завод» bloki bilan aynan bir xil' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
