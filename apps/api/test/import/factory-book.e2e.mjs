/**
 * ZAVOD HISOBI parity — SELF-VERIFYING against Лист1's «Завод» block.
 *
 *      Олинган   Σ (Блок Куб × Цена Приход)      ← what the trucks cost
 *      Берилган  Σ «Утказилган пул»              ← what was transferred
 *      ────────────────────────────────────
 *      qolgani   Берилган − Олинган              ← «zavodda qolgan bizni pulimiz»
 *
 * The owner reads that bottom number as ONE figure, so the site must too. The import
 * therefore settles the transfers against the goods (the same «avansdan yechish» the owner
 * would otherwise click 144 times): PAYABLE lands at 0 and only the remainder stays in the
 * advance channel. Booking both sides gross made the site claim a 2,67 mlrd debt the owner
 * does not owe while reporting his money at the factory as 2,97 mlrd instead of 298,9 mln.
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
const { parseJurnal, parseFactoryTransfers } = require(join(HERE, P, 'jurnal.parser.js'));

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
  const berilgan = transfers.reduce((a, f) => a + Number(f.amount ?? 0), 0);
  const qolgan = berilgan - olingan;
  console.log(`Excel «Завод»: Олинган ${fm(olingan)} · Берилган ${fm(berilgan)} (${transfers.length} o‘tkazma) → qolgan ${fm(qolgan)}\n`);

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
  // the whole of Олинган is covered whenever the transfers reach it
  eqNum('preview yopilgan mol puli', prev.factorySettled, Math.min(olingan, berilgan));
  eqNum('preview yopilmagan mol qarzi', prev.factoryPayable, Math.min(0, berilgan - olingan));

  console.log('\n2) COMMIT');
  await api('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash, mode: 'REPLACE' });

  console.log('\n3) ZAVOD KARTASI');
  const f = (await api('GET', '/factories')).items[0];
  eqNum('factories.balance = qolgan', f.balance, qolgan);
  eqNum('factories.payable = yopilmagan qarz', f.payable, Math.min(0, berilgan - olingan));
  eqNum('naqd + oʼtkazma avans = qolgan', n(f.advanceCash) + n(f.advanceBank), Math.max(0, qolgan));
  eqNum('poddon zavodda hisobda', f.palletsHeld, ship.reduce((a, r) => a + (r.palletQty ?? 0), 0));

  console.log('\n4) DASHBOARD va QARZLAR — bitta raqam hamma joyda');
  const d = await api('GET', '/dashboard/summary');
  eqNum('dashboard.factoryAdvanceTotal', d.factoryAdvanceTotal, Math.max(0, qolgan));
  eqNum('dashboard.weOweFactories', d.weOweFactories, Math.max(0, -qolgan));
  eqNum('allTime.factoryAdvanceTotal', d.allTime.factoryAdvanceTotal, Math.max(0, qolgan));
  const debts = await api('GET', '/debts/summary');
  eqNum('debts.factoryAdvance', debts.factoryAdvance, Math.max(0, qolgan));
  eqNum('debts.weOweFactories', debts.weOweFactories, Math.max(0, -qolgan));
  eqNum('debts.factoryPayableOpen', debts.factoryPayableOpen, Math.max(0, olingan - berilgan));

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
  eq('hamma buyurtma tannarxi FINAL', settled, items.length);
  eq('preview soni bilan bir xil', prev.factoryOrdersSettled, settled);

  console.log('\n6) ROLLBACK — zavod hisobi nolga tushadi');
  const rb = await api('POST', `/import/${id}/rollback`);
  eq('rollback ledgerSum', rb.ledgerSum, '0.00');
  eqNum('rollbackdan keyin zavod balansi', (await api('GET', '/factories')).items[0]?.balance ?? 0, 0);

  console.log(`\n${fails === 0 ? 'ZAVOD HISOBI E2E OʼTDI ✓ — «Завод» bloki bilan aynan bir xil' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
