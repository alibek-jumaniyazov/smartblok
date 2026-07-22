/**
 * Kassa + Dashboard MODEL E2E — asserts the owner's rules as INVARIANTS, not as numbers
 * copied from one workbook (those live in excel-parity.e2e.mjs, which reads the file's own
 * summary block). This file stays valid whenever the owner ships new data:
 *
 *   · KASSA/BANK NEVER NEGATIVE — a period that paid out ahead of collection is topped up
 *     with a «Diller kapitali» (CAPITAL) row instead of showing a minus
 *   · SOF FOYDA is the kassa headline and equals the dashboard's all-time net profit
 *   · every reported figure is internally consistent (debt = sales − paid, chiqim = zavod + shofyor)
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
  // internal consistency: the debt IS sales minus what was paid
  eqNum('clientDebt = saleTotal − clientPaid', prev.clientDebtTotal, n(prev.saleTotal) - n(prev.clientPaidTotal));
  ok('cashCapital >= 0', n(prev.cashCapital) >= 0, fm(prev.cashCapital));
  ok('cashIn > 0', n(prev.cashIn) > 0, fm(prev.cashIn));

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
  eqNum('allTime.factoryPaid = preview factoryPaidTotal', a.factoryPaid, prev.factoryPaidTotal);
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

  console.log('\n5) SOF FOYDA kassada koʼrinadi');
  const ks = await api('GET', '/kassa/summary');
  eqNum('kassa summary netProfit = dashboard netProfit', ks.profit.netProfit, a.netProfit);
  eqNum('kassa summary goodsProfit = sales − cost', ks.profit.goodsProfit, n(a.sales) - n(a.cost));
  const sumIn = ks.cashboxes.reduce((s, b) => s + n(b.in), 0);
  const sumOut = ks.cashboxes.reduce((s, b) => s + n(b.out), 0);
  eqNum('Σ kirim = toʼlov kirimi + kapital', sumIn, n(prev.cashIn) + n(prev.cashCapital));
  eqNum('Σ chiqim = toʼlov chiqimi', sumOut, prev.cashOut);

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
