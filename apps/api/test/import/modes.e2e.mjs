/**
 * Import modes E2E — re-importing the SAME file is allowed (no twin 409); APPEND adds a
 * second copy (N → 2N); REPLACE wipes the WHOLE database and rebuilds from this file (→ N).
 *
 * All expectations are RELATIVE to the first import, so the test stays valid whenever the
 * owner ships a new workbook (absolute numbers live in excel-parity.e2e.mjs).
 *   API_URL=http://localhost:4100/api node test/import/modes.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidePendingClients } from './_pending.mjs';

const BASE = process.env.API_URL || 'http://localhost:4100/api';
const XLSX = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../docs/Smart blok.xlsx');
const BYTES = readFileSync(XLSX);

let fails = 0;
const n = (v) => Number(v ?? 0);
const fm = (v) => n(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const eqNum = (label, got, want, eps = 1) => {
  const good = Math.abs(n(got) - n(want)) <= eps;
  console.log(`${good ? '  ✓' : '  ✗'} ${label}: ${fm(got)}${good ? '' : `   (kutilgan ${fm(want)})`}`);
  if (!good) fails++;
};
const eq = (label, got, want) => {
  const good = String(got) === String(want);
  console.log(`${good ? '  ✓' : '  ✗'} ${label}: ${got}${good ? '' : `   (kutilgan ${want})`}`);
  if (!good) fails++;
};

let token = '';
async function api(method, path, body, isForm = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, ok: res.ok, json, text };
}
async function must(method, path, body, isForm = false) {
  const r = await api(method, path, body, isForm);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
}

async function upload() {
  const form = new FormData();
  form.append('file', new Blob([BYTES]), 'Smart blok.xlsx');
  return api('POST', '/import/upload', form, true); // raw so we can inspect status
}
/** upload → decide pending names → preview(mode) → commit(mode); returns {id, prev} */
async function importFile(mode) {
  const up = await upload();
  if (!up.ok) throw new Error(`upload failed ${up.status}: ${up.text.slice(0, 200)}`);
  const id = up.json.batch.id;
  await decidePendingClients(must, id);
  const prev = await must('POST', `/import/${id}/preview`, { mode });
  await must('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash, mode });
  return { id, prev };
}
const allTime = async () => (await must('GET', '/dashboard/summary')).allTime;

async function main() {
  token = (await must('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;

  console.log('1) Birinchi import (APPEND) — bazaviy oʼlcham');
  const first = await importFile('APPEND');
  const base = await allTime();
  const baseCapital = n(first.prev.cashCapital);
  console.log(`   bazaviy: ${base.orders} buyurtma · savdo ${fm(base.sales)} · sof foyda ${fm(base.netProfit)} · kapital ${fm(baseCapital)}`);
  if (!base.orders) { console.log('  ✗ birinchi import boʼsh — test maʼnosiz'); process.exit(1); }

  console.log("\n2) AYNI faylni QAYTA yuklash — bloklanmaydi, APPEND ikkilantiradi");
  const reUp = await upload();
  eq('qayta upload status 2xx (409 emas)', reUp.ok, true);
  const id2 = reUp.json.batch.id;
  await decidePendingClients(must, id2);
  const prev2 = await must('POST', `/import/${id2}/preview`, { mode: 'APPEND' });
  await must('POST', `/import/${id2}/commit`, { confirmToken: prev2.previewHash, mode: 'APPEND' });
  let a = await allTime();
  eq('APPEND → buyurtmalar 2×', a.orders, base.orders * 2);
  eqNum('APPEND → savdo 2×', a.sales, n(base.sales) * 2, 2);

  console.log('\n   Qoʼlda kiritilgan kassa + Naqd kassaga 100M — REPLACE ularni ham oʼchirishi kerak');
  const manualBoxName = `QOLDA-SAQLANMAYDI-${base.orders}-${String(base.sales).length}`;
  await must('POST', '/kassa/cashboxes', { name: manualBoxName, type: 'CASH', currency: 'UZS' });
  // 100M into «Naqd kassa»: a WRONG (append-semantics) REPLACE preview would report a
  // smaller cashCapital; the correct one wipes first and reproduces the fresh-import value
  const preBoxes = await must('GET', '/kassa/cashboxes');
  const naqdBox = preBoxes.find((b) => b.name === 'Naqd kassa');
  if (naqdBox) await must('POST', '/kassa/manual', { cashboxId: naqdBox.id, direction: 'IN', amount: 100_000_000, note: 'pre-replace' });

  console.log('\n3) Uchinchi import (REPLACE) — BUTUN baza oʼchirilib, faqat shu fayl quriladi');
  const id3Up = await upload();
  const id3 = id3Up.json.batch.id;
  eq('priorCommittedImports = 2', (await must('GET', `/import/${id3}`)).priorCommittedImports, 2);
  await decidePendingClients(must, id3);
  const prev3 = await must('POST', `/import/${id3}/preview`, { mode: 'REPLACE' });
  eqNum('REPLACE preview cashCapital = toza importdagi qiymat (wipe preview ichida ham ishladi)', prev3.cashCapital, baseCapital);
  await must('POST', `/import/${id3}/commit`, { confirmToken: prev3.previewHash, mode: 'REPLACE' });
  a = await allTime();
  eq('REPLACE → buyurtmalar bazaviy holatga qaytdi', a.orders, base.orders);
  eqNum('REPLACE → savdo bazaviy', a.sales, base.sales, 2);
  eqNum('REPLACE → sof foyda bazaviy', a.netProfit, base.netProfit, 2);
  eqNum('REPLACE → mijozlar balansi bazaviy', a.clientsOweUs, base.clientsOweUs, 2);
  eq('REPLACE dan keyin priorCommittedImports = 0', (await must('GET', `/import/${id3}`)).priorCommittedImports, 0);

  console.log('\n4) BUTUN baza tozalanganini tekshirish');
  eq('avvalgi import butunlay oʼchirilgan (404)', (await api('GET', `/import/${id2}`)).status, 404);
  const boxes = await must('GET', '/kassa/cashboxes');
  eq('qoʼlda kiritilgan kassa ham oʼchirilgan (butun baza)', boxes.some((b) => b.name === manualBoxName), false);
  eq('hech bir kassa manfiy emas', boxes.filter((b) => n(b.balance) < -0.01).length, 0);

  console.log(`\n${fails === 0 ? 'IMPORT MODES E2E OʼTDI ✓ — re-import + APPEND + REPLACE ishlaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
