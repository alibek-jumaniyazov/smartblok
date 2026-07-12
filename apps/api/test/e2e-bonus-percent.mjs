// Regression for the PERCENT-bonus reversal completeness bug (B1).
//
// A PERCENT bonus program accrues on order completion, then cost-finalization posts
// a separate BonusTransaction ADJUSTMENT to reprice the bonus at the finalized cost.
// The cancel/un-complete path must reverse BOTH the ACCRUAL and the ADJUSTMENT — a
// prior version reversed only the ACCRUAL, leaving the ADJUSTMENT in the wallet as
// leaked, withdrawable bonus. This drives the whole flow over HTTP and asserts the
// wallet returns to exactly zero after cancel.
//
// Run (against the SAME isolated instance as e2e-core):
//   API_URL=http://localhost:4100/api node test/e2e-bonus-percent.mjs
const BASE = process.env.API_URL || 'http://localhost:4100/api';

let failures = 0;
let checks = 0;
const num = (v) => (v == null ? 0 : Number(v));
const eq = (actual, expected, label) => {
  checks++;
  if (Math.abs(num(actual) - num(expected)) > 0.01) {
    failures++;
    console.error(`  ✗ ${label}: expected ${num(expected)}, got ${num(actual)}`);
  } else {
    console.log(`  ✓ ${label} = ${num(expected)}`);
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
  if (expectStatus !== undefined && res.status !== expectStatus) {
    checks++;
    failures++;
    console.error(`  ✗ ${method} ${path} → ${res.status} (expected ${expectStatus}): ${text.slice(0, 200)}`);
  } else if (expectStatus === undefined && res.status >= 400) {
    checks++;
    failures++;
    console.error(`  ✗ ${method} ${path} FAILED ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, body: json };
}

const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));
const walletOf = async (token, factoryId) =>
  num(
    items((await req('GET', '/bonus/wallets', undefined, token)).body).find(
      (w) => (w.factory?.id ?? w.factoryId) === factoryId,
    )?.balance,
  );

async function main() {
  const admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.accessToken;
  ok(!!admin, 'admin login');

  const agent = items((await req('GET', '/agents', undefined, admin)).body)[0];
  const cashBox = items((await req('GET', '/kassa/cashboxes', undefined, admin)).body).find(
    (c) => c.type === 'CASH' && c.currency === 'UZS',
  );
  ok(!!agent && !!cashBox, 'seeded agent + cash box present');
  await req('POST', '/kassa/manual', { cashboxId: cashBox.id, direction: 'IN', amount: 50000000, note: 'b1 funding' }, admin, 201);

  // ── isolated factory/product so the wallet baseline is a clean zero ──
  const suffix = Date.now();
  const factory = (await req('POST', '/factories', { name: `B1 PERCENT ${suffix}` }, admin)).body;
  const product = (
    await req('POST', '/products', { factoryId: factory.id, name: `B1 Block ${suffix}`, size: '600x300x200', m3PerPallet: '1.728', blocksPerPallet: 48 }, admin)
  ).body;
  for (const [kind, pricePerM3] of [['FACTORY_CASH', '600000'], ['FACTORY_BANK', '625000'], ['DEALER_SALE', '750000']]) {
    await req('POST', `/products/${product.id}/prices`, { kind, pricePerM3, effectiveFrom: '2026-06-01' }, admin, 201);
  }
  const vehicle = (await req('POST', '/vehicles', { name: `B1 truck ${suffix}`, plate: `95 B ${String(suffix).slice(-4)} ZZ`, driver: 'B1', capacityPallets: 19 }, admin)).body;
  ok(!!vehicle?.id, 'vehicle created');

  console.log('— PERCENT bonus program: 2% of blocks cost —');
  await req('POST', `/factories/${factory.id}/bonus-program`, { kind: 'PERCENT', percent: 2, effectiveFrom: '2026-06-01' }, admin, 201);

  eq(await walletOf(admin, factory.id), 0, 'wallet baseline is zero');

  const client = (await req('POST', '/clients', { name: `B1 Client ${suffix}`, agentId: agent.id }, admin)).body;
  // 10 pallets × 1.728 = 17.28 m³; provisional cost at BANK 625000
  const order = (
    await req('POST', '/orders', { clientId: client.id, date: '2026-07-11', vehicleId: vehicle.id, intendedPaymentMethod: 'BANK', transportMode: 'CLIENT_OWN', items: [{ productId: product.id, palletCount: 10 }] }, admin)
  ).body;
  ok(order?.id, 'order created ' + (order?.orderNo ?? ''));
  // 17.28 × 625000 + 10 × 130000 = 10 800 000 + 1 300 000
  eq(order?.costTotal, 12100000, 'provisional cost at BANK price');

  console.log('— complete → ACCRUAL 2% × 10 800 000 blocks —');
  for (const st of ['CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED']) {
    await req('PATCH', `/orders/${order.id}/status`, { to: st }, admin);
  }
  eq(await walletOf(admin, factory.id), 216000, 'ACCRUAL = 2% × 10 800 000');

  console.log('— finalize cost at CASH 600000 → bonus ADJUSTMENT −8 640 —');
  // coverage is measured against the PROVISIONAL cost (12 100 000): allocate that so
  // the engine finalizes, then it re-derives the real cost at the CASH price.
  const fpay = (
    await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 12100000, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-11' }, admin)
  ).body;
  await req('POST', `/payments/${fpay.id}/allocations`, { allocations: [{ orderId: order.id, amount: 12100000 }] }, admin, 201);
  const o = (await req('GET', `/orders/${order.id}`, undefined, admin)).body;
  ok(o.costStatus === 'FINAL', 'costStatus FINAL after cash allocation');
  // expected bonus = 2% × (17.28 × 600000) = 2% × 10 368 000 = 207 360 (accrual 216 000 + adjustment −8 640)
  eq(await walletOf(admin, factory.id), 207360, 'wallet = accrual + ADJUSTMENT (repriced at final cost)');

  console.log('— cancel the completed order → wallet must return to ZERO —');
  await req('DELETE', `/orders/${order.id}`, { reason: 'B1 regression' }, admin);
  eq(
    await walletOf(admin, factory.id),
    0,
    'cancel reversed BOTH accrual AND adjustment (wallet zero — no leaked bonus)',
  );

  console.log(`\n${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('B1 regression crashed:', e);
  process.exit(1);
});
