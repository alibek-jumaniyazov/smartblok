CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAllocation_active_pair" ON "PaymentAllocation"("paymentId","orderId") WHERE "voidedAt" IS NULL;
