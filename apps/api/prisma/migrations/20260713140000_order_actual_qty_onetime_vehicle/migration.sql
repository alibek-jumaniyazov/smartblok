-- Actual delivered quantity per item, entered at LOADING (zavoddan chiqqach yuk
-- o'zgarishi mumkin). NULL ⇒ actual == planned; historical rows stay untouched.
ALTER TABLE "OrderItem" ADD COLUMN "actualQuantityM3" DECIMAL(12,3);
ALTER TABLE "OrderItem" ADD COLUMN "actualPalletCount" INTEGER;

-- Loading stamp on the order (truck loaded at factory; who captured the actual load).
ALTER TABLE "Order" ADD COLUMN "loadedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "loadedById" TEXT;

-- One-time / ad-hoc vehicle flag (hidden from picker; transport still charged/paid).
ALTER TABLE "Vehicle" ADD COLUMN "oneTime" BOOLEAN NOT NULL DEFAULT false;

-- plate is unique ONLY for real vehicles: replace the full unique with a PARTIAL unique
-- so ad-hoc (oneTime) trucks may reuse/blank plates without collision (Postgres unique
-- already allows multiple NULLs; the WHERE limits it to non-oneTime rows).
DROP INDEX "Vehicle_plate_key";
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate") WHERE "oneTime" = false;
