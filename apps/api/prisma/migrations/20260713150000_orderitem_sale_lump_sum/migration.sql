-- Negotiated FIXED sale total per item. When set, the sale does NOT scale with the
-- actual delivered quantity on reconcile (kelishilgan qat'iy summa). NULL = per-m³.
ALTER TABLE "OrderItem" ADD COLUMN "saleLumpSum" DECIMAL(18,2);
