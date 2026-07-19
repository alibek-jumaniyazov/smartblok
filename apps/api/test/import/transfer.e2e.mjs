/**
 * Kassa transfer E2E: move money between cashboxes/bank accounts. Proves the paired
 * TRANSFER rows (shared transferPairId), correct balances, and the never-below-zero
 * guard (a transfer larger than the source balance, or onto the same box, is rejected).
 *   API_URL=http://localhost:4100/api node test/import/transfer.e2e.mjs
 */
const BASE = process.env.API_URL || 'http://localhost:4100/api';

let fails = 0;
const eqNum = (label, got, want, eps = 0.01) => {
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
async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, ok: res.ok, json, text };
}
async function must(method, path, body) {
  const r = await api(method, path, body);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
}
const balanceOf = async (id) => {
  const boxes = await must('GET', '/kassa/cashboxes');
  return Number(boxes.find((b) => b.id === id)?.balance ?? NaN);
};

async function main() {
  token = (await must('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;
  const tag = `${Date.now()}`.slice(-7);

  console.log('1) Ikki kassa yaratamiz (naqd A + bank B)');
  const A = await must('POST', '/kassa/cashboxes', { name: `Oʼtkazma-A-${tag}`, type: 'CASH', currency: 'UZS' });
  const B = await must('POST', '/kassa/cashboxes', { name: `Oʼtkazma-B-${tag}`, type: 'BANK', currency: 'UZS' });

  console.log('2) A ga 5 000 000 kirim, soʼng 2 000 000 ni B ga oʼtkazamiz');
  await must('POST', '/kassa/manual', { cashboxId: A.id, direction: 'IN', amount: 5_000_000, note: 'test' });
  const tr = await must('POST', '/kassa/transfer', { fromCashboxId: A.id, toCashboxId: B.id, amount: 2_000_000, note: 'test oʼtkazma' });
  eq('oʼtkazma juftligi (transferPairId) bor', !!tr.transferPairId, true);
  eq('OUT satri source=TRANSFER', tr.out.source, 'TRANSFER');
  eq('IN satri source=TRANSFER', tr.in.source, 'TRANSFER');
  eq('juftlik bir xil transferPairId', tr.out.transferPairId === tr.in.transferPairId, true);
  eqNum('A balans (5M − 2M)', await balanceOf(A.id), 3_000_000);
  eqNum('B balans (0 + 2M)', await balanceOf(B.id), 2_000_000);

  console.log('3) Manba yetмаган oʼtkazma rad etiladi (kassa manfiyga tushmaydi)');
  const over = await api('POST', '/kassa/transfer', { fromCashboxId: A.id, toCashboxId: B.id, amount: 10_000_000 });
  eq('yetarli mablagʼ yoʼq → 400', over.status, 400);
  eqNum('A balans oʼzgармаган (3M)', await balanceOf(A.id), 3_000_000);

  console.log('4) Bir xil kassaga oʼtkazma rad etiladi');
  const same = await api('POST', '/kassa/transfer', { fromCashboxId: A.id, toCashboxId: A.id, amount: 100_000 });
  eq('bir xil kassa → 400', same.status, 400);

  console.log(`\n${fails === 0 ? 'TRANSFER E2E OʼTDI ✓ — oʼtkazma ishlaydi, kassa manfiyga tushmaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
