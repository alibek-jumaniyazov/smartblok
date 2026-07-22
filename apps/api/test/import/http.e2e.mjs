/**
 * HTTP-level scenario test (the owner's real flow): upload «Smart blok.xlsx» through the
 * REST API → preview → commit → the Agents screen data must be complete and CONSISTENT
 * (clients with balances+pallets, agent-scoped orders/payments), then rollback.
 *
 * Assertions are STRUCTURAL + cross-consistent rather than numbers copied from one
 * workbook (those live in excel-parity.e2e.mjs), so this keeps guarding the ?agentId=
 * scoping and the agent-card maths whenever the owner ships new data.
 *   API_URL=http://localhost:4100/api node test/import/http.e2e.mjs
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
const eq = (label, got, want) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};
const eqNum = (label, got, want, eps = 0.5) => {
  const ok = Math.abs(n(got) - n(want)) <= eps;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${fm(got)}${ok ? '' : `   (kutilgan ${fm(want)})`}`);
  if (!ok) fails++;
};
const ok_ = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) fails++;
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
const arr = (r) => (Array.isArray(r) ? r : r.items ?? r.data ?? []);

async function main() {
  token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;

  console.log('1) UPLOAD (multipart)');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(XLSX)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Smart blok.xlsx');
  const up = await api('POST', '/import/upload', form, true);
  const id = up.batch.id;
  console.log(`   staged: ${JSON.stringify(up.rowsByKind)}`);
  ok_('yuklamalar staged', n(up.rowsByKind.SHIPMENT) > 0);
  ok_('mijoz toʼlovlari staged', n(up.rowsByKind.CLIENT_PAYMENT) > 0);
  // Undecided client names hold the commit gate shut — answering them is part of the
  // owner's real flow, so the test does it and then re-checks that the gate opened.
  const decided = await decidePendingClients(api, id);
  if (decided.length) console.log(`   nomlar aniqlandi: ${decided.map((d) => `${d.from}→${d.to}`).join(', ')}`);
  eq('commitReady (nomlar aniqlangach)', (await api('GET', `/import/${id}`)).commitReady, true);

  console.log('\n2) PREVIEW → COMMIT (REPLACE — toza holatdan quriladi)');
  const prev = await api('POST', `/import/${id}/preview`, { mode: 'REPLACE' });
  await api('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash, mode: 'REPLACE' });
  eq('status COMMITTED', (await api('GET', `/import/${id}`)).batch.status, 'COMMITTED');

  console.log('\n3) AGENTS — roʼyxat va detal izchilligi');
  const list = arr(await api('GET', '/agents'));
  ok_('agentlar yaratildi', list.length > 0, String(list.length));
  let totalAgentBalance = 0;
  for (const a of list) {
    const detail = await api('GET', `/agents/${a.id}`);
    const sumClients = detail.clients.reduce((s, c) => s + n(c.balance), 0);
    // the card KPI, the list row and Σ of the client rows must be the SAME number
    eqNum(`${a.name}: Σ mijoz balansi = kpi.outstandingDebt`, sumClients, detail.kpi.outstandingDebt);
    eqNum(`${a.name}: roʼyxat = detal`, a.outstandingDebt, detail.kpi.outstandingDebt);
    ok_(`${a.name}: har mijozda palletBalance bor`, detail.clients.every((c) => c.palletBalance !== undefined));
    totalAgentBalance += sumClients;
  }

  console.log('\n4) agentId boʼyicha scoping (?agentId= faqat oʼz yozuvlarini qaytaradi)');
  const biggest = [...list].sort((x, y) => n(y.clientCount) - n(x.clientCount))[0];
  const detail = await api('GET', `/agents/${biggest.id}`);
  const ownClientIds = new Set(detail.clients.map((c) => c.id));
  const orders = arr(await api('GET', `/orders?agentId=${biggest.id}&pageSize=200`));
  ok_(`${biggest.name}: buyurtmalar bor`, orders.length > 0, String(orders.length));
  ok_(
    `${biggest.name}: hamma buyurtma shu agentniki`,
    orders.every((o) => o.agentId === biggest.id || ownClientIds.has(o.clientId ?? o.client?.id)),
  );
  const payments = arr(await api('GET', `/payments?agentId=${biggest.id}&pageSize=200`));
  ok_(`${biggest.name}: toʼlovlar bor`, payments.length > 0, String(payments.length));
  ok_(
    `${biggest.name}: hamma toʼlov shu agentniki`,
    payments.every((p) => p.agentId === biggest.id || ownClientIds.has(p.clientId ?? p.client?.id)),
  );

  console.log('\n5) Agentlar jamisi dashboard bilan mos');
  const a = (await api('GET', '/dashboard/summary')).allTime;
  eqNum('Σ agent balanslari = allTime.clientsOweUs', totalAgentBalance, a.clientsOweUs, 1);

  console.log('\n6) ROLLBACK (test bazasini tozalash)');
  eq('rollback Σ=0', (await api('POST', `/import/${id}/rollback`)).ledgerSum, '0.00');

  console.log(`\n${fails === 0 ? 'HTTP SCENARIO E2E OʼTDI ✓ — import → agents oqimi toʼliq ishlaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
