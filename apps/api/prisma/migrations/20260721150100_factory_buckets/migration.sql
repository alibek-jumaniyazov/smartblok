-- Factory advance rework, step 2/2 — COLUMNS, BACKFILL, CONSTRAINTS.
--
-- Owner rules locked 2026-07-21:
--   • money standing at the factory must NOT auto-consume order debt — prepayments live
--     in ADVANCE_CASH / ADVANCE_BANK, order cost lives in PAYABLE, and only an explicit
--     «avansdan yechish» moves value between them;
--   • the two advance channels are displayed separately and the drawn channel decides
--     that portion's price basis (naqd → FACTORY_CASH, o'tkazma → FACTORY_BANK);
--   • an order carries a three-way factory-payment intent (naqd / o'tkazma / aniq emas).
--
-- INVARIANT PRESERVED: Σ over the three buckets == the old single netted FACTORY
-- balance, both before and after this migration. Nothing that reads factoryBalance()
-- changes value; only the breakdown is new.

-- ─────────────────────────── columns ───────────────────────────

ALTER TABLE "Order" ADD COLUMN "factoryPayIntent" "FactoryPayIntent" NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "LedgerEntry" ADD COLUMN "factoryBucket" "FactoryBucket";
ALTER TABLE "LedgerEntry" ADD COLUMN "allocationId" TEXT;

ALTER TABLE "PaymentAllocation" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "PaymentAllocation" ADD COLUMN "voidedById" TEXT;
ALTER TABLE "PaymentAllocation" ADD COLUMN "fromAdvance" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────── backfill ───────────────────────────

-- 1. Existing orders had a definite basis (provisionalPriceKind was snapshotted at
--    creation and never editable), so they stay definite rather than becoming UNKNOWN.
UPDATE "Order" o
SET "factoryPayIntent" = 'CASH'
WHERE EXISTS (
  SELECT 1 FROM "OrderItem" i
  WHERE i."orderId" = o."id" AND i."provisionalPriceKind" = 'FACTORY_CASH'
);
UPDATE "Order" o
SET "factoryPayIntent" = 'BANK'
WHERE o."factoryPayIntent" = 'UNKNOWN'
  AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = o."id");

-- 2. Everything on the FACTORY account starts as open order debt.
UPDATE "LedgerEntry" SET "factoryBucket" = 'PAYABLE' WHERE "account" = 'FACTORY';

-- 3. Un-imported factory payments become standing advance in their own channel.
--    IMPORTED rows deliberately stay PAYABLE: the workbook's factory payments are
--    historical settlements of the very purchases it also imports, never a standing
--    prepayment, so the reported «zavodga qarzimiz» keeps its exact legacy value.
--    BONUS-funded offsets stay PAYABLE too — they are neither naqd nor o'tkazma.
UPDATE "LedgerEntry" le
SET "factoryBucket" = CASE
      WHEN p."method" IN ('CASH', 'CLICK', 'CARD', 'USD') THEN 'ADVANCE_CASH'::"FactoryBucket"
      ELSE 'ADVANCE_BANK'::"FactoryBucket"
    END
FROM "Payment" p
WHERE p."id" = le."paymentId"
  AND le."account" = 'FACTORY'
  AND le."source" = 'PAYMENT'
  AND le."reversalOfId" IS NULL
  AND le."importBatchId" IS NULL
  AND p."kind" = 'FACTORY_OUT'
  AND p."method" <> 'BONUS';

-- 4. Every allocation those payments already carry was, in the new model, a draw.
--    Materialise the zero-sum pair so the advance shows as spent and the payable as
--    settled — exactly what the explicit button will produce from now on.
INSERT INTO "LedgerEntry" ("id", "at", "date", "account", "source", "amount", "factoryBucket",
                           "factoryId", "orderId", "paymentId", "allocationId", "note", "createdById")
SELECT gen_random_uuid(), NOW(), le."date", 'FACTORY', 'ADVANCE_DRAW',
       -a."amount", le."factoryBucket", le."factoryId", a."orderId", a."paymentId", a."id",
       'Migratsiya: mavjud taqsimot avansdan yechish sifatida qayd etildi', a."createdById"
FROM "PaymentAllocation" a
JOIN "LedgerEntry" le
  ON le."paymentId" = a."paymentId"
 AND le."account" = 'FACTORY'
 AND le."source" = 'PAYMENT'
 AND le."reversalOfId" IS NULL
WHERE a."voidedAt" IS NULL
  AND a."amount" <> 0
  AND le."factoryBucket" IN ('ADVANCE_CASH', 'ADVANCE_BANK');

INSERT INTO "LedgerEntry" ("id", "at", "date", "account", "source", "amount", "factoryBucket",
                           "factoryId", "orderId", "paymentId", "allocationId", "note", "createdById")
SELECT gen_random_uuid(), NOW(), le."date", 'FACTORY', 'ADVANCE_DRAW',
       a."amount", 'PAYABLE', le."factoryId", a."orderId", a."paymentId", a."id",
       'Migratsiya: mavjud taqsimot avansdan yechish sifatida qayd etildi', a."createdById"
FROM "PaymentAllocation" a
JOIN "LedgerEntry" le
  ON le."paymentId" = a."paymentId"
 AND le."account" = 'FACTORY'
 AND le."source" = 'PAYMENT'
 AND le."reversalOfId" IS NULL
WHERE a."voidedAt" IS NULL
  AND a."amount" <> 0
  AND le."factoryBucket" IN ('ADVANCE_CASH', 'ADVANCE_BANK');

UPDATE "PaymentAllocation" a
SET "fromAdvance" = true
FROM "LedgerEntry" le
WHERE le."allocationId" = a."id" AND le."source" = 'ADVANCE_DRAW';

-- 5. A reversal must sit in the same bucket as the row it cancels, or the pair would
--    not net to zero. (Reversals copy `source`, so step 3 skipped them on purpose.)
UPDATE "LedgerEntry" r
SET "factoryBucket" = t."factoryBucket"
FROM "LedgerEntry" t
WHERE r."reversalOfId" = t."id" AND r."account" = 'FACTORY';

-- 6. FACTORY_REFUND rows: match each refund to the channel its outgoing payment used, but
--    ONLY to the extent that channel STILL holds the money AFTER step 4's draws — otherwise
--    the outgoing payment sits in an advance channel while the refund stays on PAYABLE,
--    minting a spendable phantom advance and an equal phantom goods debt. This MUST run
--    after steps 4 & 5 so `net_standing` is the true post-draw balance, not the gross
--    advance (running it earlier let a fully-drawn payment's refund push the channel below
--    zero). Cumulative refunds in one channel use a running total, so several refunds can
--    never jointly over-draw it. Whatever does not fit is the factory repaying a goods
--    overpayment and correctly stays on PAYABLE.
WITH refunds AS (
  SELECT le."id",
         le."factoryId",
         le."date",
         CASE WHEN p."method" IN ('CASH', 'CLICK', 'CARD', 'USD')
              THEN 'ADVANCE_CASH'::"FactoryBucket" ELSE 'ADVANCE_BANK'::"FactoryBucket" END AS bucket,
         -le."amount" AS refunded
  FROM "LedgerEntry" le
  JOIN "Payment" p ON p."id" = le."paymentId"
  WHERE le."account" = 'FACTORY'
    AND le."source" = 'PAYMENT'
    AND le."reversalOfId" IS NULL
    AND le."importBatchId" IS NULL
    AND p."kind" = 'FACTORY_REFUND'
    AND p."method" <> 'BONUS'
), ranked AS (
  SELECT r.*,
         SUM(r."refunded") OVER (
           PARTITION BY r."factoryId", r."bucket" ORDER BY r."date", r."id"
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS cum_refunded
  FROM refunds r
), fits AS (
  SELECT rk."id", rk."bucket", rk."cum_refunded",
         COALESCE((
           SELECT SUM(x."amount") FROM "LedgerEntry" x
           WHERE x."account" = 'FACTORY' AND x."factoryId" = rk."factoryId" AND x."factoryBucket" = rk."bucket"
         ), 0) AS net_standing
  FROM ranked rk
)
UPDATE "LedgerEntry" le
SET "factoryBucket" = f."bucket"
FROM fits f
WHERE le."id" = f."id" AND f."net_standing" >= f."cum_refunded";

-- ─────────────────────────── constraints ───────────────────────────

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_allocationId_fkey"
  FOREIGN KEY ("allocationId") REFERENCES "PaymentAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_voidedById_fkey"
  FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The bucket is required for, and only for, the FACTORY account.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_factory_bucket" CHECK (
  ("account" =  'FACTORY' AND "factoryBucket" IS NOT NULL) OR
  ("account" <> 'FACTORY' AND "factoryBucket" IS NULL)
);

-- A draw is always attributable to one order and one allocation, so it can be undone
-- precisely. Both rows of the pair carry the link, including their reversals.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_advance_draw_link" CHECK (
  "source" <> 'ADVANCE_DRAW' OR ("orderId" IS NOT NULL AND "allocationId" IS NOT NULL)
);

CREATE INDEX "LedgerEntry_account_factoryId_factoryBucket_idx"
  ON "LedgerEntry"("account", "factoryId", "factoryBucket");
CREATE INDEX "LedgerEntry_allocationId_idx" ON "LedgerEntry"("allocationId");
CREATE INDEX "PaymentAllocation_voidedById_idx" ON "PaymentAllocation"("voidedById");
