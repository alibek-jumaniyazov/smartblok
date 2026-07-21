-- Vehicle plate hygiene. Blank plates -> NULL, canonical stored form, merge the same
-- physical truck into ONE row, then enforce uniqueness on a SPACE-INSENSITIVE,
-- Cyrillic-folded key so manual entry and the Excel importer can never split a truck.
--
-- ⚠ LOCALE-FREE FOLD: translate() lists BOTH cases of the Cyrillic lookalikes
-- ('АВЕКМНОРСТУХ' + 'авекмнорстух'). Postgres upper() on non-ASCII delegates to the
-- cluster's LC_CTYPE and is a no-op under C/POSIX, so relying on it to raise 'х' to 'Х'
-- before translate() would silently diverge from JS toUpperCase() — which ALWAYS folds
-- Cyrillic. Listing both cases makes the SQL key identical to plateKey() in
-- src/common/plate.ts on every cluster, and keeps upper() responsible for ASCII only.
-- The two must stay in lockstep.
--
-- Whole file = one transaction = all-or-nothing, and it is idempotent (safe to re-run).

-- ⚠ DROP THE OLD INDEX FIRST. 20260713140000 left a BYTE-EXACT partial unique index in
-- place. Step 1 below rewrites plates into canonical form, which is exactly what turns
-- two byte-DISTINCT rows (legal under that index) into two byte-IDENTICAL ones — the
-- classic `UPDATE t SET x = f(x)` self-conflict. Unique indexes are non-deferrable and
-- checked per tuple, so leaving it armed would abort the migration on precisely the
-- duplicates this file exists to repair. Dropping first is safe: if the final CREATE
-- fails, the transaction rolls back and the old index returns intact.
DROP INDEX IF EXISTS "Vehicle_plate_key";

-- 0) '' is not a plate. Under a unique index '' collides where NULL does not — this is
--    why adding a SECOND vehicle without a plate was rejected as a duplicate.
UPDATE "Vehicle" SET plate = NULL WHERE plate IS NOT NULL AND btrim(plate) = '';

-- 1) canonical stored form = normalizePlate(): upper, Cyrillic->Latin, spaces collapsed.
UPDATE "Vehicle"
SET plate = btrim(regexp_replace(translate(upper(plate),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+',' ','g'))
WHERE plate IS NOT NULL
  AND plate IS DISTINCT FROM
      btrim(regexp_replace(translate(upper(plate),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+',' ','g'));

-- 2) plan the merge. FLEET ONLY: oneTime=true rows are per-order history, never merged.
--    Survivor = oldest row for the key (createdAt, then id as a deterministic tiebreak).
DROP TABLE IF EXISTS "_vehicle_plate_merge";
CREATE TABLE "_vehicle_plate_merge" AS
WITH k AS (
  SELECT id, "createdAt",
         regexp_replace(translate(upper(plate),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+','','g') AS pkey
  FROM "Vehicle" WHERE "oneTime" = false AND plate IS NOT NULL
), ranked AS (
  SELECT *, first_value(id) OVER (PARTITION BY pkey ORDER BY "createdAt", id) AS keep_id FROM k
)
SELECT id AS loser_id, keep_id FROM ranked WHERE id <> keep_id;

-- 2a) carry hand-entered metadata onto the survivor BEFORE the losers vanish.
UPDATE "Vehicle" v
SET driver = COALESCE(v.driver, s.driver),
    phone  = COALESCE(v.phone,  s.phone),
    active = v.active OR s.any_active
FROM (
  SELECT m.keep_id,
         (array_remove(array_agg(l.driver ORDER BY l."createdAt"), NULL))[1] AS driver,
         (array_remove(array_agg(l.phone  ORDER BY l."createdAt"), NULL))[1] AS phone,
         bool_or(l.active) AS any_active
  FROM "_vehicle_plate_merge" m JOIN "Vehicle" l ON l.id = m.loser_id
  GROUP BY m.keep_id
) s WHERE v.id = s.keep_id;

-- 2b) the importer names a vehicle after its plate; a hand-typed name («Isuzu 5t») is better.
--     ⚠ Compare on the NORMALIZED key, not the raw columns: step 1 has already rewritten
--     `plate` but never touches `name`, so a row named after its own pre-normalization plate
--     («90 x 700 ca») would otherwise look hand-typed and could overwrite a real name — while
--     the survivor guard `name = plate` would fail on exactly the rows 2b exists to improve.
UPDATE "Vehicle" v SET name = s.better_name
FROM (
  SELECT m.keep_id, (array_remove(array_agg(l.name ORDER BY l."createdAt"), NULL))[1] AS better_name
  FROM "_vehicle_plate_merge" m JOIN "Vehicle" l ON l.id = m.loser_id
  WHERE regexp_replace(translate(upper(l.name),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+','','g')
        IS DISTINCT FROM
        regexp_replace(translate(upper(l.plate),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+','','g')
  GROUP BY m.keep_id
) s WHERE v.id = s.keep_id
  AND regexp_replace(translate(upper(v.name),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+','','g')
      = regexp_replace(translate(upper(v.plate),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+','','g');

-- 2c) keep a non-default capacity over the schema default 19.
UPDATE "Vehicle" v SET "capacityPallets" = s.cap
FROM (
  SELECT m.keep_id, min(l."capacityPallets") AS cap
  FROM "_vehicle_plate_merge" m JOIN "Vehicle" l ON l.id = m.loser_id
  WHERE l."capacityPallets" <> 19 GROUP BY m.keep_id
) s WHERE v.id = s.keep_id AND v."capacityPallets" = 19;

-- 2d) repoint EVERY reference. Order.vehicleId, Payment.vehicleId and LedgerEntry.vehicleId
--     are the only FKs to Vehicle. Payment/LedgerEntry are onDelete: Restrict, so a missed
--     reference aborts the whole migration rather than silently losing money — intended.
UPDATE "Order"       o SET "vehicleId" = m.keep_id FROM "_vehicle_plate_merge" m WHERE o."vehicleId" = m.loser_id;
UPDATE "Payment"     p SET "vehicleId" = m.keep_id FROM "_vehicle_plate_merge" m WHERE p."vehicleId" = m.loser_id;
UPDATE "LedgerEntry" l SET "vehicleId" = m.keep_id FROM "_vehicle_plate_merge" m WHERE l."vehicleId" = m.loser_id;

DELETE FROM "Vehicle" v USING "_vehicle_plate_merge" m WHERE v.id = m.loser_id;
DROP TABLE "_vehicle_plate_merge";

-- 3) enforce uniqueness on the space-insensitive key. Normalized-unique implies
--    exact-unique, so this REPLACES the byte-exact index dropped at the top.
--    Still partial on oneTime=false; NULL plates stay exempt (many plate-less trucks OK).
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"
  ((regexp_replace(translate(upper(plate),'АВЕКМНОРСТУХавекмнорстух','ABEKMHOPCTYXABEKMHOPCTYX'),'\s+','','g')))
  WHERE "oneTime" = false AND plate IS NOT NULL;
