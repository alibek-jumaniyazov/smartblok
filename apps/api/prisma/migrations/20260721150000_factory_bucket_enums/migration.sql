-- Factory advance rework, step 1/2 — TYPES ONLY.
--
-- Postgres refuses to USE an enum value that was added by ALTER TYPE inside the same
-- transaction, and Prisma wraps each migration in one. So the new LedgerSource member
-- lands here and the backfill that references it lives in the next migration.

-- New standalone enums (safe to create and use in one transaction — only ADD VALUE is restricted)
CREATE TYPE "FactoryPayIntent" AS ENUM ('CASH', 'BANK', 'UNKNOWN');
CREATE TYPE "FactoryBucket" AS ENUM ('PAYABLE', 'ADVANCE_CASH', 'ADVANCE_BANK');

-- «avansdan yechish» posts a zero-sum pair with this source
ALTER TYPE "LedgerSource" ADD VALUE IF NOT EXISTS 'ADVANCE_DRAW';
