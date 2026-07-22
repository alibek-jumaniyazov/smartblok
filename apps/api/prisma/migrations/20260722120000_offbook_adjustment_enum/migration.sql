-- Off-book balance-control («balansni nazorat qilish»), enum only.
--
-- Postgres refuses to USE an enum value that was added by ALTER TYPE inside the same
-- transaction (Prisma wraps each migration in one). This migration only ADDS the value;
-- nothing references it here, so no second "usage" migration is required — the runtime
-- adjust-balance posting runs in a later, separate transaction.
ALTER TYPE "LedgerSource" ADD VALUE IF NOT EXISTS 'OFFBOOK_ADJUSTMENT';
