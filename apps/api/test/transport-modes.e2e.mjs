// Transport-mode regression suite — the owner's rule, locked down (2026-07-21).
//
// THE RULE: an order's transport cost is ALWAYS INSIDE the goods total, never billed on
// top. Under CLIENT_PAYS_DRIVER the client hands that slice straight to the driver, so
// from the MOMENT THE ORDER IS CREATED he owes the dealer saleTotal − transportCost and
// the dealer owes the driver NOTHING. No payment entry is needed to make that true.
//
// The owner's actual complaint was cross-screen divergence: the client card said one
// number, the order card another. Every assertion below therefore pins BOTH surfaces and
// then asserts they are EQUAL to each other — a suite that only checked one of them would
// have stayed green through the bug.
//
// Owner's own numbers: savdo summasi 22 000 000, ichida transport 2 000 000 → qarz 20 000 000.
//
// Run (isolated DB, never against dev data):
//   cd apps/api
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx prisma migrate deploy
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test npx tsx prisma/seed.ts
//   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
//   node test/transport-modes.e2e.mjs
const BASE = process.env.API_URL || 'http://localhost:4100/api';

let failures = 0;
let checks = 0;
const num = (v) => (v == null ? 0 : Number(v));
const M = (n) => Number(n).toLocaleString('ru-RU').replace(/ /g, ' ');

const eq = (actual, expected, label) => {
  checks++;
  const a = num(actual);
  const e = num(expected);
  if (Math.abs(a - e) > 0.01) {
    failures++;
    console.error(`  ✗ ${label}: expected ${M(e)}, got ${M(a)}`);
  } else {
    console.log(`  ✓ ${label} = ${M(e)}`);
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
      console.error(`  ✗ ${method} ${path} → ${res.status} (expected ${expectStatus}): ${text.slice(0, 220)}`);
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

const SALE = 22000000;
const TRANSPORT = 2000000;
const NET = SALE - TRANSPORT; // 20 000 000 — what the client owes the DEALER

// run-unique so the suite survives a re-run against a non-fresh DB (plates are unique
// on the normalized key, and a 409 there would cascade into every later assertion)
const R = Date.now().toString().slice(-6);

async function main() {
  const admin = (await req('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.accessToken;
  ok(!!admin, 'admin login');

  const products = items((await req('GET', '/products?pageSize=200', undefined, admin)).body);
  const product = products.find((p) => p.size === '600x300x200') || products[0];
  const cashboxes = items((await req('GET', '/kassa/cashboxes', undefined, admin)).body);
  const cashBox = cashboxes.find((c) => c.type === 'CASH' && c.currency === 'UZS');
  ok(!!product && !!cashBox, 'seeded catalog present');

  const truck = (
    await req(
      'POST',
      '/vehicles',
      { name: `TM truck ${R}`, plate: `88 T ${R.slice(0, 3)} MD`, driver: 'TM Driver', capacityPallets: 19 },
      admin,
      201,
    )
  ).body;

  // VEHICLE_OUT pays real cash out of the kassa — fund it first
  await req('POST', '/kassa/manual', { cashboxId: cashBox.id, direction: 'IN', amount: 10000000, note: `TM funding ${R}` }, admin, 201);

  // clients are agent-less on purpose: the agent debt-limit gate is a different rule and
  // must not be able to colour these results
  const mkClient = async (label) =>
    (await req('POST', '/clients', { name: `TM ${label} ${R}` }, admin, 201)).body;

  const balanceOf = async (id) => num((await req('GET', `/clients/${id}`, undefined, admin)).body.balance);
  const orderOf = async (id) => (await req('GET', `/orders/${id}`, undefined, admin)).body;
  const owedToVehicles = async () => num((await req('GET', '/debts/summary', undefined, admin)).body.weOweVehicles);
  const advance = async (id, upTo) => {
    for (const st of upTo) await req('PATCH', `/orders/${id}/status`, { to: st }, admin);
  };
  const mkOrder = (clientId, mode, sale, transport, extra) =>
    req(
      'POST',
      '/orders',
      {
        clientId,
        date: '2026-07-21',
        vehicleId: truck.id,
        transportMode: mode,
        transportCost: transport,
        items: [{ productId: product.id, palletCount: 10, saleLumpSum: sale }],
        ...extra,
      },
      admin,
    );

  // ═══════════════════════════════════════════════════════════════════
  // 1. CLIENT_PAYS_DRIVER — the carve-out happens AT CREATE, with no payment
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n— 1. «Shofyorga mijoz to'laydi»: qarz buyurtma yaratilgandayoq sof —");
  const cA = await mkClient('A');
  const vehBase = await owedToVehicles();
  const oA = (await mkOrder(cA.id, 'CLIENT_PAYS_DRIVER', SALE, TRANSPORT)).body;
  ok(!!oA?.id, `order created ${oA?.orderNo ?? ''}`);

  // the ORDER still reads gross — the owner wants «Savdo summasi 22 000 000» on the card,
  // with the driver's slice shown underneath as a split, not silently subtracted away
  eq(oA.saleTotal, SALE, 'order saleTotal stays GROSS on the order card');
  eq(oA.transportCost, TRANSPORT, 'order transportCost recorded');

  const balA0 = await balanceOf(cA.id);
  const outA0 = num((await orderOf(oA.id)).clientOutstanding);
  eq(balA0, NET, 'client ledger balance right after create (NO payment entered)');
  eq(outA0, NET, 'order clientOutstanding right after create');
  // THE regression: these two surfaces disagreed (22 000 000 vs 20 000 000) and that is
  // exactly what the owner reported. Assert the agreement itself, not just the values.
  ok(balA0 === outA0, `mijoz kartasi va buyurtma kartasi BIR XIL summa (${M(balA0)})`);

  console.log('\n— 2. LOADING: dillerning shofyorga qarzi TUG\'ILMAYDI —');
  await advance(oA.id, ['CONFIRMED', 'LOADING']);
  eq((await owedToVehicles()) - vehBase, 0, 'weOweVehicles contribution after LOADING');
  eq(await balanceOf(cA.id), NET, 'client balance unmoved by the LOADING transition');

  console.log("\n— 3. TRANSPORT_DIRECT = FAKT QAYDI, ikkinchi marta yechilmaydi —");
  await req(
    'POST',
    '/payments',
    {
      kind: 'TRANSPORT_DIRECT',
      clientId: cA.id,
      vehicleId: truck.id,
      amount: TRANSPORT,
      method: 'CASH',
      date: '2026-07-21',
      allocations: [{ orderId: oA.id, amount: TRANSPORT }],
    },
    admin,
    201,
  );
  const balA1 = await balanceOf(cA.id);
  const outA1 = num((await orderOf(oA.id)).clientOutstanding);
  eq(balA1, NET, 'client balance UNCHANGED (no second credit down to 18 000 000)');
  eq(outA1, NET, 'order clientOutstanding UNCHANGED');
  ok(balA1 === outA1, 'ikkala ekran hamon bir xil');
  eq((await owedToVehicles()) - vehBase, 0, 'still no dealer→driver liability (no phantom advance)');
  ok((await orderOf(oA.id)).transportPaidStatus === 'PAID_BY_CLIENT', 'transportPaidStatus → PAID_BY_CLIENT');

  console.log('\n— 4. 20 000 000 CLIENT_IN buyurtmani TO\'LIQ yopadi —');
  await req(
    'POST',
    '/payments',
    { kind: 'CLIENT_IN', clientId: cA.id, amount: NET, method: 'CASH', cashboxId: cashBox.id, date: '2026-07-21' },
    admin,
    201,
  );
  const outA2 = num((await orderOf(oA.id)).clientOutstanding);
  eq(await balanceOf(cA.id), 0, 'client balance settles to exactly 0 (no advance, no residue)');
  eq(outA2, 0, 'order clientOutstanding 0');
  eq(((NET - outA2) / NET) * 100, 100, 'order settled percent');

  // ═══════════════════════════════════════════════════════════════════
  // 5. CANCEL — the old model left a phantom credit AND a phantom driver advance
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 5. bekor qilish: fantom kredit ham, fantom avans ham qolmaydi —');
  const cB = await mkClient('B');
  const oB = (await mkOrder(cB.id, 'CLIENT_PAYS_DRIVER', SALE, TRANSPORT)).body;
  await advance(oB.id, ['CONFIRMED', 'LOADING']);
  eq(await balanceOf(cB.id), NET, 'B owes the net sum before cancel');
  // record the driver cash too — this is the combination that used to leave junk behind
  await req(
    'POST',
    '/payments',
    {
      kind: 'TRANSPORT_DIRECT',
      clientId: cB.id,
      vehicleId: truck.id,
      amount: TRANSPORT,
      method: 'CASH',
      date: '2026-07-21',
      allocations: [{ orderId: oB.id, amount: TRANSPORT }],
    },
    admin,
    201,
  );
  const vehBeforeCancel = await owedToVehicles();
  await req('DELETE', `/orders/${oB.id}`, { reason: 'TM cancel' }, admin);
  eq(await balanceOf(cB.id), 0, 'cancel returns the client balance to exactly 0');
  eq((await owedToVehicles()) - vehBeforeCancel, 0, 'cancel invents no driver advance');
  eq(num((await orderOf(oB.id)).clientOutstanding), 0, 'cancelled order owes nothing');

  // ═══════════════════════════════════════════════════════════════════
  // 6. CONTROL — DEALER_ABSORBED is untouched by all of the above
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 6. NAZORAT: «Diller to\'laydi» rejimi o\'zgarmadi —');
  const cC = await mkClient('C');
  const vehBaseC = await owedToVehicles();
  const oC = (await mkOrder(cC.id, 'DEALER_ABSORBED', SALE, TRANSPORT)).body;
  const balC0 = await balanceOf(cC.id);
  const outC0 = num((await orderOf(oC.id)).clientOutstanding);
  eq(balC0, SALE, 'client owes the FULL 22 000 000 (nothing is carved out)');
  eq(outC0, SALE, 'order clientOutstanding = full 22 000 000');
  ok(balC0 === outC0, 'nazorat holatida ham ikkala ekran bir xil');

  await advance(oC.id, ['CONFIRMED', 'LOADING']);
  eq((await owedToVehicles()) - vehBaseC, TRANSPORT, 'dealer owes the driver 2 000 000 at LOADING');
  await req(
    'POST',
    '/payments',
    {
      kind: 'VEHICLE_OUT',
      vehicleId: truck.id,
      amount: TRANSPORT,
      method: 'CASH',
      cashboxId: cashBox.id,
      date: '2026-07-21',
      allocations: [{ orderId: oC.id, amount: TRANSPORT }],
    },
    admin,
    201,
  );
  eq((await owedToVehicles()) - vehBaseC, 0, 'VEHICLE_OUT clears the driver');
  ok((await orderOf(oC.id)).transportPaidStatus === 'PAID', 'transportPaidStatus → PAID');
  eq(await balanceOf(cC.id), SALE, 'paying the driver never touches the client receivable');

  // ═══════════════════════════════════════════════════════════════════
  // 7. TRANSPORT_DIRECT is only meaningful in CLIENT_PAYS_DRIVER
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 7. TRANSPORT_DIRECT boshqa rejimda RAD etiladi —');
  await req(
    'POST',
    '/payments',
    {
      kind: 'TRANSPORT_DIRECT',
      clientId: cC.id,
      vehicleId: truck.id,
      amount: TRANSPORT,
      method: 'CASH',
      date: '2026-07-21',
      allocations: [{ orderId: oC.id, amount: TRANSPORT }],
    },
    admin,
    400,
  );
  eq(await balanceOf(cC.id), SALE, 'the rejected payment left no trace on the client');
  // …and it may not float free of an order either — without an allocation there is no
  // order whose mode we could have verified
  await req(
    'POST',
    '/payments',
    {
      kind: 'TRANSPORT_DIRECT',
      clientId: cC.id,
      vehicleId: truck.id,
      amount: TRANSPORT,
      method: 'CASH',
      date: '2026-07-21',
    },
    admin,
    400,
  );

  // ═══════════════════════════════════════════════════════════════════
  // 8. GUARD — a mis-keyed transport bigger than the sale must not invert the debt
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 8. transport > savdo summasi: qarz MANFIY bo\'lmaydi —');
  const cD = await mkClient('D');
  const oD = (await mkOrder(cD.id, 'CLIENT_PAYS_DRIVER', 2000000, 3000000)).body;
  const balD = await balanceOf(cD.id);
  const outD = num((await orderOf(oD.id)).clientOutstanding);
  eq(balD, 0, 'client balance clamped at 0, never negative');
  eq(outD, 0, 'order clientOutstanding clamped at 0');
  ok(balD >= 0 && outD >= 0, 'no surface reports a negative debt');
  ok(balD === outD, 'clamp is applied identically on both surfaces');

  // ═══════════════════════════════════════════════════════════════════
  // THE CARVE-OUT MUST TRACK saleTotal FOR LIFE, not only at create.
  //
  // The carve-out ledger row is written ONCE, at order create, from the saleTotal known
  // at that moment — but saleTotal legitimately moves afterwards (late pricing, admin
  // reprice, actual loading). The invariant that has to hold at EVERY instant is:
  //
  //   Σ TRANSPORT_CLIENT_DIRECT rows of an order
  //     == −clientDirectTransport({mode, transportCost, saleTotal: CURRENT saleTotal})
  //
  // When it stops holding, the client card and the order card diverge again — which is
  // the owner's original complaint, reborn. Sections 9-15 pin it down.
  // ═══════════════════════════════════════════════════════════════════

  // more kassa runway for the VEHICLE_OUT sections below (each pays real cash out)
  await req('POST', '/kassa/manual', { cashboxId: cashBox.id, direction: 'IN', amount: 20000000, note: `TM funding 2 ${R}` }, admin, 201);

  let truckSeq = 0;
  const mkTruck = async (label) => {
    truckSeq++;
    return (
      await req(
        'POST',
        '/vehicles',
        {
          name: `TM ${label} ${R}`,
          plate: `7${truckSeq} T ${R.slice(0, 3)} MD`,
          driver: 'TM Driver',
          capacityPallets: 19,
        },
        admin,
        201,
      )
    ).body;
  };
  const vehBalanceOf = async (id) => num((await req('GET', `/vehicles/${id}`, undefined, admin)).body.balance);

  // Net carve-out actually standing on the CLIENT ledger. Reversals are opposite-sign
  // rows (never deletes), so summing EVERY TRANSPORT_CLIENT_DIRECT row of the party is
  // exactly the live figure — and it catches a delta helper that posts twice.
  const carveOf = async (clientId) => {
    const st = (await req('GET', `/debts/statement?account=CLIENT&partyId=${clientId}`, undefined, admin)).body;
    const entries = Array.isArray(st?.entries) ? st.entries : null;
    // a missing/renamed payload must FAIL, not silently sum to zero
    ok(entries !== null, 'CLIENT statement returned an entries array');
    const rows = (entries ?? []).filter((e) => e.source === 'TRANSPORT_CLIENT_DIRECT');
    return { rows, sum: rows.reduce((a, e) => a + num(e.amount), 0) };
  };

  /** the whole point of the suite: client card == order card, and both == expected */
  const assertBothCards = async (clientId, orderId, expected, label) => {
    const bal = await balanceOf(clientId);
    const out = num((await orderOf(orderId)).clientOutstanding);
    eq(bal, expected, `${label}: mijoz kartasi`);
    eq(out, expected, `${label}: buyurtma kartasi`);
    ok(bal === out, `${label}: ikkala ekran BIR XIL (${M(bal)})`);
    return bal;
  };

  // ═══════════════════════════════════════════════════════════════════
  // 9. KECHIKTIRILGAN NARXLASH — the owner's original bug, reborn
  //    pricePending ⇒ saleTotal 0 at create ⇒ NO carve-out row is written. Pricing the
  //    item later posted the full 22 000 000 sale and nothing else, so the client card
  //    read 22 000 000 while the order card read 20 000 000.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 9. Kechiktirilgan narxlash: carve-out KEYIN ham paydo bo\'ladi —');
  const cE = await mkClient('E');
  const tE = await mkTruck('truckE');
  const oE = (
    await mkOrder(cE.id, 'CLIENT_PAYS_DRIVER', 0, TRANSPORT, {
      vehicleId: tE.id,
      items: [{ productId: product.id, palletCount: 10, pricePending: true }],
    })
  ).body;
  ok(!!oE?.id, `pricePending order created ${oE?.orderNo ?? ''}`);
  const itemE = oE.items?.[0];
  ok(!!itemE?.id, 'pricePending pozitsiya id qaytdi');
  eq(oE.saleTotal, 0, 'saleTotal is 0 while the item is pricePending');
  await assertBothCards(cE.id, oE.id, 0, 'narxlanmagan buyurtma');

  await req('PATCH', `/orders/${oE.id}/items/${itemE.id}/price`, { saleLumpSum: SALE }, admin, 200);
  const oE1 = await orderOf(oE.id);
  eq(oE1.saleTotal, SALE, 'order saleTotal is GROSS 22 000 000 after late pricing');
  // 20 000 000 — NOT 22 000 000. This exact number is what the owner reported.
  await assertBothCards(cE.id, oE.id, NET, 'kechiktirilgan narxlashdan keyin');
  const carveE = await carveOf(cE.id);
  ok(carveE.rows.length > 0, 'kechiktirilgan narxlash carve-out qatorini yozdi');
  eq(carveE.sum, -TRANSPORT, 'net TRANSPORT_CLIENT_DIRECT tracks the NEW saleTotal');
  eq(await vehBalanceOf(tE.id), 0, 'late pricing invents no dealer→driver liability');

  // ═══════════════════════════════════════════════════════════════════
  // 10. ADMIN NARXNI PASAYTIRDI, transportdan ham past — fantom avans bo'lmasin
  //     22 000 000 → 1 000 000 with transport 2 000 000: the stale −2 000 000 carve-out
  //     against a 1 000 000 sale left the client at −1 000 000 (a credit he never paid).
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 10. Admin narxni transportdan PASTGA tuzatdi: manfiy balans yo\'q —');
  const cF = await mkClient('F');
  const tF = await mkTruck('truckF');
  const oF = (await mkOrder(cF.id, 'CLIENT_PAYS_DRIVER', SALE, TRANSPORT, { vehicleId: tF.id })).body;
  const itemF = oF.items?.[0];
  ok(!!itemF?.id, 'buyurtma pozitsiyasi id qaytdi');
  await assertBothCards(cF.id, oF.id, NET, 'tuzatishdan oldin');

  await req('PATCH', `/orders/${oF.id}/items/${itemF.id}/admin-price`, { saleLumpSum: 1000000 }, admin, 200);
  const oF1 = await orderOf(oF.id);
  eq(oF1.saleTotal, 1000000, 'admin reprice moved saleTotal down to 1 000 000');
  const balF = await assertBothCards(cF.id, oF.id, 0, 'pasaytirilgan narxdan keyin');
  ok(balF >= 0, 'mijoz balansi MANFIY emas (fantom avans yo\'q)');
  const carveF = await carveOf(cF.id);
  eq(carveF.sum, -1000000, 'carve-out re-clamped to the new (smaller) saleTotal');
  eq(await vehBalanceOf(tF.id), 0, 'reprice invents no dealer→driver liability');

  // ═══════════════════════════════════════════════════════════════════
  // 11. NARX PASTDAN KO'TARILDI — the cap must be RE-LIFTED, not frozen
  //     Created below transportCost the carve-out is capped at saleTotal (1 000 000).
  //     Repricing up to 22 000 000 must lift it back to the full 2 000 000, else the
  //     receivable stays overstated by 1 000 000 forever.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 11. Narx pastdan ko\'tarildi: cheklov QAYTA hisoblanadi —');
  const cG = await mkClient('G');
  const tG = await mkTruck('truckG');
  const oG = (await mkOrder(cG.id, 'CLIENT_PAYS_DRIVER', 1000000, TRANSPORT, { vehicleId: tG.id })).body;
  const itemG = oG.items?.[0];
  ok(!!itemG?.id, 'past narxli buyurtma pozitsiyasi id qaytdi');
  await assertBothCards(cG.id, oG.id, 0, 'past narxda (cheklangan)');
  eq((await carveOf(cG.id)).sum, -1000000, 'carve-out capped at the small saleTotal');

  await req('PATCH', `/orders/${oG.id}/items/${itemG.id}/admin-price`, { saleLumpSum: SALE }, admin, 200);
  eq((await orderOf(oG.id)).saleTotal, SALE, 'saleTotal lifted to 22 000 000');
  await assertBothCards(cG.id, oG.id, NET, 'ko\'tarilgan narxdan keyin');
  eq((await carveOf(cG.id)).sum, -TRANSPORT, 'carve-out lifted back to the FULL 2 000 000');
  eq(await vehBalanceOf(tG.id), 0, 'still nothing owed to the driver');

  // ═══════════════════════════════════════════════════════════════════
  // 12. HAQIQIY YUK KAM CHIQDI — actual loading below transportCost
  //     Per-m³ pricing rescales saleTotal at actual loading; the carve-out did not
  //     follow it down, so a short delivery drove the client negative.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 12. Haqiqiy yuk transport puldan kam: fantom avans yo\'q —');
  const BIG_M3 = 38.4;
  const PRICE_M3 = 855000; // 38.4 × 855 000 = 32 832 000
  const BIG_SALE = 32832000;
  const SHORT_M3 = 1; // 855 000 — below the 2 000 000 transport slice
  const SHORT_SALE = 855000;
  const cH = await mkClient('H');
  const tH = await mkTruck('truckH');
  const oH = (
    await mkOrder(cH.id, 'CLIENT_PAYS_DRIVER', 0, TRANSPORT, {
      vehicleId: tH.id,
      items: [{ productId: product.id, palletCount: 10, quantityM3: BIG_M3, salePricePerM3: PRICE_M3 }],
    })
  ).body;
  const itemH = oH.items?.[0];
  ok(!!itemH?.id, 'per-m³ buyurtma pozitsiyasi id qaytdi');
  eq(oH.saleTotal, BIG_SALE, 'per-m³ order starts at 32 832 000');
  await assertBothCards(cH.id, oH.id, BIG_SALE - TRANSPORT, 'yuklashdan oldin');

  await advance(oH.id, ['CONFIRMED', 'LOADING']);
  eq(await vehBalanceOf(tH.id), 0, 'LOADING creates no driver liability in CLIENT_PAYS_DRIVER');
  await req(
    'POST',
    `/orders/${oH.id}/actual-loading`,
    { items: [{ itemId: itemH.id, actualQuantityM3: SHORT_M3 }] },
    admin,
    201,
  );
  const oH1 = await orderOf(oH.id);
  eq(oH1.saleTotal, SHORT_SALE, 'actual loading rescaled saleTotal down to 855 000');
  const balH = await assertBothCards(cH.id, oH.id, 0, 'kam yuklashdan keyin');
  ok(balH >= 0, 'kam yuklash mijozni MANFIYga tushirmaydi');
  eq((await carveOf(cH.id)).sum, -SHORT_SALE, 'carve-out followed the actual sale down');
  eq(await vehBalanceOf(tH.id), 0, 'still no phantom driver advance after actual loading');

  // ═══════════════════════════════════════════════════════════════════
  // 13. VEHICLE_OUT is MEANINGLESS in CLIENT_PAYS_DRIVER — the mirror of section 7
  //     The dealer owes this driver nothing, so paying him out of the kassa would both
  //     invent an advance and mark the order's transport as dealer-PAID.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 13. VEHICLE_OUT «Shofyorga mijoz to\'laydi» rejimida RAD etiladi —');
  const cI = await mkClient('I');
  const tI = await mkTruck('truckI');
  const oI = (await mkOrder(cI.id, 'CLIENT_PAYS_DRIVER', SALE, TRANSPORT, { vehicleId: tI.id })).body;
  await advance(oI.id, ['CONFIRMED', 'LOADING']);
  await req(
    'POST',
    '/payments',
    {
      kind: 'VEHICLE_OUT',
      vehicleId: tI.id,
      amount: TRANSPORT,
      method: 'CASH',
      cashboxId: cashBox.id,
      date: '2026-07-21',
      allocations: [{ orderId: oI.id, amount: TRANSPORT }],
    },
    admin,
    400,
  );
  eq(await vehBalanceOf(tI.id), 0, 'rad etilgan VEHICLE_OUT moshina balansiga tegmadi');
  await assertBothCards(cI.id, oI.id, NET, 'rad etilgan VEHICLE_OUT dan keyin');
  ok(
    (await orderOf(oI.id)).transportPaidStatus !== 'PAID',
    "rad etilgan to'lov transportni «to'langan» qilib qo'ymadi",
  );

  // ═══════════════════════════════════════════════════════════════════
  // 14. REJIMNI ALMASHTIRISH — a live transport payment blocks the switch
  //     An edit reverses and reposts the whole order ledger. Flipping the mode while a
  //     TRANSPORT_DIRECT (or a VEHICLE_OUT) still stands leaves that payment attached to
  //     an order whose mode contradicts it — the exact state section 7/13 forbid creating.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 14. Tirik transport to\'lovi bilan rejim almashtirilmaydi —');
  const cJ = await mkClient('J');
  const tJ = await mkTruck('truckJ');
  const oJ = (await mkOrder(cJ.id, 'CLIENT_PAYS_DRIVER', SALE, TRANSPORT, { vehicleId: tJ.id })).body;
  await assertBothCards(cJ.id, oJ.id, NET, 'CPD buyurtma yaratildi');
  const payJ = (
    await req(
      'POST',
      '/payments',
      {
        kind: 'TRANSPORT_DIRECT',
        clientId: cJ.id,
        vehicleId: tJ.id,
        amount: TRANSPORT,
        method: 'CASH',
        date: '2026-07-21',
        allocations: [{ orderId: oJ.id, amount: TRANSPORT }],
      },
      admin,
      201,
    )
  ).body;
  ok(!!payJ?.id, 'TRANSPORT_DIRECT to\'lovi id qaytardi');

  const sameItems = [{ productId: product.id, palletCount: 10, saleLumpSum: SALE }];
  await req(
    'PUT',
    `/orders/${oJ.id}`,
    { transportMode: 'DEALER_ABSORBED', transportCost: TRANSPORT, items: sameItems },
    admin,
    400,
  );
  ok((await orderOf(oJ.id)).transportMode === 'CLIENT_PAYS_DRIVER', 'rad etilgan tahrir rejimni saqlab qoldi');
  await assertBothCards(cJ.id, oJ.id, NET, 'rad etilgan rejim almashtirishdan keyin');

  await req('POST', `/payments/${payJ.id}/void`, { reason: 'TM mode switch' }, admin, 201);
  await req(
    'PUT',
    `/orders/${oJ.id}`,
    { transportMode: 'DEALER_ABSORBED', transportCost: TRANSPORT, items: sameItems },
    admin,
    200,
  );
  const oJ1 = await orderOf(oJ.id);
  ok(oJ1.transportMode === 'DEALER_ABSORBED', "to'lov bekor qilingach rejim almashdi");
  eq(oJ1.saleTotal, SALE, 'saleTotal survived the edit');
  await assertBothCards(cJ.id, oJ.id, SALE, 'DEALER_ABSORBED ga o\'tgach mijoz TO\'LIQ qarzdor');
  eq((await carveOf(cJ.id)).sum, 0, 'carve-out fully reversed out of the client ledger');
  eq(await vehBalanceOf(tJ.id), 0, "NEW holatda hali shofyorga qarz yo'q");

  // …and the same guard in the other direction: a standing VEHICLE_OUT blocks the
  // switch INTO CLIENT_PAYS_DRIVER (the dealer already paid a driver the client is now
  // supposed to be paying himself).
  console.log('\n— 14b. Tirik VEHICLE_OUT bilan CPD ga o\'tilmaydi —');
  const cK = await mkClient('K');
  const tK = await mkTruck('truckK');
  const oK = (await mkOrder(cK.id, 'DEALER_ABSORBED', SALE, TRANSPORT, { vehicleId: tK.id })).body;
  await assertBothCards(cK.id, oK.id, SALE, 'DEALER_ABSORBED buyurtma yaratildi');
  const payK = (
    await req(
      'POST',
      '/payments',
      {
        kind: 'VEHICLE_OUT',
        vehicleId: tK.id,
        amount: TRANSPORT,
        method: 'CASH',
        cashboxId: cashBox.id,
        date: '2026-07-21',
        allocations: [{ orderId: oK.id, amount: TRANSPORT }],
      },
      admin,
      201,
    )
  ).body;
  ok(!!payK?.id, 'VEHICLE_OUT to\'lovi id qaytardi');
  eq(await vehBalanceOf(tK.id), TRANSPORT, 'dealer prepaid the driver 2 000 000');

  await req(
    'PUT',
    `/orders/${oK.id}`,
    { transportMode: 'CLIENT_PAYS_DRIVER', transportCost: TRANSPORT, items: sameItems },
    admin,
    400,
  );
  ok((await orderOf(oK.id)).transportMode === 'DEALER_ABSORBED', 'rad etilgan tahrir rejimni saqlab qoldi');
  await assertBothCards(cK.id, oK.id, SALE, 'rad etilgan CPD ga o\'tishdan keyin');
  eq((await carveOf(cK.id)).sum, 0, 'rad etilgan tahrir carve-out yozmadi');

  await req('POST', `/payments/${payK.id}/void`, { reason: 'TM mode switch back' }, admin, 201);
  eq(await vehBalanceOf(tK.id), 0, 'void returned the driver balance to 0');
  await req(
    'PUT',
    `/orders/${oK.id}`,
    { transportMode: 'CLIENT_PAYS_DRIVER', transportCost: TRANSPORT, items: sameItems },
    admin,
    200,
  );
  const oK1 = await orderOf(oK.id);
  ok(oK1.transportMode === 'CLIENT_PAYS_DRIVER', "to'lov bekor qilingach CPD ga o'tdi");
  await assertBothCards(cK.id, oK.id, NET, 'CPD ga o\'tgach mijoz SOF qarzdor');
  eq((await carveOf(cK.id)).sum, -TRANSPORT, 'exactly one net carve-out after the switch');
  eq(await vehBalanceOf(tK.id), 0, 'switching into CPD leaves the driver at 0');

  // ═══════════════════════════════════════════════════════════════════
  // 15. BORIB-KELISH — CPD → DEALER_ABSORBED → CPD must not accumulate carve-outs
  //     A delta-posting helper that adds a row without reversing the old one leaves TWO
  //     carve-outs (−4 000 000) — the client card would read 18 000 000 and the order
  //     card 20 000 000. The observable balance is asserted first, the ledger second.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n— 15. CPD → Diller → CPD: carve-out to\'planib qolmaydi —');
  const cL = await mkClient('L');
  const tL = await mkTruck('truckL');
  const oL = (await mkOrder(cL.id, 'CLIENT_PAYS_DRIVER', SALE, TRANSPORT, { vehicleId: tL.id })).body;
  await assertBothCards(cL.id, oL.id, NET, 'boshlanish (CPD)');
  eq((await carveOf(cL.id)).sum, -TRANSPORT, 'bitta carve-out');

  await req(
    'PUT',
    `/orders/${oL.id}`,
    { transportMode: 'DEALER_ABSORBED', transportCost: TRANSPORT, items: sameItems },
    admin,
    200,
  );
  await assertBothCards(cL.id, oL.id, SALE, 'oraliq (Diller to\'laydi)');
  eq((await carveOf(cL.id)).sum, 0, 'carve-out neytrallandi');

  await req(
    'PUT',
    `/orders/${oL.id}`,
    { transportMode: 'CLIENT_PAYS_DRIVER', transportCost: TRANSPORT, items: sameItems },
    admin,
    200,
  );
  const oL2 = await orderOf(oL.id);
  ok(oL2.transportMode === 'CLIENT_PAYS_DRIVER', 'CPD ga qaytdi');
  eq(oL2.saleTotal, SALE, 'saleTotal survived both edits');
  await assertBothCards(cL.id, oL.id, NET, 'borib-kelgandan keyin');
  const carveL = await carveOf(cL.id);
  ok(carveL.rows.length > 0, 'carve-out qatorlari mavjud (bo\'sh emas)');
  // −2 000 000, never −4 000 000: exactly ONE net carve-out survives the round trip
  eq(carveL.sum, -TRANSPORT, 'EXACTLY one net carve-out after the round trip');
  eq(await vehBalanceOf(tL.id), 0, 'round trip left no driver liability');

  console.log(`\n${failures === 0 ? '✓ ALL GREEN' : `✗ ${failures} FAILED`} — ${checks} checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('transport-modes E2E crashed:', e);
  process.exit(1);
});
