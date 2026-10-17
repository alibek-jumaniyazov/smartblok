import { Prisma } from '@prisma/client';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
export interface ShipmentOverview {
  inTransit: number;
  awaitingInspection: number;
  rejectedAtFactory: number;
  outsideWarehouse: number;
}
export const EMPTY_SHIPMENT_OVERVIEW: ShipmentOverview = {
  inTransit: 0, awaitingInspection: 0, rejectedAtFactory: 0, outsideWarehouse: 0,
};

/**
 * Outstanding custody away from our warehouse. A factory acceptance already
 * subtracts from the pallet ledger, so reducing this reservation at the same time
 * prevents a second warehouse deduction. Voids correct the original business day.
 */
export const shipmentStockReservationsSql = Prisma.sql`
  SELECT s."factoryId", s."dispatchedAt" AS date, s.qty AS delta
    FROM "FactoryPalletShipment" s WHERE s."cancelledAt" IS NULL
  UNION ALL
  SELECT s."factoryId", i.date, -l.qty AS delta
    FROM "FactoryPalletAcceptanceLine" l
    JOIN "FactoryPalletInspection" i ON i.id = l."inspectionId"
    JOIN "FactoryPalletShipment" s ON s.id = i."shipmentId"
    WHERE s."cancelledAt" IS NULL AND i."voidedAt" IS NULL
  UNION ALL
  SELECT s."factoryId", r.date, -r.qty AS delta
    FROM "FactoryPalletWarehouseReturn" r
    JOIN "FactoryPalletShipment" s ON s.id = r."shipmentId"
    WHERE s."cancelledAt" IS NULL AND r."voidedAt" IS NULL`;

export async function outstandingFactoryShipments(db: Reader, factoryId?: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<Array<{ factoryId: string; qty: bigint }>>(Prisma.sql`
    WITH movements AS (${shipmentStockReservationsSql})
    SELECT "factoryId", SUM(delta)::bigint AS qty FROM movements
    ${factoryId ? Prisma.sql`WHERE "factoryId" = ${factoryId}` : Prisma.empty}
    GROUP BY "factoryId"`);
  return new Map(rows.map(row => [row.factoryId, Number(row.qty)]));
}

export async function shipmentOverview(db: Reader, factoryId?: string): Promise<ShipmentOverview> {
  const rows = await db.$queryRaw<Array<{ inTransit: bigint; awaitingInspection: bigint; rejectedAtFactory: bigint; outsideWarehouse: bigint }>>(Prisma.sql`
    WITH counts AS (
      SELECT s.qty, s."arrivedAt",
        COALESCE((SELECT SUM(l.qty) FROM "FactoryPalletInspection" i
          JOIN "FactoryPalletAcceptanceLine" l ON l."inspectionId" = i.id
          WHERE i."shipmentId" = s.id AND i."voidedAt" IS NULL), 0) AS accepted,
        COALESCE((SELECT SUM(i."rejectedQty") FROM "FactoryPalletInspection" i
          WHERE i."shipmentId" = s.id AND i."voidedAt" IS NULL), 0) AS rejected,
        COALESCE((SELECT SUM(r.qty) FROM "FactoryPalletWarehouseReturn" r
          WHERE r."shipmentId" = s.id AND r."voidedAt" IS NULL), 0) AS returned
      FROM "FactoryPalletShipment" s WHERE s."cancelledAt" IS NULL
        ${factoryId ? Prisma.sql`AND s."factoryId" = ${factoryId}` : Prisma.empty}
    )
    SELECT COALESCE(SUM(CASE WHEN "arrivedAt" IS NULL THEN qty - accepted - returned ELSE 0 END), 0)::bigint AS "inTransit",
      COALESCE(SUM(CASE WHEN "arrivedAt" IS NOT NULL THEN qty - accepted - rejected ELSE 0 END), 0)::bigint AS "awaitingInspection",
      COALESCE(SUM(rejected - returned), 0)::bigint AS "rejectedAtFactory",
      COALESCE(SUM(qty - accepted - returned), 0)::bigint AS "outsideWarehouse"
    FROM counts`);
  const row = rows[0];
  return row ? {
    inTransit: Number(row.inTransit), awaitingInspection: Number(row.awaitingInspection),
    rejectedAtFactory: Number(row.rejectedAtFactory), outsideWarehouse: Number(row.outsideWarehouse),
  } : { ...EMPTY_SHIPMENT_OVERVIEW };
}
