// SmartBlok v3 financial-core E2E. Drives a live API instance over HTTP and
// asserts every ledger/kassa/pallet/bonus invariant from docs/audit/excel-spec.md.
//
// Run (isolated DB, never against dev data):
//   createdb -p 5433 -U postgres -h localhost smartblok_test   (once)
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx prisma migrate deploy
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx tsx prisma/seed.ts
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   node test/e2e-core.mjs
const BASE = process.env.API_URL || 'http://localhost:4100/api';

let failures = 0;
let checks = 0;
const num = (v) => (v == null ? 0 : Number(v));
const eq = (actual, expected, label) => {
  checks++;
  const a = num(actual);
  const e = num(expected);
  if (Math.abs(a - e) > 0.01) {
    failures++;
    console.error(`  ✗ ${label}: expected ${e}, got ${a}`);
  } else {
    console.log(`  ✓ ${label} = ${e}`);
  }
};
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
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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

async function main() {
  console.log('— login —');
  const admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.accessToken;
  const agentTok = (await req('POST', '/auth/login', { username: 'jamol', password: 'agent123' })).body.accessToken;
  ok(!!admin && !!agentTok, 'admin + agent logins');

  console.log('— catalog discovery —');
  const products = items((await req('GET', '/products', undefined, admin)).body);
  const product = products.find((p) => p.size === '600x300x200') || products[0];
  const agents = items((await req('GET', '/agents', undefined, admin)).body);
  const jamol = agents.find((a) => a.name === 'Жамол') || agents[0];
  const cashboxes = items((await req('GET', '/kassa/cashboxes', undefined, admin)).body);
  const cashBox = cashboxes.find((c) => c.type === 'CASH' && c.currency === 'UZS');
  const bankBox = cashboxes.find((c) => c.type === 'BANK');
  const usdBox = cashboxes.find((c) => c.currency === 'USD');
  const factories = items((await req('GET', '/factories', undefined, admin)).body);
  const factory = factories[0];
  ok(!!product && !!jamol && !!cashBox && !!bankBox && !!factory, 'seeded catalog present');

  const vehicle = (
    await req('POST', '/vehicles', { name: 'Test truck', plate: '95 G 851 NA', driver: 'Test Driver', capacityPallets: 19 }, admin)
  ).body;

  console.log('— bonus program: 10 000 UZS/m³ —');
  await req('POST', `/factories/${factory.id}/bonus-program`, { kind: 'PER_M3', ratePerM3: 10000 }, admin, 201);

  console.log('— client + order (19 pallets, lump-sum 24 624 000) —');
  const client = (
    await req('POST', '/clients', { name: 'E2E Client', agentId: jamol.id, phone: '+998900000000' }, admin)
  ).body;
  // 19 pallets × 1.728 = 32.832 m³; lump 24 624 000 → 750 000/m³ exactly
  const order1 = (
    await req(
      'POST',
      '/orders',
      {
        clientId: client.id,
        date: '2026-07-11',
        vehicleId: vehicle.id,
        intendedPaymentMethod: 'BANK',
        transportMode: 'DEALER_CHARGED',
        transportCost: 150000,
        transportCharge: 200000,
        items: [{ productId: product.id, palletCount: 19, saleLumpSum: 24624000 }],
      },
      admin,
    )
  ).body;
  ok(order1?.id, 'order created ' + (order1?.orderNo ?? ''));
  eq(order1?.saleTotal, 24624000, 'order saleTotal exact (lump-sum)');
  // cost: 32.832 × 625000 + 19 × 130000 = 20 520 000 + 2 470 000 = 22 990 000
  eq(order1?.costTotal, 22990000, 'order costTotal (blocks + pallets)');

  let c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  eq(c.balance, 24624000 + 200000, 'client balance = sale + transport charge');
  eq(c.palletBalance, 19, 'client pallet balance 19');

  let debts = (await req('GET', '/debts/summary', undefined, admin)).body;
  eq(debts.weOweVehicles, 150000, 'vehicle liability 150k');

  console.log('— client payment 10 000 000 cash —');
  const pay1 = (
    await req(
      'POST',
      '/payments',
      { kind: 'CLIENT_IN', clientId: client.id, amount: 10000000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11', idempotencyKey: 'e2e-pay1' },
      admin,
    )
  ).body;
  // idempotency: same key returns same payment, no double post
  const pay1b = (
    await req(
      'POST',
      '/payments',
      { kind: 'CLIENT_IN', clientId: client.id, amount: 10000000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11', idempotencyKey: 'e2e-pay1' },
      admin,
    )
  ).body;
  ok(pay1.id === pay1b.id, 'idempotency key blocks double-submit');
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  eq(c.balance, 24824000 - 10000000, 'client balance after payment');

  console.log('— factory payment + allocation finalizes cost —');
  const fpay = (
    await req(
      'POST',
      '/payments',
      { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 22990000, method: 'BANK', cashboxId: bankBox.id, date: '2026-07-11' },
      admin,
    )
  ).body;
  await req('POST', `/payments/${fpay.id}/allocations`, { allocations: [{ orderId: order1.id, amount: 22990000 }] }, admin, 201);
  const o1 = (await req('GET', `/orders/${order1.id}`, undefined, admin)).body;
  ok(o1.costStatus === 'FINAL', 'costStatus FINAL after full allocation');

  console.log('— complete order → bonus accrual 32.832 × 10 000 —');
  for (const st of ['CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED']) {
    await req('PATCH', `/orders/${order1.id}/status`, { to: st }, admin);
  }
  const wallets = items((await req('GET', '/bonus/wallets', undefined, admin)).body);
  const wallet = wallets.find((w) => (w.factory?.id ?? w.factoryId) === factory.id);
  eq(wallet?.balance, 328320, 'bonus wallet = 32.832 m³ × 10 000');

  console.log('— bonus withdraw + offset —');
  await req('POST', '/bonus/withdraw', { factoryId: factory.id, amount: 100000, cashboxId: cashBox.id }, admin, 201);
  await req('POST', '/bonus/offset', { factoryId: factory.id, amount: 100000 }, admin, 201);
  const wallets2 = items((await req('GET', '/bonus/wallets', undefined, admin)).body);
  const wallet2 = wallets2.find((w) => (w.factory?.id ?? w.factoryId) === factory.id);
  eq(wallet2?.balance, 128320, 'wallet after withdraw+offset');

  console.log('— transport direct (client pays driver 150k) —');
  await req(
    'POST',
    '/payments',
    { kind: 'TRANSPORT_DIRECT', clientId: client.id, vehicleId: vehicle.id, amount: 150000, method: 'CASH', date: '2026-07-11', allocations: [{ orderId: order1.id, amount: 150000 }] },
    admin,
  );
  debts = (await req('GET', '/debts/summary', undefined, admin)).body;
  eq(debts.weOweVehicles, 0, 'vehicle settled by client-direct payment');
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  eq(c.balance, 14824000 - 150000, 'client credited for paying the driver');

  console.log('— pallets: return 5, charge 2 lost —');
  await req('POST', '/pallets/client-return', { clientId: client.id, qty: 5, date: '2026-07-11' }, admin, 201);
  await req('POST', '/pallets/charge-lost', { clientId: client.id, qty: 2, date: '2026-07-11', unitPrice: 130000 }, admin, 201);
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  eq(c.palletBalance, 12, 'pallet balance 19−5−2');
  eq(c.balance, 14674000 + 260000, 'client charged 260k for lost pallets');

  console.log('— USD payment —');
  if (usdBox) {
    await req(
      'POST',
      '/payments',
      { kind: 'CLIENT_IN', clientId: client.id, method: 'USD', usdAmount: 100, rate: 12700, cashboxId: usdBox.id, date: '2026-07-11' },
      admin,
    );
    c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
    eq(c.balance, 14934000 - 1270000, 'client credited usd×rate');
  }

  console.log('— void payment restores balances + kassa reversal —');
  const balBefore = num(c.balance);
  await req('POST', `/payments/${pay1.id}/void`, { reason: 'E2E test void' }, admin, 201);
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  eq(c.balance, balBefore + 10000000, 'void restored 10M to receivable');
  await req('DELETE', `/payments/${pay1.id}`, undefined, admin, 404); // no hard delete route may exist

  console.log('— second order + cancel reverses everything —');
  const order2 = (
    await req(
      'POST',
      '/orders',
      { clientId: client.id, date: '2026-07-11', vehicleId: vehicle.id, transportMode: 'CLIENT_OWN', items: [{ productId: product.id, palletCount: 18 }] },
      admin,
    )
  ).body;
  const balAfterO2 = num((await req('GET', `/clients/${client.id}`, undefined, admin)).body.balance);
  await req('DELETE', `/orders/${order2.id}`, { reason: 'E2E cancel' }, admin);
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  // 18 pallets × 1.728 × 750000 = 23 328 000
  eq(balAfterO2 - num(c.balance), 23328000, 'cancel reversed the sale posting');
  eq(c.palletBalance, 12, 'cancel reversed pallet delivery');

  console.log('— credit limit + agent debt limit gates —');
  const limited = (
    await req('POST', '/clients', { name: 'E2E Limited', agentId: jamol.id, creditLimit: 1000000 }, admin)
  ).body;
  await req(
    'POST',
    '/orders',
    { clientId: limited.id, date: '2026-07-11', transportMode: 'CLIENT_OWN', items: [{ productId: product.id, palletCount: 18 }] },
    admin,
    400,
  );
  await req('PUT', `/agents/${jamol.id}`, { debtLimit: 1000000 }, admin);
  await req(
    'POST',
    '/orders',
    { clientId: client.id, date: '2026-07-11', transportMode: 'CLIENT_OWN', items: [{ productId: product.id, palletCount: 18 }] },
    admin,
    400,
  ); // client already owes > 1M ⇒ agent gate must block
  await req('PUT', `/agents/${jamol.id}`, { debtLimit: null }, admin);

  console.log('— AGENT role scoping —');
  await req('GET', '/agents', undefined, agentTok, 403);
  await req('GET', '/bonus/wallets', undefined, agentTok, 403);
  await req('GET', '/settings', undefined, agentTok, 403);
  const foreign = (await req('POST', '/clients', { name: 'E2E Foreign' }, admin)).body; // no agent
  await req('GET', `/clients/${foreign.id}`, undefined, agentTok, 403);
  const own = (await req('GET', `/clients/${client.id}`, undefined, agentTok)).body;
  ok(own?.id === client.id, 'agent reads own client');
  await req('PUT', `/clients/${foreign.id}`, { name: 'stolen' }, agentTok, 403);
  await req('DELETE', `/orders/${order1.id}`, { reason: 'x' }, agentTok, 403);

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
