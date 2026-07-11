// Landed cost per m³ (Клиентгача), v3 — all math in Prisma.Decimal:
//   landed = factoryPricePerM3 + costPerTruck / (capacityPallets × m3PerPallet)
// The factory price is the CURRENT FACTORY_BANK book price; the truck volume is
// derived from the route's pallet capacity and the product's per-pallet volume.
import { Prisma } from '@prisma/client';
import { D, round2 } from '../common/money';

export function landedCostPerM3(
  factoryPricePerM3: Prisma.Decimal.Value,
  costPerTruck: Prisma.Decimal.Value,
  capacityPallets: number,
  m3PerPallet: Prisma.Decimal.Value,
): Prisma.Decimal {
  const truckM3 = D(m3PerPallet).times(capacityPallets);
  if (truckM3.lessThanOrEqualTo(0)) return round2(factoryPricePerM3);
  return round2(D(factoryPricePerM3).plus(D(costPerTruck).dividedBy(truckM3)));
}
