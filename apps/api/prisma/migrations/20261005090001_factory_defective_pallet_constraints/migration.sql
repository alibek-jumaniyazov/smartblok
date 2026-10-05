-- The enum value is committed by the preceding migration before it is used here.
ALTER TABLE "PalletTransaction" ADD CONSTRAINT "pallet_factory_defect_shape" CHECK (
  "type" <> 'DEFECTIVE_FROM_FACTORY' OR (
    "factoryId" IS NOT NULL AND "clientId" IS NULL AND "orderId" IS NULL
    AND "unitPrice" IS NULL AND "reversalOfId" IS NULL
    AND length(btrim(COALESCE("note", ''))) > 0
  )
);

CREATE UNIQUE INDEX "PalletTransaction_factory_defect_reversal_once"
  ON "PalletTransaction" ("reversalOfId")
  WHERE "type" = 'REVERSAL' AND "reversalOfType" = 'DEFECTIVE_FROM_FACTORY';
