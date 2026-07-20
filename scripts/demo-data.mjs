// SmartBlok demo/market dataset — created THROUGH the HTTP API so every posting
// goes through the real business logic and the ledger stays balanced (never raw
// prisma inserts, which would break the CHECK constraints and make the app look
// broken). Run against a freshly reset + seeded instance:
//
//   1) cd apps/api && npx prisma migrate reset --force   (wipes + reseeds prereqs)
//   2) start the API (npm start / node dist/main.js) on API_PORT
//   3) node scripts/demo-data.mjs
//
// Idempotency: intended for a fresh DB. Re-running appends more demo rows.
const BASE = process.env.API_URL || 'http://localhost:4000/api';
const log = (...a) => console.log('  ', ...a);

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (res.status >= 400) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}
const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));
const pick = (arr, name) => arr.find((x) => x.name === name) || arr[0];

async function main() {
  const admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' })).accessToken;
  if (!admin) throw new Error('admin login failed — did the seed run?');

  // ── catalog discovery ──
  const products = items(await req('GET', '/products', undefined, admin));
  const p200 = products.find((p) => p.size === '600x300x200') || products[0];
  const p100 = products.find((p) => p.size === '600x300x100') || products[0];
  const agents = items(await req('GET', '/agents', undefined, admin));
  const factory = items(await req('GET', '/factories', undefined, admin))[0];
  const cashboxes = items(await req('GET', '/kassa/cashboxes', undefined, admin));
  const cash = cashboxes.find((c) => c.type === 'CASH' && c.currency === 'UZS');
  const bank = cashboxes.find((c) => c.type === 'BANK');
  const agent = (n) => (agents.find((a) => a.name === n) || agents[0]).id;

  // ── opening balances so the kassa shows money ──
  await req('POST', '/kassa/manual', { cashboxId: bank.id, direction: 'IN', amount: 200000000, note: "Boshlang'ich bank qoldig'i" }, admin);
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'IN', amount: 80000000, note: "Boshlang'ich naqd qoldiq" }, admin);
  log('opening balances funded');

  // ── factory bonus program (PER_M3) so the bonus wallet comes alive ──
  await req('POST', `/factories/${factory.id}/bonus-program`, { kind: 'PER_M3', ratePerM3: 5000, effectiveFrom: '2026-06-01' }, admin);
  log('bonus program set: 5 000/m³');

  // ── vehicles ──
  const truck1 = await req('POST', '/vehicles', { name: 'Isuzu Forward', plate: '95 A 123 BC', driver: 'Bekzod', capacityPallets: 19 }, admin);
  const truck2 = await req('POST', '/vehicles', { name: 'Howo', plate: '95 B 456 CD', driver: 'Sanjar', capacityPallets: 19 }, admin);
  log('vehicles created');

  // ── clients across agents & credit profiles ──
  const c1 = await req('POST', '/clients', { name: 'Demo Qurilish MChJ', agentId: agent('Жамол'), phone: '+998901112233', creditLimit: 60000000, paymentTermDays: 14 }, admin);
  const c2 = await req('POST', '/clients', { name: 'Nur Baraka Savdo', agentId: agent('Арслон ога'), phone: '+998901112244', creditLimit: 40000000, paymentTermDays: 10 }, admin);
  const c3 = await req('POST', '/clients', { name: 'Xorazm Prodmash', agentId: agent('Зафар ога'), phone: '+998901112255' }, admin);
  const c4 = await req('POST', '/clients', { name: 'Yangi Uy Stroy', agentId: agent('Темур'), phone: '+998901112266' }, admin);
  const c5 = await req('POST', '/clients', { name: 'Baraka Blok', agentId: agent('Шохрух ога'), phone: '+998901112277', creditLimit: 25000000 }, admin);
  log('5 clients created');

  const D = '2026-07-13';
  const setStatus = async (id, to) => req('PATCH', `/orders/${id}/status`, { to }, admin);

  // ── ORD (completed): full sale, cash factory payment FINALIZES cost, bonus accrues ──
  const o1 = await req('POST', '/orders', {
    clientId: c1.id, date: D, vehicleId: truck1.id, intendedPaymentMethod: 'CASH',
    transportMode: 'CLIENT_PAYS_DRIVER', transportCost: 1500000,
    items: [{ productId: p200.id, palletCount: 19 }],
  }, admin);
  // client pays the sale in cash (client debt is recognized at order creation)
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: c1.id, amount: 26094000, method: 'CASH', cashboxId: cash.id, date: D }, admin);
  // reach LOADING first — the dealer→factory cost is posted only when the truck leaves the
  // factory (LOADING+), so a factory payment can only be allocated to the order from there.
  for (const st of ['CONFIRMED', 'LOADING']) await setStatus(o1.id, st);
  // factory paid in cash → allocation finalizes cost at the cheaper CASH price (visible COST_ADJUSTMENT)
  const fp1 = await req('POST', '/payments', { kind: 'FACTORY_OUT', factoryId: factory.id, amount: 22990000, method: 'CASH', cashboxId: cash.id, date: D }, admin);
  await req('POST', `/payments/${fp1.id}/allocations`, { allocations: [{ orderId: o1.id, amount: 22990000 }] }, admin);
  for (const st of ['DELIVERING', 'DELIVERED', 'COMPLETED']) await setStatus(o1.id, st);
  // client returns most pallets, keeps a few outstanding
  await req('POST', '/pallets/client-return', { clientId: c1.id, qty: 14, date: D }, admin);
  log(`${o1.orderNo} COMPLETED (cost finalized + bonus + pallets)`);

  // ── ORD (delivering): partial payment → outstanding debt shows in aging ──
  const o2 = await req('POST', '/orders', {
    clientId: c2.id, date: D, vehicleId: truck2.id, intendedPaymentMethod: 'BANK',
    transportMode: 'DEALER_ABSORBED', transportCost: 1200000,
    items: [{ productId: p200.id, palletCount: 12 }],
  }, admin);
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: c2.id, amount: 8000000, method: 'BANK', cashboxId: bank.id, date: D }, admin);
  for (const st of ['CONFIRMED', 'LOADING', 'DELIVERING']) await setStatus(o2.id, st);
  log(`${o2.orderNo} DELIVERING (partial payment)`);

  // ── ORD (confirmed, unpaid): pure receivable ──
  const o3 = await req('POST', '/orders', {
    clientId: c3.id, date: D, vehicleId: truck1.id, intendedPaymentMethod: 'BANK',
    transportMode: 'CLIENT_PAYS_DRIVER', transportCost: 1500000,
    items: [{ productId: p100.id, palletCount: 8 }],
  }, admin);
  await setStatus(o3.id, 'CONFIRMED');
  log(`${o3.orderNo} CONFIRMED (unpaid)`);

  // ── ORD (delivered, client's own transport): no transport cost/charge.
  // A vehicle is still attached because the status flow requires one from LOADING on. ──
  const o4 = await req('POST', '/orders', {
    clientId: c4.id, date: D, vehicleId: truck2.id, transportMode: 'CLIENT_OWN',
    items: [{ productId: p200.id, palletCount: 15 }],
  }, admin);
  await req('POST', '/payments', { kind: 'CLIENT_IN', clientId: c4.id, amount: 20000000, method: 'CLICK', cashboxId: cashboxes.find((c) => c.type === 'CLICK')?.id ?? cash.id, date: D }, admin);
  for (const st of ['CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED']) await setStatus(o4.id, st);
  log(`${o4.orderNo} DELIVERED (CLIENT_OWN)`);

  // ── ORD (cancelled): soft-cancel proves reversals restore balances ──
  const o5 = await req('POST', '/orders', {
    clientId: c5.id, date: D, vehicleId: truck2.id, intendedPaymentMethod: 'BANK',
    transportMode: 'DEALER_ABSORBED', transportCost: 1000000,
    items: [{ productId: p100.id, palletCount: 6 }],
  }, admin);
  await req('DELETE', `/orders/${o5.id}`, { reason: 'Mijoz bekor qildi (demo)' }, admin);
  log(`${o5.orderNo} CANCELLED (soft-cancel)`);

  // ── ORD (new): fresh order in the pipeline ──
  const o6 = await req('POST', '/orders', {
    clientId: c5.id, date: D, vehicleId: truck1.id, intendedPaymentMethod: 'CASH',
    transportMode: 'CLIENT_PAYS_DRIVER', transportCost: 1500000,
    items: [{ productId: p200.id, palletCount: 10 }],
  }, admin);
  log(`${o6.orderNo} NEW`);

  // ── a driver settlement (VEHICLE_OUT) + an office expense via kassa OUT ──
  await req('POST', '/payments', { kind: 'VEHICLE_OUT', vehicleId: truck2.id, amount: 1200000, method: 'CASH', cashboxId: cash.id, date: D, allocations: [{ orderId: o2.id, amount: 1200000 }] }, admin);
  await req('POST', '/kassa/manual', { cashboxId: cash.id, direction: 'OUT', amount: 2500000, note: 'Ofis xarajati (demo)' }, admin);
  log('driver settlement + office expense recorded');

  // ── withdraw part of the bonus wallet in cash (shows a bonus spend) ──
  try {
    await req('POST', '/bonus/withdraw', { factoryId: factory.id, amount: 50000, cashboxId: cash.id }, admin);
    log('bonus partial withdrawal recorded');
  } catch (e) { log('bonus withdraw skipped:', e.message); }

  // ── summary ──
  const dash = await req('GET', '/dashboard/summary', undefined, admin);
  console.log('\n✓ Demo data created. Dashboard snapshot:');
  console.log('   orders (period):', dash?.period?.orders, '· clients owe us:', dash?.clientsOweUs, '· in-flight:', dash?.ordersInFlight);
}

main().catch((e) => { console.error('\n✗ demo-data failed:', e.message); process.exit(1); });
