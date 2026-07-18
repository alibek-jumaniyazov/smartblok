/**
 * Import modes E2E: re-importing the SAME file is allowed (no twin 409); APPEND adds a
 * second copy; REPLACE rolls back the prior imports and leaves only the latest file.
 *   API_URL=http://localhost:4100/api node test/import/modes.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.API_URL || 'http://localhost:4100/api';
const XLSX = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../docs/Smart blok.xlsx');
const BYTES = readFileSync(XLSX);

let fails = 0;
const eqNum = (label, got, want, eps = 0.5) => {
  const ok = Math.abs(Number(got) - Number(want)) <= eps;
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
  return api('POST', '/import/upload', form, true); // return raw so we can inspect status
}
async function importFile(mode) {
  const up = await upload();
  if (!up.ok) throw new Error(`upload failed ${up.status}: ${up.text.slice(0, 200)}`);
  const id = up.json.batch.id;
  const prev = await must('POST', `/import/${id}/preview`);
  await must('POST', `/import/${id}/commit`, { confirmToken: prev.previewHash, mode });
  return id;
}
const allTime = async () => (await must('GET', '/dashboard/summary')).allTime;
const committedBatches = async () => {
  // count committed import batches via each batch status (no list endpoint) — use ledger proof instead
  return null;
};

async function main() {
  token = (await must('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;

  console.log('1) Birinchi import (APPEND)');
  await importFile('APPEND');
  let a = await allTime();
  eq('allTime.orders = 21', a.orders, 21);
  eqNum('allTime.sales ≈ 501.4M', a.sales, 501414039.36, 1);

  console.log("2) AYNI faylni QAYTA yuklash — endi bloklanmaydi (409 yo'q)");
  const reUp = await upload();
  eq("qayta upload status 2xx (409 emas)", reUp.ok, true);
  // stage+commit the second copy as APPEND
  const id2 = reUp.json.batch.id;
  const prev2 = await must('POST', `/import/${id2}/preview`);
  await must('POST', `/import/${id2}/commit`, { confirmToken: prev2.previewHash, mode: 'APPEND' });
  a = await allTime();
  eq('APPEND → allTime.orders = 42 (21+21)', a.orders, 42);
  eqNum('APPEND → allTime.sales ≈ 1002.8M', a.sales, 1002828078.72, 2);

  console.log('3) Uchinchi import (REPLACE) — avvalgi 2 tasi orqaga qaytadi');
  const id3Up = await upload();
  const id3 = id3Up.json.batch.id;
  const sum3 = await must('GET', `/import/${id3}`);
  eq('priorCommittedImports = 2', sum3.priorCommittedImports, 2);
  const prev3 = await must('POST', `/import/${id3}/preview`);
  await must('POST', `/import/${id3}/commit`, { confirmToken: prev3.previewHash, mode: 'REPLACE' });
  a = await allTime();
  eq('REPLACE → allTime.orders = 21 (faqat oxirgi)', a.orders, 21);
  eqNum('REPLACE → allTime.sales ≈ 501.4M', a.sales, 501414039.36, 1);
  eqNum('REPLACE → sof foyda ≈ 117.5M', a.netProfit, 117498039.36, 1);
  // the new batch is the only committed one now
  const sum3after = await must('GET', `/import/${id3}`);
  eq('REPLACE dan keyin priorCommittedImports = 0', sum3after.priorCommittedImports, 0);

  console.log(`\n${fails === 0 ? 'IMPORT MODES E2E OʼTDI ✓ — re-import + APPEND + REPLACE ishlaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
