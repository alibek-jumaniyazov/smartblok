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

  // plate must be run-unique: it is now unique on the NORMALIZED key, so a fixed plate
  // would 409 on a re-run against a non-fresh DB and cascade into every later assertion.
  const runId = Date.now().toString().slice(-6);
  const vehicle = (
    await req(
      'POST',
      '/vehicles',
      { name: `Test truck ${runId}`, plate: `95 G ${runId.slice(0, 3)} NA`, driver: 'Test Driver', capacityPallets: 19 },
      admin,
      201,
    )
  ).body;

  // opening balances — OUT payments enforce never-below-zero, like the real books
  await req('POST', '/kassa/manual', { cashboxId: bankBox.id, direction: 'IN', amount: 60000000, note: 'opening balance' }, admin, 201);
  await req('POST', '/kassa/manual', { cashboxId: cashBox.id, direction: 'IN', amount: 5000000, note: 'opening balance' }, admin, 201);

  console.log('— bonus program: 10 000 UZS/m³ —');
  await req('POST', `/factories/${factory.id}/bonus-program`, { kind: 'PER_M3', ratePerM3: 10000 }, admin, 201);

  console.log('— price-less product: explicit price must NOT be blocked by an empty price book —');
  // Regression: buildOrderItems used to resolve the DEALER_SALE book UNCONDITIONALLY, so a
  // product with no price rows (exactly what the Excel importer produced) failed every
  // order with «… narxi kiritilmagan» even when the operator typed a price. The catalog
  // price still requires a book row — only the explicit-price path is exempt.
  const bareProduct = (
    await req('POST', '/products', { factoryId: factory.id, name: 'E2E narxsiz blok', m3PerPallet: 1.728 }, admin)
  ).body;
  const bareClient = (await req('POST', '/clients', { name: 'E2E Bare Client', phone: '+998900000009' }, admin)).body;
  const bareOrder = (
    await req(
      'POST',
      '/orders',
      {
        clientId: bareClient.id,
        date: '2026-07-11',
        transportMode: 'CLIENT_OWN',
        items: [{ productId: bareProduct.id, palletCount: 1, salePricePerM3: 800000 }],
      },
      admin,
    )
  ).body;
  ok(bareOrder?.id, 'order accepted for a product with an EMPTY price book (explicit price)');
  eq(bareOrder?.saleTotal, 1382400, 'saleTotal = 1.728 m³ × 800 000 (no book row needed)');
  // pallets are IN-KIND (2026-07-21): with no factory price at all the cost is simply 0 —
  // it no longer silently falls back to «pallets × 130 000»
  eq(bareOrder?.costTotal, 0, 'costTotal is 0 when no factory price exists (pallets are not money)');
  // …but the CATALOG path still needs a book row, and must say so clearly
  const noPrice = await req(
    'POST',
    '/orders',
    {
      clientId: bareClient.id,
      date: '2026-07-11',
      transportMode: 'CLIENT_OWN',
      items: [{ productId: bareProduct.id, palletCount: 1 }],
    },
    admin,
    400,
  );
  ok(
    /narxi kiritilmagan/.test(JSON.stringify(noPrice.body)) &&
      /E2E narxsiz blok/.test(JSON.stringify(noPrice.body)),
    'catalog-price order rejected with a message naming the product',
  );

  // legacy on-top transport billing is retired — the enum value survives for old rows only
  await req(
    'POST',
    '/orders',
    {
      clientId: bareClient.id,
      date: '2026-07-11',
      transportMode: 'DEALER_CHARGED',
      transportCost: 100000,
      items: [{ productId: bareProduct.id, palletCount: 1, salePricePerM3: 800000 }],
    },
    admin,
    400,
  );

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
        // transport is INSIDE the goods total: the client hands the driver his 150 000
        // himself, so from the moment the order exists he owes the DEALER only the
        // remaining 24 474 000 — no payment entry is needed to make that true
        transportMode: 'CLIENT_PAYS_DRIVER',
        transportCost: 150000,
        items: [{ productId: product.id, palletCount: 19, saleLumpSum: 24624000 }],
      },
      admin,
    )
  ).body;
  ok(order1?.id, 'order created ' + (order1?.orderNo ?? ''));
  eq(order1?.saleTotal, 24624000, 'order saleTotal exact (lump-sum)');
  // cost: 32.832 × 625 000 = 20 520 000 — BLOCKS ONLY. The 19 pallets are owed to the
  // factory in kind (a count), never in money, so they add nothing here.
  eq(order1?.costTotal, 20520000, 'order costTotal (blocks only — pallets are in-kind)');

  let c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  // 24 624 000 goods − 150 000 the client hands the driver = 24 474 000 owed to the dealer
  eq(c.balance, 24624000 - 150000, 'client balance = goods total MINUS the driver slice');
  eq(num((await req('GET', `/orders/${order1.id}`, undefined, admin)).body.clientOutstanding), 24474000,
    'order clientOutstanding agrees with the client card (same money, same number)');
  eq(c.palletBalance, 19, 'client pallet balance 19');

  // final-at-create (2026-07-22): the factory cost + vehicle transport leg are posted at
  // ORDER CREATE now, not at a LOADING transition — no stepping needed.
  let debts = (await req('GET', '/debts/summary', undefined, admin)).body;
  // CLIENT_PAYS_DRIVER: the dealer is not in that money chain at all, so LOADING posts
  // NO vehicle leg (DEALER_ABSORBED still does — see order4 below)
  eq(debts.weOweVehicles, 0, 'no vehicle liability for a client-pays-driver order');

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
  eq(c.balance, 24474000 - 10000000, 'client balance after payment (off the NET basis)');

  console.log('— factory payment + allocation finalizes cost —');
  const fpay = (
    await req(
      'POST',
      '/payments',
      { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 20520000, method: 'BANK', cashboxId: bankBox.id, date: '2026-07-11' },
      admin,
    )
  ).body;
  await req('POST', `/payments/${fpay.id}/allocations`, { allocations: [{ orderId: order1.id, amount: 20520000 }] }, admin, 201);
  const o1 = (await req('GET', `/orders/${order1.id}`, undefined, admin)).body;
  ok(o1.costStatus === 'FINAL', 'costStatus FINAL after full allocation');

  console.log('— bonus accrued at create (final-at-create) —');
  const wallets = items((await req('GET', '/bonus/wallets', undefined, admin)).body);
  const wallet = wallets.find((w) => (w.factory?.id ?? w.factoryId) === factory.id);
  // final-at-create: EVERY order on this factory accrues at create — bareOrder (1.728 m³ ×
  // 10 000 = 17 280) + order1 (32.832 m³ × 10 000 = 328 320) = 345 600.
  eq(wallet?.balance, 345600, 'bonus wallet = bareOrder 17 280 + order1 328 320');

  console.log('— bonus withdraw + offset —');
  await req('POST', '/bonus/withdraw', { factoryId: factory.id, amount: 100000, cashboxId: cashBox.id }, admin, 201);
  await req('POST', '/bonus/offset', { factoryId: factory.id, amount: 100000 }, admin, 201);
  const wallets2 = items((await req('GET', '/bonus/wallets', undefined, admin)).body);
  const wallet2 = wallets2.find((w) => (w.factory?.id ?? w.factoryId) === factory.id);
  eq(wallet2?.balance, 145600, 'wallet after withdraw+offset (345 600 − 100 000 − 100 000)');

  console.log('— transport direct (client pays driver 150k) = RECORD ONLY —');
  // The carve-out already happened at order creation. This payment only documents that the
  // driver actually got his cash (and drives transportPaidStatus) — crediting the client a
  // second time here is exactly the double-deduction bug this assertion guards.
  const balBeforeTd = num(c.balance);
  await req(
    'POST',
    '/payments',
    { kind: 'TRANSPORT_DIRECT', clientId: client.id, vehicleId: vehicle.id, amount: 150000, method: 'CASH', date: '2026-07-11', allocations: [{ orderId: order1.id, amount: 150000 }] },
    admin,
  );
  debts = (await req('GET', '/debts/summary', undefined, admin)).body;
  eq(debts.weOweVehicles, 0, 'still no vehicle liability — nothing was owed to settle');
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  // 24 474 000 net − 10 000 000 paid to the dealer = 14 474 000, and the TRANSPORT_DIRECT
  // must move it by exactly nothing (a second credit would read 14 324 000)
  eq(c.balance, balBeforeTd, 'TRANSPORT_DIRECT is a NO-OP on the client balance');
  eq(c.balance, 14474000, 'client balance still the net receivable');
  ok(
    (await req('GET', `/orders/${order1.id}`, undefined, admin)).body.transportPaidStatus === 'PAID_BY_CLIENT',
    'transportPaidStatus → PAID_BY_CLIENT (the record still does its job)',
  );

  console.log('— pallets: return 5, charge 2 lost —');
  await req('POST', '/pallets/client-return', { clientId: client.id, qty: 5, date: '2026-07-11' }, admin, 201);
  await req('POST', '/pallets/charge-lost', { clientId: client.id, qty: 2, date: '2026-07-11', unitPrice: 130000 }, admin, 201);
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  eq(c.palletBalance, 12, 'pallet balance 19−5−2');
  eq(c.balance, 14474000 + 260000, 'client charged 260k for lost pallets');

  console.log('— USD payment (dollar mode of naqd/CASH) —');
  if (usdBox) {
    await req(
      'POST',
      '/payments',
      { kind: 'CLIENT_IN', clientId: client.id, method: 'CASH', usdAmount: 100, rate: 12700, usdCashboxId: usdBox.id, date: '2026-07-11' },
      admin,
      201,
    );
    c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
    eq(c.balance, 14734000 - 1270000, 'client credited usd×rate');
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

  // D1 (owner-locked): an AGENT must NEVER see any factory-cost-derived number. The order
  // card reaches agents (their own client's order), so its payload must be stripped of the
  // factory cost that lives on the order, its items, its FACTORY ledger rows and the
  // factory-price fields the office cockpit adds.
  const agentOrder = (await req('GET', `/orders/${order1.id}`, undefined, agentTok)).body;
  ok(agentOrder?.id === order1.id, 'agent reads own order card');
  const leakedTop = ['costTotal', 'costTotalCash', 'costTotalBank', 'factoryCoverage', 'factoryAdvance', 'factoryOutstanding', 'factoryPaid'];
  ok(leakedTop.every((k) => agentOrder?.[k] === undefined), 'agent order hides every factory-cost field');
  const itemLeak = (agentOrder?.items ?? []).some(
    (it) => it.costPricePerM3 !== undefined || it.finalCostPricePerM3 !== undefined || it.costTotal !== undefined || it.provisionalPriceKind !== undefined,
  );
  ok(!itemLeak, 'agent order items carry no factory cost price');
  const factoryLedgerLeak = (agentOrder?.ledgerEntries ?? []).some((e) => e.account === 'FACTORY');
  ok(!factoryLedgerLeak, 'agent order ledger has no FACTORY rows');
  // and the office user still SEES them (the strip is role-scoped, not a blanket removal)
  const officeOrder = (await req('GET', `/orders/${order1.id}`, undefined, admin)).body;
  ok(officeOrder?.costTotalCash !== undefined && officeOrder?.factoryCoverage !== undefined, 'office order still shows both factory prices');

  console.log('— REGRESSION: pallet reversal scope (return survives order cancel) —');
  // client pallet balance is 12 here
  const order3 = (
    await req(
      'POST',
      '/orders',
      { clientId: client.id, date: '2026-07-11', vehicleId: vehicle.id, transportMode: 'CLIENT_OWN', items: [{ productId: product.id, palletCount: 19 }] },
      admin,
    )
  ).body;
  await req('POST', '/pallets/client-return', { clientId: client.id, qty: 4, date: '2026-07-11' }, admin, 201);
  await req('DELETE', `/orders/${order3.id}`, { reason: 'regression' }, admin);
  c = (await req('GET', `/clients/${client.id}`, undefined, admin)).body;
  eq(c.palletBalance, 8, 'cancel reversed ONLY the delivery (12+19−4−19), return preserved');

  console.log('— REGRESSION: bonus offset void restores the wallet —');
  const wBefore = num(
    items((await req('GET', '/bonus/wallets', undefined, admin)).body).find(
      (w) => (w.factory?.id ?? w.factoryId) === factory.id,
    )?.balance,
  );
  const offset2 = (await req('POST', '/bonus/offset', { factoryId: factory.id, amount: 50000 }, admin)).body;
  const offsetPaymentId = offset2.payment?.id;
  ok(!!offsetPaymentId, 'offset returned its payment');
  await req('POST', `/payments/${offsetPaymentId}/void`, { reason: 'regression' }, admin, 201);
  const wAfter = num(
    items((await req('GET', '/bonus/wallets', undefined, admin)).body).find(
      (w) => (w.factory?.id ?? w.factoryId) === factory.id,
    )?.balance,
  );
  eq(wAfter, wBefore, 'voided offset returned the bonus to the wallet');

  console.log('— REGRESSION: inline allocations are ADMIN/ACCOUNTANT only —');
  const kassaTok = (await req('POST', '/auth/login', { username: 'kassa', password: 'kassa123' })).body.accessToken;
  await req(
    'POST',
    '/payments',
    { kind: 'CLIENT_IN', clientId: client.id, amount: 1000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11', allocations: [{ orderId: order1.id, amount: 1000 }] },
    kassaTok,
    403,
  );

  console.log('— REGRESSION: allocate→void→re-allocate cost cycle + PARTIAL —');
  // distinct CASH price so finalization has a real delta: 600 000/m³ from 2026-07-01
  await req('POST', `/products/${product.id}/prices`, { kind: 'FACTORY_CASH', pricePerM3: 600000, effectiveFrom: '2026-07-01' }, admin, 201);
  const cycleClient = (await req('POST', '/clients', { name: 'E2E Cycle', agentId: jamol.id }, admin)).body;
  const order4 = (
    await req(
      'POST',
      '/orders',
      { clientId: cycleClient.id, date: '2026-07-11', vehicleId: vehicle.id, transportMode: 'DEALER_ABSORBED', transportCost: 150000, items: [{ productId: product.id, palletCount: 18 }] },
      admin,
    )
  ).body;
  eq(order4.costTotal, 19440000, 'order4 provisional cost (31.104×625k, blocks only)');
  // final-at-create: cost is posted at create, so the factory payment can allocate immediately.
  // bank payment covers fully → FINAL at bank price (delta 0)
  const payA = (
    await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 19440000, method: 'BANK', cashboxId: bankBox.id, date: '2026-07-11' }, admin)
  ).body;
  await req('POST', `/payments/${payA.id}/allocations`, { allocations: [{ orderId: order4.id, amount: 19440000 }] }, admin, 201);
  let o4 = (await req('GET', `/orders/${order4.id}`, undefined, admin)).body;
  ok(o4.costStatus === 'FINAL', 'cycle: FINAL after bank allocation');
  await req('POST', `/payments/${payA.id}/void`, { reason: 'cycle' }, admin, 201);
  o4 = (await req('GET', `/orders/${order4.id}`, undefined, admin)).body;
  ok(o4.costStatus === 'PROVISIONAL', 'cycle: back to PROVISIONAL after void');
  eq(o4.costTotal, 19440000, 'cycle: provisional cost restored');
  // insufficient-cash guard on OUT payments, then fund and finalize at CASH price
  await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 21780000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11' }, admin, 400);
  await req('POST', '/kassa/manual', { cashboxId: cashBox.id, direction: 'IN', amount: 25000000, note: 'e2e funding' }, admin, 201);
  const payB1 = (
    await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 1000000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11' }, admin)
  ).body;
  await req('POST', `/payments/${payB1.id}/allocations`, { allocations: [{ orderId: order4.id, amount: 1000000 }] }, admin, 201);
  o4 = (await req('GET', `/orders/${order4.id}`, undefined, admin)).body;
  ok(o4.costStatus === 'PARTIAL', 'cycle: PARTIAL under the threshold');
  await req('POST', `/payments/${payB1.id}/allocations`, { allocations: [{ orderId: order4.id, amount: 1 }] }, admin, 400); // duplicate active pair
  const payB2 = (
    await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 17662400, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11' }, admin)
  ).body;
  await req('POST', `/payments/${payB2.id}/allocations`, { allocations: [{ orderId: order4.id, amount: 17662400 }] }, admin, 201);
  o4 = (await req('GET', `/orders/${order4.id}`, undefined, admin)).body;
  ok(o4.costStatus === 'FINAL', 'cycle: FINAL at cash price');
  eq(o4.costTotal, 18662400, 'cycle: fully cash-settled ⇒ EXACTLY the cash-price total (31.104×600k)');

  console.log('— REGRESSION: partial transport allocation must not read as PAID —');
  const payT = (
    await req('POST', '/payments', { kind: 'VEHICLE_OUT', vehicleId: vehicle.id, amount: 50000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11', allocations: [{ orderId: order4.id, amount: 50000 }] }, admin)
  ).body;
  o4 = (await req('GET', `/orders/${order4.id}`, undefined, admin)).body;
  ok(o4.transportPaidStatus === 'UNPAID', 'transport 50k/150k stays UNPAID');
  const payT2 = (
    await req('POST', '/payments', { kind: 'VEHICLE_OUT', vehicleId: vehicle.id, amount: 100000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11', allocations: [{ orderId: order4.id, amount: 100000 }] }, admin)
  ).body;
  o4 = (await req('GET', `/orders/${order4.id}`, undefined, admin)).body;
  ok(o4.transportPaidStatus === 'PAID', 'transport fully covered → PAID');
  await req('POST', `/payments/${payT2.id}/void`, { reason: 'regression' }, admin, 201);
  o4 = (await req('GET', `/orders/${order4.id}`, undefined, admin)).body;
  ok(o4.transportPaidStatus === 'UNPAID', 'void drops it back to UNPAID (50k remains)');
  ok(!!payT.id, 'transport payment ids captured');

  console.log('— REGRESSION: bonus withdrawal reversal —');
  // re-read the baseline HERE (final-at-create: later orders keep accruing to this wallet,
  // so a baseline captured earlier would be stale by exactly those accruals).
  const wBeforeWd = num(
    items((await req('GET', '/bonus/wallets', undefined, admin)).body).find(
      (w) => (w.factory?.id ?? w.factoryId) === factory.id,
    )?.balance,
  );
  const wd = (await req('POST', '/bonus/withdraw', { factoryId: factory.id, amount: 20000, cashboxId: cashBox.id }, admin)).body;
  await req('POST', `/bonus/transactions/${wd.id}/reverse`, { reason: 'regression' }, admin, 201);
  const wFinal = num(
    items((await req('GET', '/bonus/wallets', undefined, admin)).body).find(
      (w) => (w.factory?.id ?? w.factoryId) === factory.id,
    )?.balance,
  );
  eq(wFinal, wBeforeWd, 'reversed withdrawal restored the wallet');

  console.log('— pallet caps: over-return / over-charge / over-factory-return all blocked —');
  {
    // fresh client + order from scratch (buyurtmani 0 dan qabul qilish)
    const pcl = (await req('POST', '/clients', { name: 'E2E Pallet Caps', agentId: jamol.id }, admin)).body;
    const orderP = (
      await req(
        'POST',
        '/orders',
        { clientId: pcl.id, date: '2026-07-11', vehicleId: vehicle.id, transportMode: 'CLIENT_OWN', items: [{ productId: product.id, palletCount: 10 }] },
        admin,
      )
    ).body;
    ok(orderP?.id, 'pallet-caps order created (10 pallets)');
    let pc = (await req('GET', `/clients/${pcl.id}`, undefined, admin)).body;
    eq(pc.palletBalance, 10, 'client holds 10 pallets');

    // cannot hand back more than the client physically holds (holds 10, try 11)
    await req('POST', '/pallets/client-return', { clientId: pcl.id, qty: 11, date: '2026-07-11' }, admin, 400);
    // return 6 → holds 4
    await req('POST', '/pallets/client-return', { clientId: pcl.id, qty: 6, date: '2026-07-11' }, admin, 201);
    pc = (await req('GET', `/clients/${pcl.id}`, undefined, admin)).body;
    eq(pc.palletBalance, 4, 'client holds 4 after returning 6');

    // cannot charge more lost than held (holds 4, try 5)
    await req('POST', '/pallets/charge-lost', { clientId: pcl.id, qty: 5, date: '2026-07-11', unitPrice: 130000 }, admin, 400);
    const pcBalBefore = num(pc.balance);
    // charge exactly the 4 unreturned → balance 0, client debited 4×130 000 (qaytarilmasa narxi qo'shiladi)
    await req('POST', '/pallets/charge-lost', { clientId: pcl.id, qty: 4, date: '2026-07-11', unitPrice: 130000 }, admin, 201);
    pc = (await req('GET', `/clients/${pcl.id}`, undefined, admin)).body;
    eq(pc.palletBalance, 0, 'client holds 0 after charging 4 lost');
    eq(num(pc.balance) - pcBalBefore, 520000, 'client debited 4×130 000 for unreturned pallets');
    // holds 0 now — any further return is blocked
    await req('POST', '/pallets/client-return', { clientId: pcl.id, qty: 1, date: '2026-07-11' }, admin, 400);

    // dealer loose in-hand pool = all client returns so far (5 + 4 + 6), no factory returns yet
    let bal = (await req('GET', '/pallets/balances', undefined, admin)).body;
    eq(bal.dealerInHand, 15, 'dealer in-hand = 5+4+6 client returns');
    const owedBefore = num(bal.factories.find((f) => f.factory.id === factory.id)?.balance);
    ok(owedBefore >= 15, 'factory owes at least the loose stock');

    // owed-side of the cap: a factory we owe NOTHING must reject a return even though the
    // loose pool is non-empty — min(owed=0, inHand=15)=0, proving the owed term is enforced.
    const factory2 = (await req('POST', '/factories', { name: 'E2E Owed-Zero Factory' }, admin)).body;
    await req('POST', '/pallets/factory-return', { factoryId: factory2.id, qty: 1, date: '2026-07-11', unitPrice: 130000 }, admin, 400);

    // cannot send the factory more than the loose in-hand pool (holds 15, try 16)

    await req('POST', '/pallets/factory-return', { factoryId: factory.id, qty: 16, date: '2026-07-11', unitPrice: 130000 }, admin, 400);
    // return all 15 loose pallets → factory credits them
    await req('POST', '/pallets/factory-return', { factoryId: factory.id, qty: 15, date: '2026-07-11', unitPrice: 130000 }, admin, 201);
    bal = (await req('GET', '/pallets/balances', undefined, admin)).body;
    eq(bal.dealerInHand, 0, 'dealer in-hand emptied after factory return');
    eq(num(bal.factories.find((f) => f.factory.id === factory.id)?.balance), owedBefore - 15, 'factory balance dropped by 15');
    // nothing left in hand — a further factory return is blocked
    await req('POST', '/pallets/factory-return', { factoryId: factory.id, qty: 1, date: '2026-07-11', unitPrice: 130000 }, admin, 400);
  }

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
