/**
 * HTTP-level scenario test (the owner's real flow): upload «Smart blok.xlsx» through
 * the REST API → preview → commit → the Agents screen data must be complete
 * (clients with balances+pallets, agent-filtered orders and payments), then rollback.
 *   API on :4100 against smartblok_test:
 *   API_URL=http://localhost:4100/api node test/import/http.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.API_URL || 'http://localhost:4100/api';
const XLSX = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../../../docs/Smart blok.xlsx');

let fails = 0;
const eq = (label, got, want) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

let token = '';
async function api(method, path, body, isForm = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function main() {
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.accessToken;

  console.log('1) UPLOAD (multipart)');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(XLSX)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Smart blok.xlsx');
  const up = await api('POST', '/import/upload', form, true);
  const id = up.batch.id;
  eq('staged rows', JSON.stringify(up.rowsByKind), JSON.stringify({ SHIPMENT: 21, CLIENT_PAYMENT: 7, FACTORY_PAYMENT: 8 }));
  eq('commitReady', up.commitReady, true);

  console.log('2) PREVIEW → COMMIT');
  const prev = await api('POST', `/import/${id}/preview`);
  eq('preview clientDebtTotal', prev.clientDebtTotal, '239399139.36');
  await api('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash });
  const after = await api('GET', `/import/${id}`);
  eq('status COMMITTED', after.batch.status, 'COMMITTED');

  console.log('3) AGENTS ro‘yxati va detali');
  const agents = await api('GET', '/agents');
  const list = Array.isArray(agents) ? agents : agents.items ?? agents.data;
  const jamol = list.find((a) => a.name === 'Жамол 22-22');
  eq('Жамол 22-22 ro‘yxatda', !!jamol, true);
  const detail = await api('GET', `/agents/${jamol.id}`);
  eq('Жамол mijozlari (5 ta)', detail.clients.length, 5);
  const norm = (c) => `${c.name}:${(+c.balance).toFixed(0)}:${c.palletBalance}`;
  const rows = new Map(detail.clients.map((c) => [c.name, c]));
  // Excel daftaridagi qoldiqlar bilan solishtirish (balans musbat = mijoz qarzdor)
  eq('Урганч Тамирлаш balans ≈ 0', Math.abs(+rows.get('Урганч Тамирлаш').balance) < 1, true);
  eq('Нормат Умидбек qarzi', (+rows.get('Нормат Умидбек').balance).toFixed(2), '72394560.00');
  eq('Инвест Холдинг qarzi', (+rows.get('Инвест Холдинг').balance).toFixed(2), '67737600.00');
  eq('Фидато avansi (−22 703 000)', (+rows.get('Фидато Гроуп').balance).toFixed(0), '-22703000');
  eq('Нормат poddonlari (57)', rows.get('Нормат Умидбек').palletBalance, 57);
  eq('Урганч poddonlari (36)', rows.get('Урганч Тамирлаш').palletBalance, 36);
  console.log('   mijozlar:', detail.clients.map(norm).join(' | '));

  console.log('4) agentId bo‘yicha buyurtmalar/to‘lovlar');
  // faqat jonli yozuvlar — oldingi testlarning bekor qilingan buyurtmalari/void to‘lovlari chetda
  const live = (arr) => arr.filter((x) => x.status !== 'CANCELLED' && !x.voidedAt);
  const orders = await api('GET', `/orders?agentId=${jamol.id}&pageSize=100`);
  eq('Жамол buyurtmalari (9 mashina)', live(orders.items ?? orders).length, 9);
  const payments = await api('GET', `/payments?agentId=${jamol.id}&pageSize=100`);
  eq('Жамол to‘lovlari (2 ta CLIENT_IN)', live(payments.items ?? payments).filter((p) => p.kind === 'CLIENT_IN').length, 2);

  const shox = list.find((a) => a.name === 'Шохрух ога');
  const shoxOrders = await api('GET', `/orders?agentId=${shox.id}&pageSize=100`);
  eq('Шохрух buyurtmalari (3)', live(shoxOrders.items ?? shoxOrders).length, 3);

  console.log('5) ROLLBACK (test bazasini tozalash)');
  const rb = await api('POST', `/import/${id}/rollback`);
  eq('rollback Σ=0', rb.ledgerSum, '0.00');

  console.log(`\n${fails === 0 ? 'HTTP SCENARIO E2E O‘TDI ✓ — import → agents oqimi to‘liq ishlaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
