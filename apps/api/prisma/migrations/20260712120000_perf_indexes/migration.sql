-- Index the foreign-key columns Postgres does not auto-index. Each backs a real
-- lookup/join (entity-scoped payments & cashboxes, per-program bonus rollups) that
-- would otherwise seq-scan as the tables grow. Names follow Prisma's convention so
-- the schema and DB stay in sync.
CREATE INDEX IF NOT EXISTS "Payment_payerEntityId_idx" ON "Payment"("payerEntityId");
CREATE INDEX IF NOT EXISTS "Payment_receiverEntityId_idx" ON "Payment"("receiverEntityId");
CREATE INDEX IF NOT EXISTS "Cashbox_entityId_idx" ON "Cashbox"("entityId");
CREATE INDEX IF NOT EXISTS "BonusTransaction_programId_idx" ON "BonusTransaction"("programId");
