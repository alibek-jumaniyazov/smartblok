/**
 * Kassa + Dashboard reconciliation E2E: upload «Smart blok.xlsx» → preview → commit,
 * then assert the KASSA (cash in/out) and the DASHBOARD all-time totals match the
 * workbook exactly (savdo 501.4M, sof foyda 117.5M, kirim 262M, chiqim 305.5M), and
 * that rollback nets the kassa back to zero.
 *   API_URL=http://localhost:4100/api node test/import/kassa-dashboard.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.API_URL || 'http://localhost:4100/api';
const XLSX = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../../../docs/Smart blok.xlsx');

let fails = 0;
const money = (v) => Number(v);
const eqNum = (label, got, want, eps = 0.01) => {
  const ok = Math.abs(money(got) - money(want)) <= eps;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
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
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// Golden numbers (docs/audit/excel-spec-v2.md §6)
const G = {
  sales: 501414039.36,
  cost: 340416000,
  goodsProfit: 160998039.36,
  transport: 43500000,
  netProfit: 117498039.36,
  kirim: 262014900,       // client payments in
  factoryPaid: 262014900, // factory transfers out
  chiqim: 305514900,      // factory + driver out
  clientDebt: 239399139.36,
  factoryOwed: 78401100,
  orders: 21,
};

async function main() {
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.accessToken;

  console.log('1) UPLOAD → PREVIEW (kassa kirim/chiqim ko‘rinadi)');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(XLSX)]), 'Smart blok.xlsx');
  const up = await api('POST', '/import/upload', form, true);
  const id = up.batch.id;
  eq('staged rows', JSON.stringify(up.rowsByKind), JSON.stringify({ SHIPMENT: 21, CLIENT_PAYMENT: 7, FACTORY_PAYMENT: 8 }));
  const prev = await api('POST', `/import/${id}/preview`);
  eqNum('preview clientDebtTotal', prev.clientDebtTotal, G.clientDebt);
  eqNum('preview cashIn (kirim)', prev.cashIn, G.kirim);
  eqNum('preview cashOut (chiqim)', prev.cashOut, G.chiqim);

  console.log('2) COMMIT');
  await api('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash });
  const after = await api('GET', `/import/${id}`);
  eq('status COMMITTED', after.batch.status, 'COMMITTED');

  console.log('3) DASHBOARD — allTime (Excel bilan tasdiqlanadi)');
  const sum = await api('GET', '/dashboard/summary');
  const a = sum.allTime;
  eqNum('allTime.sales (umumiy savdo)', a.sales, G.sales);
  eqNum('allTime.cost (zavod tannarxi)', a.cost, G.cost);
  eqNum('allTime.goodsProfit (yalpi foyda)', a.goodsProfit, G.goodsProfit);
  eqNum('allTime.transportCost', a.transportCost, G.transport);
  eqNum('allTime.transportProfit', a.transportProfit, -G.transport);
  eqNum('allTime.netProfit (SOF FOYDA)', a.netProfit, G.netProfit);
  eqNum('allTime.collected (kirim)', a.collected, G.kirim);
  eqNum('allTime.factoryPaid', a.factoryPaid, G.factoryPaid);
  eqNum('allTime.vehiclePaid', a.vehiclePaid, G.transport);
  eqNum('allTime.chiqim', a.chiqim, G.chiqim);
  eqNum('allTime.clientsOweUs (mijozlar qarzi)', a.clientsOweUs, G.clientDebt);
  eqNum('allTime.weOweFactories (zavod qarzi)', a.weOweFactories, G.factoryOwed);
  eq('allTime.orders', a.orders, G.orders);
  eq('dataRange.from', sum.dataRange?.from, '2026-06-24');
  eq('dataRange.to', sum.dataRange?.to, '2026-06-30');
  eq('default month is empty (period.orders=0)', sum.period.orders, 0);

  console.log('4) DASHBOARD — davr filtri iyunga qo‘yilganda (sof foyda ko‘rinadi)');
  const jun = await api('GET', '/dashboard/summary?from=2026-06-01&to=2026-06-30');
  eqNum('iyun period.sales', jun.period.sales, G.sales);
  eqNum('iyun period.netProfit', jun.period.netProfit, G.netProfit);
  eqNum('iyun period.collected', jun.period.collected, G.kirim);
  eq('iyun period.orders', jun.period.orders, G.orders);

  console.log('5) KASSA — real kirim/chiqim yozildi');
  const kassa = await api('GET', '/dashboard/kassa');
  const uzsBoxes = kassa.filter((b) => b.currency === 'UZS');
  const uzsTotal = uzsBoxes.reduce((s, b) => s + money(b.balance), 0);
  eqNum('kassa jami UZS balans (= kirim − chiqim)', uzsTotal, G.kirim - G.chiqim); // −43 500 000
  const naqd = kassa.find((b) => b.name === 'Naqd kassa');
  eqNum('Naqd kassa balans (transport chiqimi)', naqd?.balance, -G.transport);
  const kassaSum = await api('GET', '/kassa/summary?dateFrom=2026-06-01&dateTo=2026-06-30');
  const sumIn = kassaSum.cashboxes.reduce((s, b) => s + money(b.in), 0);
  const sumOut = kassaSum.cashboxes.reduce((s, b) => s + money(b.out), 0);
  eqNum('kassa iyun Σ kirim', sumIn, G.kirim);
  eqNum('kassa iyun Σ chiqim', sumOut, G.chiqim);
  eqNum('kassa iyun jami UZS closing', kassaSum.totals.UZS, G.kirim - G.chiqim);

  console.log('6) ROLLBACK — kassa ham nolga tushadi');
  const rb = await api('POST', `/import/${id}/rollback`);
  eq('rollback ledgerSum', rb.ledgerSum, '0.00');
  eq('rollback cashSum', rb.cashSum, '0.00');
  const ok = rb.reversedCash > 0;
  console.log(`${ok ? '  ✓' : '  ✗'} rollback reversedCash > 0: ${rb.reversedCash}`);
  if (!ok) fails++;
  const kassa2 = await api('GET', '/dashboard/kassa');
  const uzsTotal2 = kassa2.filter((b) => b.currency === 'UZS').reduce((s, b) => s + money(b.balance), 0);
  eqNum('rollbackdan keyin kassa jami = 0', uzsTotal2, 0);

  console.log(`\n${fails === 0 ? 'KASSA + DASHBOARD E2E O‘TDI ✓ — barcha raqamlar Excel bilan mos' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
