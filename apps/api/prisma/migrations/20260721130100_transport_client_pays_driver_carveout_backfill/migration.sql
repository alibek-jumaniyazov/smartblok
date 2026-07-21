-- ═══════════════════════════════════════════════════════════════════════════════════════
-- CLIENT_PAYS_DRIVER carve-out backfill — bring history onto the new money model.
--
-- TARGET STATE, per non-cancelled CLIENT_PAYS_DRIVER (CPD) order:
--     CLIENT  ledger contribution = saleTotal − carve      (carve = LEAST(transportCost, saleTotal))
--     VEHICLE ledger contribution = 0                      (the dealer is not in that chain)
-- and, just as binding: EVERY OTHER order's numbers must come out byte-identical. The two
-- defects this file previously had were both of the second kind — collateral damage to
-- histories that were never CPD, or that the dealer had genuinely already settled in cash.
--
-- ───────────────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT — run these on PRODUCTION before applying, so the blast radius is known.
-- Nothing here writes; each one answers "how many rows does this migration touch?".
--
--   -- (a) how many TRANSPORT_DIRECT payments exist at all, and of what value
--   SELECT count(*), coalesce(sum(amount), 0) FROM "Payment" WHERE kind = 'TRANSPORT_DIRECT';
--
--   -- (b) THE FIX-A POPULATION: TRANSPORT_DIRECT payments that touch a NON-CPD order, split
--   --     into "wholly non-CPD" (must be left alone entirely) and "mixed" (needs per-order
--   --     netting: reverse the CPD slice, re-post the rest). Both were mangled before.
--   SELECT CASE WHEN cpd = 0 THEN 'wholly non-CPD (untouched)'
--               WHEN cpd < total THEN 'MIXED (partial reversal)'
--               ELSE 'wholly CPD (full reversal)' END AS bucket,
--          count(*), sum(total)
--   FROM (
--     SELECT p.id, p.amount AS total,
--            coalesce(sum(pa.amount) FILTER (WHERE o."transportMode" = 'CLIENT_PAYS_DRIVER'), 0) AS cpd
--     FROM "Payment" p
--     LEFT JOIN "PaymentAllocation" pa ON pa."paymentId" = p.id AND pa."voidedAt" IS NULL
--     LEFT JOIN "Order" o ON o.id = pa."orderId"
--     WHERE p.kind = 'TRANSPORT_DIRECT'
--     GROUP BY p.id, p.amount
--   ) s GROUP BY 1;
--
--   -- (c) TRANSPORT_DIRECT payments with NO surviving allocation — unattributable, see the
--   --     "UNALLOCATED TRANSPORT_DIRECT" note below. Expect 0; investigate by hand if not.
--   SELECT count(*) FROM "Payment" p
--   WHERE p.kind = 'TRANSPORT_DIRECT' AND p."voidedAt" IS NULL
--     AND NOT EXISTS (SELECT 1 FROM "PaymentAllocation" pa
--                     WHERE pa."paymentId" = p.id AND pa."voidedAt" IS NULL);
--
--   -- (d) THE FIX-B POPULATION: vehicles carrying CPD cost legs, and how much cash the dealer
--   --     already handed those drivers. free_cash > 0 ⇒ some cost legs are genuinely paid and
--   --     MUST NOT be reversed (allocated or not — VEHICLE_OUT credits post at PAYMENT level).
--   SELECT v.id, v.plate, v.cpd_cost, v.balance, greatest(v.balance + v.cpd_cost, 0) AS free_cash
--   FROM (
--     SELECT veh.id, veh.plate,
--            (SELECT coalesce(sum(-le.amount), 0) FROM "LedgerEntry" le JOIN "Order" o ON o.id = le."orderId"
--             WHERE le."vehicleId" = veh.id AND le.account = 'VEHICLE' AND le.source = 'TRANSPORT_COST'
--               AND o."transportMode" = 'CLIENT_PAYS_DRIVER' AND le."reversalOfId" IS NULL
--               AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."reversalOfId" = le.id)) AS cpd_cost,
--            (SELECT coalesce(sum(le.amount), 0) FROM "LedgerEntry" le
--             WHERE le."vehicleId" = veh.id AND le.account = 'VEHICLE') AS balance
--     FROM "Vehicle" veh
--   ) v WHERE v.cpd_cost > 0 ORDER BY free_cash DESC;
--
--   -- (e) CPD orders that already have a carve-out row (step 3 will skip them) — on a first
--   --     run this is 0; on a re-run it equals the step-3 population, proving idempotency.
--   SELECT count(*) FROM "Order" o WHERE o."transportMode" = 'CLIENT_PAYS_DRIVER'
--     AND EXISTS (SELECT 1 FROM "LedgerEntry" le
--                 WHERE le."orderId" = o.id AND le.source = 'TRANSPORT_CLIENT_DIRECT');
--
-- ───────────────────────────────────────────────────────────────────────────────────────
-- PROOF — every history lands on the target. saleTotal = 22 000 000, transportCost = 2 000 000,
-- so carve = 2 000 000 and the client must end on 20 000 000.
--
--   CASE 1 — plain CPD order, no TRANSPORT_DIRECT payment ever recorded:
--     before:  CLIENT = +22 000 000 (ORDER_SALE)
--              VEHICLE = −2 000 000 (TRANSPORT_COST, posted at LOADING; absent if never loaded)
--     step 2 free_cash = balance + candidates = −2 000 000 + 2 000 000 = 0 ⇒ leg uncovered
--             ⇒ reverse cost leg   VEHICLE +2 000 000 → VEHICLE =          0  ✔
--     step 3 (carve-out)           CLIENT  −2 000 000 → CLIENT  = 20 000 000  ✔
--
--   CASE 2 — a TRANSPORT_DIRECT payment of T, wholly allocated to CPD orders (T is whatever the
--            operator typed; the landing point does not depend on it, which is the point of
--            reversing rather than recomputing):
--     before:  CLIENT = +22 000 000 − T ,  VEHICLE = −2 000 000 + T   (= 0 when T = 2 000 000)
--     step 1 cpdShare = T ⇒ reverse BOTH rows in full, re-post nothing
--                                  CLIENT = 22 000 000 , VEHICLE = −2 000 000
--     step 2 free_cash = −2 000 000 + 2 000 000 = 0 ⇒ reverse cost leg  VEHICLE = 0  ✔
--     step 3                                                   CLIENT = 20 000 000  ✔
--
--   CASE 3 (FIX A) — TRANSPORT_DIRECT recorded against a NON-CPD order. Legal before this
--            change: the transportMode guard in assertAllocationParty is NEW. The old file
--            keyed step 1 on Payment.kind alone, so it stripped the client's credit and left
--            nothing in its place — a client at 20 000 000 silently jumped to 22 000 000 and
--            the driver was handed a debt he had already been paid out of.
--     cpdShare = 0 ⇒ step 1 skips the payment ENTIRELY; step 2 sees no CPD cost leg for that
--     order; step 3 does not match it. The order is bit-for-bit untouched.               ✔
--
--   CASE 4 (FIX A, the hard one) — ONE TRANSPORT_DIRECT payment of T = 3 000 000 spanning a CPD
--            order (allocated 2 000 000) and a DEALER_ABSORBED order (allocated 1 000 000).
--            An all-or-nothing EXISTS(…CPD…) predicate gets this wrong in BOTH directions:
--            include it and the non-CPD order loses 1 000 000 of credit; exclude it and the CPD
--            order keeps a 2 000 000 credit that step 3 then double-counts. The ledger rows
--            carry paymentId but NOT orderId, so the split has to be arithmetic, not a filter.
--     step 1a reverses the two rows in full   CLIENT +3 000 000 , VEHICLE −3 000 000
--     step 1b re-posts the surviving non-CPD share, keep = T − cpdShare = 1 000 000, by scaling
--             each original row by keep/total — which preserves account, party AND sign:
--                                             CLIENT −1 000 000 , VEHICLE +1 000 000
--     net effect = exactly the CPD slice removed, the non-CPD order's numbers unchanged.  ✔
--
--   CASE 5 (FIX B) — CPD order whose driver the dealer ACTUALLY paid, via a VEHICLE_OUT of
--            2 000 000. That branch never had a mode guard, so this exists in the wild.
--            before: VEHICLE = −2 000 000 (cost) + 2 000 000 (cash) = 0 — already on target.
--            The old file reversed the cost leg regardless, inventing a 2 000 000 driver
--            advance out of nothing.
--     step 2 free_cash = balance + candidates = 0 + 2 000 000 = 2 000 000 > 0 ⇒ the leg is
--             covered ⇒ NOT reversed. VEHICLE stays 0 ✔, and no phantom advance ✔.
--     Note this works whether or not the VEHICLE_OUT was ALLOCATED to the order: its credit is
--     posted at PAYMENT level (payments.service.ts postLedger, VEHICLE_OUT branch), carrying a
--     vehicleId and no orderId, so a PaymentAllocation-based guard would miss the unallocated
--     case entirely. Step 2 therefore nets over the VEHICLE ACCOUNT, not over allocations.
--
--   CASE 6 (FIX B, partial cover) — same vehicle, TWO CPD legs of 2 000 000 each, one covered by
--            an UNALLOCATED VEHICLE_OUT of 2 000 000.
--     balance = −4 000 000 + 2 000 000 = −2 000 000 ; candidates = 4 000 000 ; free_cash = 2 000 000
--     Legs are walked oldest-first (date, id — the repo's FIFO convention, cf. auto-allocate.ts):
--       leg1 cum_before = 0         <  free_cash ⇒ covered ⇒ kept
--       leg2 cum_before = 2 000 000 >= free_cash ⇒ uncovered ⇒ reversed
--     final VEHICLE = −4 000 000 + 2 000 000 + 2 000 000 = 0 ✔, no advance invented ✔.
--     A leg only PARTIALLY covered by free_cash counts as covered and is kept: erring towards
--     leaving history alone can never manufacture a debt the driver does not owe.
--
--   CASE 7 (FIX B, non-CPD legs share the driver) — a DEALER_ABSORBED leg of −3 000 000 and a CPD
--            leg of −2 000 000 on one vehicle, cash +5 000 000. balance = 0, candidates = 2 000 000,
--            free_cash = 2 000 000 ⇒ CPD leg kept. Correct: the dealer paid for both trips, so
--            neither leg is fictional. With NO cash: balance = −5 000 000, free_cash = 0 ⇒ only
--            the CPD leg is reversed and the non-CPD leg is left at −3 000 000 exactly. ✔
--
--   CANCELLED orders: soft-cancel already ran reverseAllForOrder, so their order-linked rows
--   carry a reversedBy and are skipped by the guards; step 3 filters them out explicitly,
--   otherwise it would inject an unreversed −carve and drive the client negative. Their
--   TRANSPORT_DIRECT payment rows carry NO orderId, so cancel never reversed them — step 1
--   deliberately counts cancelled CPD orders in cpdShare, because "should this payment have
--   posted at all?" is answered by transportMode alone, not by the order's status.
--
--   UNALLOCATED TRANSPORT_DIRECT (pre-flight query (c)): cpdShare = 0, so step 1 leaves it
--   alone. There is no order to attribute it to and therefore no defensible arithmetic — and
--   silently deleting a client credit is the exact defect CASE 3 is about. If (c) returns
--   rows, allocate them by hand BEFORE applying, or the client will carry both that credit and
--   the step-3 carve-out.
--
-- HOUSE STYLE: history is IMMUTABLE. Nothing is DELETEd or UPDATEd — corrections are
-- compensating rows carrying reversalOfId, byte-for-byte what LedgerService.reverse() writes
-- (same date — a date-windowed statement must net to zero, not double-count). Every NOT NULL
-- column is populated and the ledger_party_matches_account / ledger_amount_nonzero CHECKs are
-- respected: re-posts copy the original's party columns and are guarded to a non-zero amount.
--
-- IDEMPOTENCY: "LedgerEntry"."reversalOfId" is UNIQUE, so `NOT EXISTS (… reversalOfId = le.id)`
-- is the same guard the application uses and makes steps 1a/2 no-ops on a re-run. Step 1b is
-- guarded on its own marker note, step 3 on the presence of a TRANSPORT_CLIENT_DIRECT row.
-- Step 2 is idempotent by construction as well as by guard: after a run the reversed legs net
-- to zero, so the recomputed balance and the shrunken candidate set agree on the same verdict.
--
-- STATEMENT ORDER IS LOAD-BEARING here (it was not in the previous version):
--   * 1b reads the rows 1a has just written, which is how it excludes already-voided payments
--     (voidPayment reversed their rows, so 1a produces nothing for them and 1b follows suit).
--   * 2 reads the VEHICLE balance AFTER 1a/1b, so the TRANSPORT_DIRECT vehicle credits that
--     step 1 removed no longer count as free cash — without that ordering CASE 2 would see
--     free_cash = 2 000 000 and wrongly keep its cost leg.
-- Beyond that the steps touch disjoint row sets: 1a/1b select by paymentId (source='PAYMENT'),
-- 2 selects source='TRANSPORT_COST' (those rows never carry a paymentId), 3 INSERTs a
-- source='TRANSPORT_CLIENT_DIRECT' row matching no other predicate. No statement can reverse
-- another's output, and none can self-conflict on the reversalOfId unique index
-- (INSERT…SELECT reads the pre-insert snapshot and each original appears at most once).
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- 0) HARD STOP — the one case this file cannot repair, promoted from a comment to a guard.
--    An UNALLOCATED, non-voided TRANSPORT_DIRECT payment has cpdShare = 0, so step 1 leaves its
--    client credit standing while step 3 still writes the carve-out: the client is deducted
--    TWICE. Verified on a scratch DB — a 22 000 000 CPD order with a 2 000 000 unallocated
--    TRANSPORT_DIRECT landed the client on 18 000 000 instead of 20 000 000.
--    There is no order to attribute the payment to and therefore no defensible arithmetic, so
--    the only safe behaviour is to REFUSE TO RUN. Allocate these payments by hand (or void
--    them), then re-apply. A commented-out pre-flight query is not a control: it depends on a
--    human remembering to run it, and the failure mode is silent wrong money.
--    Empty/fresh databases have no such rows, so this never fires in dev, test or CI.
DO $$
DECLARE
  stuck integer;
BEGIN
  SELECT count(*) INTO stuck
  FROM "Payment" p
  WHERE p.kind = 'TRANSPORT_DIRECT'
    AND p."voidedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "PaymentAllocation" pa
      WHERE pa."paymentId" = p.id AND pa."voidedAt" IS NULL
    );

  IF stuck > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Migratsiya toʼxtatildi: %s ta TRANSPORT_DIRECT toʼlovi hech bir buyurtmaga taqsimlanmagan.',
        stuck),
      HINT = 'Bu toʼlovlarni qoʼlda buyurtmalarga taqsimlang yoki bekor qiling, soʼng migratsiyani qayta ishga tushiring. Aks holda mijozdan transport puli IKKI MARTA yechiladi.';
  END IF;
END $$;

-- 1a) Un-post what a TRANSPORT_DIRECT payment wrote (a CLIENT credit and a VEHICLE settlement)
--     — but ONLY for payments that actually touch a CLIENT_PAYS_DRIVER order. Under the new
--     model that slice was already carved out of the client's debt at order create, so
--     crediting him again would double-deduct, and the VEHICLE credit settles a debt the dealer
--     never had. A payment whose orders are all non-CPD (CASE 3) is skipped outright.
--     The payment ROW survives — it still documents that the driver got his cash and still
--     drives transportPaidStatus. Already-voided payments are skipped for free: voidPayment
--     reversed their rows, so the NOT EXISTS guard already holds.
INSERT INTO "LedgerEntry" (
  id, at, date, account, source, amount,
  "clientId", "factoryId", "vehicleId", "orderId", "paymentId", "importBatchId",
  note, "createdById", "reversalOfId"
)
SELECT gen_random_uuid()::text, now(), le.date, le.account, le.source, -le.amount,
       le."clientId", le."factoryId", le."vehicleId", le."orderId", le."paymentId", le."importBatchId",
       'Migratsiya: shofyorga to''g''ridan-to''g''ri to''lov endi kassa/ledgerga yozilmaydi',
       le."createdById", le.id
FROM "LedgerEntry" le
JOIN "Payment" p ON p.id = le."paymentId"
JOIN (
  -- cpdShare = the part of the payment that sits on CLIENT_PAYS_DRIVER orders, capped at the
  -- payment itself (allocations can only under-run it, but the cap keeps the ratio in [0,1]).
  SELECT p2.id AS "paymentId",
         p2.amount AS total,
         LEAST(
           COALESCE(SUM(pa.amount) FILTER (WHERE o."transportMode" = 'CLIENT_PAYS_DRIVER'), 0),
           p2.amount
         ) AS cpd
  FROM "Payment" p2
  LEFT JOIN "PaymentAllocation" pa ON pa."paymentId" = p2.id AND pa."voidedAt" IS NULL
  LEFT JOIN "Order" o ON o.id = pa."orderId"
  WHERE p2.kind = 'TRANSPORT_DIRECT'
  GROUP BY p2.id, p2.amount
) s ON s."paymentId" = p.id
WHERE p.kind = 'TRANSPORT_DIRECT'
  AND s.cpd > 0
  AND le."reversalOfId" IS NULL
  -- IDEMPOTENCY: step 1b's re-post rows are themselves PAYMENT rows carrying this paymentId
  -- and no reversalOfId, so on a SECOND run they match every other predicate here and 1a
  -- would reverse the non-CPD share it had just preserved — the mixed client jumping
  -- 29 000 000 → 30 000 000 and his driver to −1 000 000. Exclude 1b's own marker.
  AND le.note IS DISTINCT FROM 'Migratsiya: TRANSPORT_DIRECT — boshqa rejimdagi buyurtmalar ulushi saqlandi'
  AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."reversalOfId" = le.id);

-- 1b) MIXED payments only (CASE 4): 1a reversed the row in full, so re-post the share that
--     belongs to the NON-CPD orders — those keep the old, still-correct treatment. Scaling the
--     ORIGINAL row's amount by keep/total carries account, party columns and sign along for
--     free, so the CLIENT row comes back negative (a credit) and the VEHICLE row positive.
--     Driven off the reversal rows 1a just wrote, which is what makes voided payments (no
--     reversal produced) fall out automatically. The marker note is this file's alone and is
--     what keeps a second run from re-posting the share twice.
INSERT INTO "LedgerEntry" (
  id, at, date, account, source, amount,
  "clientId", "factoryId", "vehicleId", "orderId", "paymentId", "importBatchId",
  note, "createdById"
)
SELECT gen_random_uuid()::text, now(), rev.date, rev.account, rev.source,
       round(-rev.amount * (s.total - s.cpd) / s.total, 2),
       rev."clientId", rev."factoryId", rev."vehicleId", rev."orderId", rev."paymentId", rev."importBatchId",
       'Migratsiya: TRANSPORT_DIRECT — boshqa rejimdagi buyurtmalar ulushi saqlandi',
       rev."createdById"
FROM "LedgerEntry" rev
JOIN "Payment" p ON p.id = rev."paymentId"
JOIN (
  SELECT p2.id AS "paymentId",
         p2.amount AS total,
         LEAST(
           COALESCE(SUM(pa.amount) FILTER (WHERE o."transportMode" = 'CLIENT_PAYS_DRIVER'), 0),
           p2.amount
         ) AS cpd
  FROM "Payment" p2
  LEFT JOIN "PaymentAllocation" pa ON pa."paymentId" = p2.id AND pa."voidedAt" IS NULL
  LEFT JOIN "Order" o ON o.id = pa."orderId"
  WHERE p2.kind = 'TRANSPORT_DIRECT'
  GROUP BY p2.id, p2.amount
) s ON s."paymentId" = p.id
WHERE p.kind = 'TRANSPORT_DIRECT'
  AND rev."reversalOfId" IS NOT NULL
  AND rev.note = 'Migratsiya: shofyorga to''g''ridan-to''g''ri to''lov endi kassa/ledgerga yozilmaydi'
  AND s.total > 0
  AND s.cpd < s.total
  -- ledger_amount_nonzero: never insert a row that rounds away to nothing
  AND round(-rev.amount * (s.total - s.cpd) / s.total, 2) <> 0
  AND NOT EXISTS (
    SELECT 1 FROM "LedgerEntry" k
    WHERE k."paymentId" = rev."paymentId"
      AND k.account = rev.account
      AND k.note = 'Migratsiya: TRANSPORT_DIRECT — boshqa rejimdagi buyurtmalar ulushi saqlandi'
  );

-- 2) Un-post the VEHICLE TRANSPORT_COST leg of CLIENT_PAYS_DRIVER orders. It was posted at
--    LOADING as "dealer owes driver", which is false for this mode — the client pays him.
--    UNLESS the dealer demonstrably already paid that driver: the VEHICLE_OUT credit lands at
--    PAYMENT level with a vehicleId and NO orderId, so the only sound test is a net over the
--    vehicle's whole account (CASE 5/6/7). free_cash is what the balance WOULD become if every
--    candidate leg were reversed; anything above zero is cash with no cost left to sit against
--    — i.e. a phantom driver advance — so that much cost must stay. Legs are covered
--    oldest-first and a partially covered leg is kept.
INSERT INTO "LedgerEntry" (
  id, at, date, account, source, amount,
  "clientId", "factoryId", "vehicleId", "orderId", "paymentId", "importBatchId",
  note, "createdById", "reversalOfId"
)
WITH cand AS (
  -- active, not-yet-reversed CPD cost legs — the reversal candidates
  SELECT le.id, le.date, le."vehicleId" AS vid, -le.amount AS cost
  FROM "LedgerEntry" le
  JOIN "Order" o ON o.id = le."orderId"
  WHERE le.account = 'VEHICLE'
    AND le.source = 'TRANSPORT_COST'
    AND o."transportMode" = 'CLIENT_PAYS_DRIVER'
    AND le."reversalOfId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."reversalOfId" = le.id)
),
bal AS (
  -- the driver's CURRENT net position: every VEHICLE row, reversals included (this is exactly
  -- how LedgerService.vehicleBalance sums it), and therefore already net of step 1.
  SELECT le."vehicleId" AS vid, SUM(le.amount) AS balance
  FROM "LedgerEntry" le
  WHERE le.account = 'VEHICLE'
  GROUP BY le."vehicleId"
),
free AS (
  SELECT c.vid, GREATEST(COALESCE(b.balance, 0) + SUM(c.cost), 0) AS free_cash
  FROM cand c
  LEFT JOIN bal b ON b.vid = c.vid
  GROUP BY c.vid, b.balance
),
ranked AS (
  SELECT c.*,
         COALESCE(SUM(c.cost) OVER (
           PARTITION BY c.vid ORDER BY c.date, c.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS cum_before
  FROM cand c
)
SELECT gen_random_uuid()::text, now(), le.date, le.account, le.source, -le.amount,
       le."clientId", le."factoryId", le."vehicleId", le."orderId", le."paymentId", le."importBatchId",
       'Migratsiya: «Shofyorga mijoz to''laydi» — diler shofyorga qarzdor emas',
       le."createdById", le.id
FROM ranked r
JOIN free f ON f.vid = r.vid
JOIN "LedgerEntry" le ON le.id = r.id
WHERE r.cum_before >= f.free_cash;   -- everything below free_cash is genuinely paid-for: keep

-- 3) Write the missing CLIENT carve-out — exactly what order create now posts.
--    carve = LEAST(transportCost, saleTotal), floored at 0: a mis-keyed transport larger than
--    the sale must never push the client's debt below zero. Rounded to the column's own
--    scale (18,2) so it matches round2() on the application side.
--    `date` = the order's business date and `createdById` = the order's author, so the row is
--    indistinguishable from one the service would have written.
INSERT INTO "LedgerEntry" (
  id, at, date, account, source, amount,
  "clientId", "orderId", note, "createdById"
)
SELECT gen_random_uuid()::text, now(), o.date, 'CLIENT', 'TRANSPORT_CLIENT_DIRECT',
       -GREATEST(LEAST(round(o."transportCost", 2), round(o."saleTotal", 2)), 0),
       o."clientId", o.id,
       'Shofyorga mijoz to''laydi (summa ichidan)',
       o."createdById"
FROM "Order" o
WHERE o."transportMode" = 'CLIENT_PAYS_DRIVER'
  AND o.status <> 'CANCELLED'
  AND GREATEST(LEAST(round(o."transportCost", 2), round(o."saleTotal", 2)), 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "LedgerEntry" le
    WHERE le."orderId" = o.id AND le.source = 'TRANSPORT_CLIENT_DIRECT'
  );
