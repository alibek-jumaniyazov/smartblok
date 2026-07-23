// Mijozlar (Client) list-filter regression suite — the exact failure the owner reported:
//   «Mijozlar page da agent orqali filter qilinadigan joy ishlamayabdi»
//
// Before the fix, GET /clients bound the bare PageQueryDto (page/pageSize/search only).
// With main.ts ValidationPipe forbidNonWhitelisted:true, picking an agent sent ?agentId=<uuid>
// and the WHOLE list 400'd ("property agentId should not exist") — the table blanked and the
// counter read 0. Even had it passed validation, the service never applied agentId. Now
// ClientQueryDto whitelists agentId and the service filters on it (agentScope still pins an
// AGENT user to their own clients, so a foreign agentId can't widen scope).
//
// Run (isolated DB, never against dev data):
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx prisma migrate deploy
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx tsx prisma/seed.ts
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   node test/clients-filter.e2e.mjs
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
const has = (list, id) => items(list).some((c) => c.id === id);

// run-unique so the suite is re-runnable against a non-fresh DB
const R = Date.now().toString().slice(-6);

async function main() {
  const admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.accessToken;
  ok(!!admin, 'admin login');

  // ── setup: two agents, three clients (one per agent + one unassigned) ──
  console.log('\n— setup —');
  const agentA = (await req('POST', '/agents', { name: `FiltA ${R}` }, admin, 201)).body;
  const agentB = (await req('POST', '/agents', { name: `FiltB ${R}` }, admin, 201)).body;
  ok(!!agentA?.id && !!agentB?.id, 'two agents created');

  const c1 = (await req('POST', '/clients', { name: `C1 ${R}`, agentId: agentA.id }, admin, 201)).body;
  const c2 = (await req('POST', '/clients', { name: `C2 ${R}`, agentId: agentB.id }, admin, 201)).body;
  const c3 = (await req('POST', '/clients', { name: `C3 ${R}` }, admin, 201)).body;
  ok(!!c1?.id && !!c2?.id && !!c3?.id, 'three clients created (A, B, unassigned)');

  // ── 1. THE regression: the agent filter no longer 400s and actually filters ──
  console.log('\n— 1. agent filter returns 200 and only that agent’s clients —');
  const onlyA = await req('GET', `/clients?pageSize=200&agentId=${agentA.id}`, undefined, admin, 200);
  ok(has(onlyA.body, c1.id), 'agentId=A includes A’s client (C1)');
  ok(!has(onlyA.body, c2.id), 'agentId=A excludes B’s client (C2)');
  ok(!has(onlyA.body, c3.id), 'agentId=A excludes the unassigned client (C3)');
  ok(items(onlyA.body).every((c) => c.agentId === agentA.id || c.agent?.id === agentA.id),
    'EVERY row of agentId=A belongs to agent A');

  const onlyB = await req('GET', `/clients?pageSize=200&agentId=${agentB.id}`, undefined, admin, 200);
  ok(has(onlyB.body, c2.id), 'agentId=B includes B’s client (C2)');
  ok(!has(onlyB.body, c1.id), 'agentId=B excludes A’s client (C1)');

  // ── 2. no filter → all three present (agent filter did not leak into the unfiltered view) ──
  console.log('\n— 2. unfiltered list still returns everyone —');
  const all = await req('GET', '/clients?pageSize=200', undefined, admin, 200);
  ok(has(all.body, c1.id) && has(all.body, c2.id) && has(all.body, c3.id), 'unfiltered list has C1, C2 and C3');

  // ── 3. search still works AND composes with the agent filter ──
  console.log('\n— 3. search + agent filter compose —');
  const searched = await req('GET', `/clients?pageSize=200&search=${encodeURIComponent(`C1 ${R}`)}`, undefined, admin, 200);
  ok(has(searched.body, c1.id), 'search by name finds C1');

  const bothMatch = await req('GET', `/clients?pageSize=200&agentId=${agentA.id}&search=${encodeURIComponent(`C1 ${R}`)}`, undefined, admin, 200);
  ok(has(bothMatch.body, c1.id), 'agentId=A + search=C1 → C1 (both conditions satisfied)');

  const conflicting = await req('GET', `/clients?pageSize=200&agentId=${agentB.id}&search=${encodeURIComponent(`C1 ${R}`)}`, undefined, admin, 200);
  ok(!has(conflicting.body, c1.id), 'agentId=B + search=C1 → C1 excluded (wrong agent), filters AND together');

  // ── 4. the whitelist is still strict — a garbage param / bad uuid is rejected ──
  console.log('\n— 4. validation stays strict —');
  await req('GET', '/clients?agentId=not-a-uuid', undefined, admin, 400);
  await req('GET', '/clients?bogusParam=1', undefined, admin, 400);

  console.log(`\n${failures === 0 ? '✓ ALL GREEN' : `✗ ${failures} FAILED`} — ${checks} checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
