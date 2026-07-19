/**
 * Excel parity E2E — SELF-VERIFYING: the expected numbers are read from the workbook's
 * OWN «Агент | Расход | Приход | Ост» summary block, so the test stays valid when the
 * owner ships a new file. It proves the site reproduces the daftar exactly after import:
 *   Σ Расход = saleTotal · Σ Приход = collected · Σ Ост = mijozlar balansi (per agent too)
 *
 * Guards the negative-«Приход» rule: a deduction row («Шопир пули 5%», a correction) is a
 * CLIENT_REFUND that RAISES the client's balance — dropping it silently skewed «Ост».
 *
 *   API_URL=http://localhost:4100/api node test/import/excel-parity.e2e.mjs
 * (requires `nest build` — it reads the compiled parsers to learn the expectations)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(HERE, '../../package.json'));
const P = '../../dist/import/parse/';
const { WorkbookReader } = require(join(HERE, P, 'workbook.reader.js'));
const { parseAgentSummary } = require(join(HERE, P, 'jurnal.parser.js'));

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
  // ── expectations straight out of the workbook ──
  const wb = await WorkbookReader.fromFile(XLSX);
  const summary = parseAgentSummary(wb);
  if (!summary.length) throw new Error('«Агент | Расход | Приход | Ост» jamlama bloki topilmadi');
  const want = { sales: 0, paid: 0, ost: 0 };
  for (const r of summary) {
    want.sales += n(r.sales);
    want.paid += n(r.paid);
    want.ost += n(r.balance);
  }
  console.log(`Excel jamlama: ${summary.length} agent · Расход=${fm(want.sales)} · Приход=${fm(want.paid)} · Ост=${fm(want.ost)}\n`);

  token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;

  console.log('1) UPLOAD → PREVIEW (REPLACE)');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(XLSX)]), 'Smart blok.xlsx');
  const up = await api('POST', '/import/upload', form, true);
  const id = up.batch.id;
  eq('toʼsiqlar yoʼq', up.openBlockers, 0);
  const prev = await api('POST', `/import/${id}/preview`, { mode: 'REPLACE' });
  eqNum('preview saleTotal = Σ Расход', prev.saleTotal, want.sales);
  eqNum('preview clientPaidTotal = Σ Приход', prev.clientPaidTotal, want.paid);
  eqNum('preview clientDebtTotal = Σ Ост', prev.clientDebtTotal, want.ost);

  console.log('\n2) COMMIT');
  await api('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash, mode: 'REPLACE' });
  eq('status COMMITTED', (await api('GET', `/import/${id}`)).batch.status, 'COMMITTED');

  console.log('\n3) DASHBOARD — daftar bilan bir xil');
  const a = (await api('GET', '/dashboard/summary')).allTime;
  eqNum('allTime.sales = Σ Расход', a.sales, want.sales);
  eqNum('allTime.collected (kirim) = Σ Приход', a.collected, want.paid);
  eqNum('allTime.clientsOweUs = Σ Ост', a.clientsOweUs, want.ost);

  console.log('\n4) HAR AGENT boʼyicha «Ост»');
  const agents = await api('GET', '/agents');
  const byName = new Map(agents.map((g) => [String(g.name).trim(), g]));
  for (const r of summary) {
    const name = String(r.agent).trim();
    const row = byName.get(name);
    if (!row) { console.log(`  ✗ agent topilmadi: "${name}"`); fails++; continue; }
    eqNum(`${name} balansi`, row.outstandingDebt, r.balance);
  }

  console.log('\n5) Manfiy «Приход» qatorlari CLIENT_REFUND boʼlib yozilgan');
  const rows = await api('GET', `/import/${id}/rows?kind=CLIENT_PAYMENT`);
  const negatives = rows.filter((r) => n(r.resolvedJson.total) < 0);
  console.log(`  manfiy qatorlar: ${negatives.length}`);
  const refunds = await api('GET', '/payments?kind=CLIENT_REFUND&pageSize=200');
  const refundItems = refunds.items ?? refunds;
  eq('CLIENT_REFUND soni = manfiy qatorlar soni', refundItems.length, negatives.length);
  const refundSum = refundItems.reduce((s, p) => s + n(p.amount), 0);
  const negSum = negatives.reduce((s, r) => s + Math.abs(n(r.resolvedJson.total)), 0);
  eqNum('CLIENT_REFUND jami = manfiy qatorlar jami', refundSum, negSum);

  console.log(`\n${fails === 0 ? 'EXCEL PARITY E2E OʼTDI ✓ — sayt daftar bilan aynan bir xil' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
