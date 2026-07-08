// Landed cost per m3 (Клиентгача) — matches the factory-comparison sheet exactly:
//   landed = factoryPricePerM3 + logisticsCostPerTruck / truckCapacityM3
// The dealer bonus is a SEPARATE rebate (it does NOT change the displayed landed cost),
// so we expose the post-bonus net cost separately for true-margin analysis.
export function landedCostPerM3(
  pricePerM3: number,
  costPerTruck: number,
  truckCapacityM3: number,
): number {
  if (!truckCapacityM3 || truckCapacityM3 <= 0) return pricePerM3;
  return pricePerM3 + costPerTruck / truckCapacityM3;
}

export function netCostAfterBonus(landed: number, dealerBonusPct = 0): number {
  return landed * (1 - (dealerBonusPct || 0));
}
