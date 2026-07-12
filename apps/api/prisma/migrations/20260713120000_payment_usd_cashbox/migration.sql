-- Mixed naqd (CASH) payment: the UZS part lands in `cashboxId` (a UZS kassa box)
-- and the USD part lands in this second (USD kassa) box. Null for non-mixed payments.
ALTER TABLE "Payment" ADD COLUMN "usdCashboxId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_usdCashboxId_idx" ON "Payment"("usdCashboxId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_usdCashboxId_fkey" FOREIGN KEY ("usdCashboxId") REFERENCES "Cashbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
