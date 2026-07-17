/**
 * Fill the LIVE dev database from «Smart blok.xlsx» through the real HTTP flow:
 * login → upload → preview → COMMIT (no rollback — the data stays).
 *   node test/import/fill-live.mjs   (API_URL default http://localhost:4000/api)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.API_URL || 'http://localhost:4000/api';
const XLSX = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../../../docs/Smart blok.xlsx');

let token = '';
async function api(method, path, body, isForm = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return null; }
}
const money = (v) => (+v).toLocaleString('ru-RU');

async function main() {
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.accessToken;

  console.log('1) UPLOAD');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(XLSX)]), 'Smart blok.xlsx');
  const up = await api('POST', '/import/upload', form, true);
  console.log(`   batch ${up.batch.id} · rows ${JSON.stringify(up.rowsByKind)} · blockers ${up.openBlockers} · pending ${up.pendingEntities}`);

  console.log('2) PREVIEW');
  const prev = await api('POST', `/import/${up.batch.id}/preview`);
  console.log(`   sotuv ${money(prev.saleTotal)} · mijoz qarzi ${money(prev.clientDebtTotal)} · zavod ${money(prev.factoryBalance)} · poddon ${prev.palletsOut}`);

  console.log('3) COMMIT (haqiqiy — maʼlumot bazada QOLADI)');
  const res = await api('POST', `/import/${up.batch.id}/commit`, { confirmToken: prev.previewHash });
  console.log(`   ${res.orders} buyurtma yozildi ✓`);

  console.log('\n4) NATIJA — Agents sahifasi koʻradigan holat:');
  const agents = await api('GET', '/agents');
  const list = Array.isArray(agents) ? agents : agents.items ?? agents.data;
  for (const a of list.sort((x, y) => (x.sortNo ?? 99) - (y.sortNo ?? 99))) {
    const d = await api('GET', `/agents/${a.id}`);
    console.log(`   [№${a.sortNo ?? '—'}] ${a.name}: ${d.clients.length} mijoz · qarz ${money(d.kpi.outstandingDebt)} · yigʻilgan ${money(d.kpi.collected)} · poddon ${d.kpi.palletExposure}`);
    for (const c of d.clients) {
      console.log(`        · ${c.name}: balans ${money(c.balance)} · poddon ${c.palletBalance}`);
    }
  }
  const debts = await api('GET', '/dashboard/summary').catch(() => null);
  if (debts) console.log('\n   dashboard OK ✓');
  console.log('\nBAZA IMPORT ORQALI TOʻLDIRILDI ✓');
}

main().catch((e) => { console.error(e); process.exit(1); });
