// Moshinalar (Vehicle) regression suite — the exact failures the owner reported:
//   «moshina qo'shmoqchi bo'lsam u moshina bor deydi, lekin u narsa yozilmagan
//    va moshinalar table da ham yo'q; excelda bor lekin moshinalarda yo'q»
//
// Covers: blank plates must never collide, normalized-plate uniqueness (case / spacing /
// Cyrillic lookalikes), a conflict that NAMES the blocking vehicle and is recoverable,
// the list never silently truncating the fleet, and oneTime trucks staying out of it.
//
// Run (isolated DB, never against dev data):
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx prisma migrate deploy
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx tsx prisma/seed.ts
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   node test/vehicles.e2e.mjs
const BASE = process.env.API_URL || 'http://localhost:4100/api';

let failures = 0;
let checks = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
};
const eqs = (actual, expected, label) => ok(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);

async function req(method, path, body, token, expectStatus) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (expectStatus !== undefined) {
    checks++;
    if (res.status !== expectStatus) {
      failures++;
      console.error(`  ✗ ${method} ${path} → ${res.status} (expected ${expectStatus}): ${text.slice(0, 200)}`);
    } else {
      console.log(`  ✓ ${method} ${path} → ${res.status}`);
    }
  } else if (res.status >= 400) {
    failures++;
    checks++;
    console.error(`  ✗ ${method} ${path} FAILED ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: json };
}
const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));

// run-unique so the suite is re-runnable against a non-fresh DB
const R = Date.now().toString().slice(-5);
const P = (suffix) => `77 Z ${R} ${suffix}`; // distinct, valid-looking plates

async function main() {
  const admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.accessToken;
  ok(!!admin, 'admin login');

  // ── 1. blank plates: THE regression test for «bor deydi, lekin yozilmagan» ──
  console.log('\n— 1. plate-less vehicles never collide —');
  const a = (await req('POST', '/vehicles', { name: `Plateless A ${R}` }, admin, 201)).body;
  const b = (await req('POST', '/vehicles', { name: `Plateless B ${R}`, plate: '' }, admin, 201)).body;
  eqs(a.plate, null, 'omitted plate stored as NULL');
  eqs(b.plate, null, "empty-string plate stored as NULL (not '')");
  // the edit form used to round-trip '' back to the server — must stay a no-op
  const a2 = (await req('PUT', `/vehicles/${a.id}`, { plate: '' }, admin, 200)).body;
  const b2 = (await req('PUT', `/vehicles/${b.id}`, { plate: '   ' }, admin, 200)).body;
  eqs(a2.plate, null, "PUT plate:'' keeps NULL");
  eqs(b2.plate, null, "PUT plate:'   ' keeps NULL");
  const c = (await req('POST', '/vehicles', { name: `Plateless C ${R}`, plate: '  ' }, admin, 201)).body;
  eqs(c.plate, null, 'a third plate-less vehicle is still allowed');

  // ── 2. normalization: one physical truck = one row ──
  console.log('\n— 2. normalized plate uniqueness —');
  const n1 = (await req('POST', '/vehicles', { name: `N1 ${R}`, plate: P('ca').toLowerCase() }, admin, 201)).body;
  eqs(n1.plate, P('CA'), 'plate stored canonically (upper, spaces collapsed)');

  const dupSpacing = await req('POST', '/vehicles', { name: `N2 ${R}`, plate: P('CA').replace(/\s+/g, '') }, admin, 409);
  eqs(dupSpacing.body?.code, 'VEHICLE_PLATE_TAKEN', 'spacing-only duplicate → 409 VEHICLE_PLATE_TAKEN');
  eqs(dupSpacing.body?.vehicleName, `N1 ${R}`, 'conflict names the blocking vehicle');
  eqs(dupSpacing.body?.vehicleActive, true, 'conflict reports the holder as active');
  ok(!!dupSpacing.body?.vehicleId, 'conflict carries the vehicleId (web opens it)');

  // Cyrillic lookalikes: С→C, А→A — the importer folds these, manual entry must too
  const dupCyr = await req('POST', '/vehicles', { name: `N3 ${R}`, plate: P('СА') }, admin, 409);
  eqs(dupCyr.body?.code, 'VEHICLE_PLATE_TAKEN', 'Cyrillic-lookalike duplicate → 409');

  // ── 3. self-update must not self-conflict ──
  console.log('\n— 3. a vehicle never conflicts with itself —');
  await req('PUT', `/vehicles/${n1.id}`, { plate: P('CA') }, admin, 200);
  await req('PUT', `/vehicles/${n1.id}`, { plate: P('ca').toLowerCase() }, admin, 200);

  // ── 4. an archived holder is recoverable, not a dead end ──
  console.log('\n— 4. inactive holder → reactivation path —');
  await req('DELETE', `/vehicles/${n1.id}`, undefined, admin, 200);
  const dupInactive = await req('POST', '/vehicles', { name: `N4 ${R}`, plate: P('CA') }, admin, 409);
  eqs(dupInactive.body?.vehicleActive, false, 'conflict reports the holder as INACTIVE');
  ok(/NOFAOL/.test(dupInactive.body?.message ?? ''), 'message says the holder is NOFAOL');
  const revived = (await req('PUT', `/vehicles/${n1.id}`, { active: true }, admin, 200)).body;
  eqs(revived.active, true, 'the blocked plate is recovered by reactivating its holder');

  // ── 5. the list is never silently truncated ──
  console.log('\n— 5. list paging tells the truth —');
  const firstPage = (await req('GET', '/vehicles?pageSize=1', undefined, admin, 200)).body;
  ok(firstPage.total > 1, `total (${firstPage.total}) reflects the whole fleet, not the page`);
  eqs(items(firstPage).length, 1, 'pageSize is honoured');
  const big = (await req('GET', '/vehicles?pageSize=200', undefined, admin, 200)).body;
  eqs(items(big).length, Math.min(big.total, 200), 'pageSize=200 returns every vehicle up to the cap');
  ok(
    items(big).some((v) => v.id === n1.id),
    'a vehicle beyond the old 50-row default is reachable',
  );

  // server-side search (it used to filter client-side over a truncated page)
  const searched = (await req('GET', `/vehicles?search=${encodeURIComponent(P('CA'))}`, undefined, admin, 200)).body;
  ok(
    items(searched).some((v) => v.id === n1.id),
    'server-side search finds the vehicle by plate',
  );

  // ── 6. active filter ──
  console.log('\n— 6. active filter —');
  await req('DELETE', `/vehicles/${c.id}`, undefined, admin, 200);
  const onlyActive = items((await req('GET', '/vehicles?pageSize=200&active=true', undefined, admin, 200)).body);
  const onlyInactive = items((await req('GET', '/vehicles?pageSize=200&active=false', undefined, admin, 200)).body);
  ok(!onlyActive.some((v) => v.id === c.id), 'active=true excludes the archived vehicle');
  ok(onlyInactive.some((v) => v.id === c.id), 'active=false returns the archived vehicle');
  ok(onlyInactive.every((v) => v.active === false), 'active=false returns ONLY archived vehicles');

  // ── 7. oneTime trucks stay out of the fleet ──
  console.log('\n— 7. one-time trucks never enter the fleet —');
  const fleet = items((await req('GET', '/vehicles?pageSize=200', undefined, admin, 200)).body);
  ok(fleet.every((v) => v.oneTime !== true), 'no oneTime vehicle appears in the list');

  console.log(`\n${failures === 0 ? '✓ ALL GREEN' : `✗ ${failures} FAILED`} — ${checks} checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
