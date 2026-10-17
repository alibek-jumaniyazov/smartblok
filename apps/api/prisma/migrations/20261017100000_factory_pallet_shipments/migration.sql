-- CreateEnum
CREATE TYPE "FactoryPalletShipmentStatus" AS ENUM ('IN_TRANSIT', 'INSPECTING', 'AWAITING_RETURN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FactoryPalletShipment" (
    "id" TEXT NOT NULL,
    "returnNo" SERIAL NOT NULL,
    "factoryId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "arrivalNote" TEXT,
    "status" "FactoryPalletShipmentStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "vehiclePlate" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactoryPalletShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryPalletInspection" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "receiverName" TEXT NOT NULL,
    "documentRef" TEXT,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryPalletInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryPalletAcceptanceLine" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "palletTransactionId" TEXT NOT NULL,

    CONSTRAINT "FactoryPalletAcceptanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryPalletWarehouseReturn" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "qty" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryPalletWarehouseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FactoryPalletShipment_returnNo_key" ON "FactoryPalletShipment"("returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryPalletShipment_requestKey_key" ON "FactoryPalletShipment"("requestKey");

-- CreateIndex
CREATE INDEX "FactoryPalletShipment_factoryId_status_idx" ON "FactoryPalletShipment"("factoryId", "status");

-- CreateIndex
CREATE INDEX "FactoryPalletShipment_dispatchedAt_idx" ON "FactoryPalletShipment"("dispatchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryPalletInspection_requestKey_key" ON "FactoryPalletInspection"("requestKey");

-- CreateIndex
CREATE INDEX "FactoryPalletInspection_shipmentId_date_idx" ON "FactoryPalletInspection"("shipmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryPalletAcceptanceLine_palletTransactionId_key" ON "FactoryPalletAcceptanceLine"("palletTransactionId");

-- CreateIndex
CREATE INDEX "FactoryPalletAcceptanceLine_inspectionId_idx" ON "FactoryPalletAcceptanceLine"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryPalletWarehouseReturn_requestKey_key" ON "FactoryPalletWarehouseReturn"("requestKey");

-- CreateIndex
CREATE INDEX "FactoryPalletWarehouseReturn_shipmentId_date_idx" ON "FactoryPalletWarehouseReturn"("shipmentId", "date");

-- AddForeignKey
ALTER TABLE "FactoryPalletShipment" ADD CONSTRAINT "FactoryPalletShipment_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPalletShipment" ADD CONSTRAINT "FactoryPalletShipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPalletInspection" ADD CONSTRAINT "FactoryPalletInspection_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "FactoryPalletShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPalletInspection" ADD CONSTRAINT "FactoryPalletInspection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPalletAcceptanceLine" ADD CONSTRAINT "FactoryPalletAcceptanceLine_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "FactoryPalletInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPalletAcceptanceLine" ADD CONSTRAINT "FactoryPalletAcceptanceLine_palletTransactionId_fkey" FOREIGN KEY ("palletTransactionId") REFERENCES "PalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPalletWarehouseReturn" ADD CONSTRAINT "FactoryPalletWarehouseReturn_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "FactoryPalletShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryPalletWarehouseReturn" ADD CONSTRAINT "FactoryPalletWarehouseReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-local guarantees complement the service's locked cross-row quantity/date
-- checks. Existing ledger rows and historical returns are intentionally untouched.
ALTER TABLE "FactoryPalletShipment"
  ADD CONSTRAINT "factory_pallet_shipment_positive_qty" CHECK ("qty" > 0 AND "returnNo" > 0),
  ADD CONSTRAINT "factory_pallet_shipment_required_text" CHECK (
    char_length(btrim("vehiclePlate", E' \t\r\n')) > 0 AND char_length("vehiclePlate") <= 40
    AND char_length(btrim("driverName", E' \t\r\n')) > 0 AND char_length("driverName") <= 150
    AND char_length(btrim("requestKey", E' \t\r\n')) > 0
    AND char_length(btrim("requestHash", E' \t\r\n')) > 0
  ),
  ADD CONSTRAINT "factory_pallet_shipment_note_length" CHECK (
    ("note" IS NULL OR char_length("note") <= 1000)
    AND ("arrivalNote" IS NULL OR char_length("arrivalNote") <= 1000)
  ),
  ADD CONSTRAINT "factory_pallet_shipment_arrival_order" CHECK (
    "arrivedAt" IS NULL OR "arrivedAt" >= "dispatchedAt"
  ),
  ADD CONSTRAINT "factory_pallet_shipment_arrival_status" CHECK (
    ("status" <> 'IN_TRANSIT' OR "arrivedAt" IS NULL)
    AND ("status" NOT IN ('INSPECTING', 'AWAITING_RETURN', 'COMPLETED') OR "arrivedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "factory_pallet_shipment_cancel_shape" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL
      AND char_length(btrim("cancelReason", E' \t\r\n')) > 0 AND char_length("cancelReason") <= 1000)
    OR ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL AND "cancelReason" IS NULL)
  );

ALTER TABLE "FactoryPalletInspection"
  ADD CONSTRAINT "factory_pallet_inspection_required_text" CHECK (
    char_length(btrim("receiverName", E' \t\r\n')) > 0 AND char_length("receiverName") <= 150
    AND char_length(btrim("requestKey", E' \t\r\n')) > 0
    AND char_length(btrim("requestHash", E' \t\r\n')) > 0
  ),
  ADD CONSTRAINT "factory_pallet_inspection_notes" CHECK (
    ("documentRef" IS NULL OR char_length("documentRef") <= 150)
    AND ("note" IS NULL OR char_length("note") <= 1000)
    AND ("rejectionReason" IS NULL OR char_length("rejectionReason") <= 1000)
  ),
  ADD CONSTRAINT "factory_pallet_inspection_rejection_shape" CHECK (
    "rejectedQty" >= 0 AND ("rejectedQty" = 0 OR ("rejectionReason" IS NOT NULL
      AND char_length(btrim("rejectionReason", E' \t\r\n')) > 0))
  ),
  ADD CONSTRAINT "factory_pallet_inspection_void_shape" CHECK (
    ("voidedAt" IS NULL AND "voidReason" IS NULL)
    OR ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL
      AND char_length(btrim("voidReason", E' \t\r\n')) > 0 AND char_length("voidReason") <= 1000)
  );

ALTER TABLE "FactoryPalletAcceptanceLine"
  ADD CONSTRAINT "factory_pallet_acceptance_line_qty" CHECK ("qty" > 0),
  ADD CONSTRAINT "factory_pallet_acceptance_line_condition" CHECK (
    char_length(btrim("condition", E' \t\r\n')) > 0 AND char_length("condition") <= 200
  ),
  ADD CONSTRAINT "factory_pallet_acceptance_line_amount" CHECK (
    "unitPrice" >= 0 AND "unitPrice" <= 999999999999.99
    AND "amount" >= 0 AND "amount" = ROUND("qty"::numeric * "unitPrice", 2)
  );

ALTER TABLE "FactoryPalletWarehouseReturn"
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT,
  ADD CONSTRAINT "factory_pallet_warehouse_return_void_shape" CHECK (
    ("voidedAt" IS NULL AND "voidReason" IS NULL)
    OR ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL
      AND char_length(btrim("voidReason", E' \t\r\n')) > 0 AND char_length("voidReason") <= 1000)
  ),
  ADD CONSTRAINT "factory_pallet_warehouse_return_qty" CHECK ("qty" > 0),
  ADD CONSTRAINT "factory_pallet_warehouse_return_text" CHECK (
    char_length(btrim("note", E' \t\r\n')) > 0 AND char_length("note") <= 1000
    AND char_length(btrim("requestKey", E' \t\r\n')) > 0
    AND char_length(btrim("requestHash", E' \t\r\n')) > 0
  );
