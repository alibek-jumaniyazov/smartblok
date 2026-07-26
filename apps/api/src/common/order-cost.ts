import { OrderStatus } from '@prisma/client';

/**
 * Statuses at/after which the dealer→factory cost has been posted to the ledger
 * (postOrderSupplyLedger fires when the truck leaves the factory, i.e. entering LOADING).
 * Before that the order carries no factory debt, however large its costTotal looks.
 *
 * Shared because THREE surfaces must agree on «is there a factory debt on this order»:
 * the order card (orders.service orderSettlement), the allocation workbench, and the
 * Qarzlar → Zavodlar → Buyurtmalar board (debts.service factoryOrderDebts). A private
 * copy in each would drift the day a status is added, and the board would then either
 * invent debt on an unloaded truck or hide a real one.
 */
export const COST_POSTED_STATUSES: OrderStatus[] = [
  OrderStatus.LOADING,
  OrderStatus.DELIVERING,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];
