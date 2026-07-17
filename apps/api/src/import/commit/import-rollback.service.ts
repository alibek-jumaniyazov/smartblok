import { OrderStatus, PalletTransactionType, PrismaClient, Prisma, ImportBatchStatus } from '@prisma/client';

const D = Prisma.Decimal;

export interface RollbackResult {
  reversedLedger: number;
  reversedPallets: number;
  voidedPayments: number;
  cancelledOrders: number;
  ledgerSum: string; // MUST be "0.00"
  palletSum: number; // MUST be 0
}

/**
 * Undo a committed import by COMPENSATION — nothing is deleted (onDelete: Restrict
 * everywhere). Every LedgerEntry gets a negating reversal (linked via reversalOfId,
 * carrying the same importBatchId), pallets get REVERSAL rows, payments are voided,
 * orders cancelled. The proof: Σ(LedgerEntry WHERE importBatchId) = 0.
 *
 * Refuses if the owner did real work on top (a non-import payment allocated to an
 * import order, or a client pallet return against one) — there is no safe force.
 */
export async function runRollback(prisma: PrismaClient, batchId: string, createdById?: string | null): Promise<RollbackResult> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status !== ImportBatchStatus.COMMITTED) {
      throw new Error('Faqat yuborilgan (COMMITTED) importni orqaga qaytarish mumkin');
    }

    const orderIds = (await tx.order.findMany({ where: { importBatchId: batchId }, select: { id: true } })).map((o) => o.id);

    // safety: a non-import payment allocated to an import order, or a client pallet
    // return against one, means real downstream work — refuse.
    if (orderIds.length) {
      const foreignAlloc = await tx.paymentAllocation.count({ where: { orderId: { in: orderIds }, voidedAt: null, payment: { importBatchId: { not: batchId } } } });
      if (foreignAlloc > 0) throw new Error('Bu importga tashqi to‘lov bog‘langan — orqaga qaytarib bo‘lmaydi');
      const foreignReturn = await tx.palletTransaction.count({ where: { orderId: { in: orderIds }, type: PalletTransactionType.RETURNED_BY_CLIENT } });
      if (foreignReturn > 0) throw new Error('Bu importga poddon qaytishi yozilgan — orqaga qaytarib bo‘lmaydi');
    }

    // reverse ledger (negated, reversalOf, same importBatchId — needs LedgerService.reverse-style copy)
    const entries = await tx.ledgerEntry.findMany({ where: { importBatchId: batchId, reversalOfId: null } });
    let reversedLedger = 0;
    for (const e of entries) {
      if (await tx.ledgerEntry.findUnique({ where: { reversalOfId: e.id } })) continue;
      await tx.ledgerEntry.create({
        data: {
          date: e.date, account: e.account, source: e.source, amount: e.amount.negated(),
          clientId: e.clientId, factoryId: e.factoryId, vehicleId: e.vehicleId, orderId: e.orderId, paymentId: e.paymentId,
          importBatchId: batchId, reversalOfId: e.id, note: 'import rollback', createdById: createdById ?? null,
        },
      });
      reversedLedger++;
    }

    // reverse the batch's pallet movements. A REVERSAL row's qty is a SIGNED balance
    // delta, so it must negate the ORIGINAL row's balance effect: DELIVERED/RECEIVED
    // add +qty to their side → reversal −qty; RETURNED_BY_CLIENT subtracts from the
    // client (in-kind return from «Возврат паддон») → reversal +qty.
    const pallets = await tx.palletTransaction.findMany({
      where: {
        importBatchId: batchId, reversalOfId: null,
        type: { in: [PalletTransactionType.RECEIVED_FROM_FACTORY, PalletTransactionType.DELIVERED_TO_CLIENT, PalletTransactionType.RETURNED_BY_CLIENT] },
      },
    });
    let reversedPallets = 0;
    for (const pt of pallets) {
      if (await tx.palletTransaction.findUnique({ where: { reversalOfId: pt.id } })) continue;
      const reversalQty = pt.type === PalletTransactionType.RETURNED_BY_CLIENT ? pt.qty : -pt.qty;
      await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.REVERSAL, qty: reversalQty, clientId: pt.clientId, factoryId: pt.factoryId, orderId: pt.orderId,
          date: pt.date, importBatchId: batchId, reversalOfId: pt.id, createdById: createdById ?? null,
        },
      });
      reversedPallets++;
    }

    const voided = await tx.payment.updateMany({ where: { importBatchId: batchId, voidedAt: null }, data: { voidedAt: new Date(), voidReason: 'import rollback' } });
    const cancelled = await tx.order.updateMany({ where: { importBatchId: batchId, status: { not: OrderStatus.CANCELLED } }, data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: 'import rollback' } });
    await tx.importFingerprint.deleteMany({ where: { batchId } });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: ImportBatchStatus.ROLLED_BACK, rolledBackAt: new Date() } });

    // PROOF: the whole batch nets to zero
    const led = await tx.ledgerEntry.aggregate({ where: { importBatchId: batchId }, _sum: { amount: true } });
    const ledgerSum = (led._sum.amount ?? new D(0)).toFixed(2);
    if (!new D(ledgerSum).isZero()) throw new Error(`Rollback nolga tushmadi (ledger): ${ledgerSum}`);
    // pallet proof is BALANCE-semantic (same signs the balance calculators use), not a
    // raw Σqty — a RETURNED_BY_CLIENT (+qty stored, −qty effect) and its +qty REVERSAL
    // cancel in balance terms while their raw sum would be 2×qty.
    const allPallets = await tx.palletTransaction.findMany({ where: { importBatchId: batchId }, select: { type: true, qty: true } });
    const balanceDelta = (t: PalletTransactionType, q: number): number =>
      t === PalletTransactionType.RECEIVED_FROM_FACTORY || t === PalletTransactionType.DELIVERED_TO_CLIENT ? q
      : t === PalletTransactionType.RETURNED_BY_CLIENT || t === PalletTransactionType.RETURNED_TO_FACTORY || t === PalletTransactionType.CHARGED_LOST ? -q
      : q; // ADJUSTMENT / REVERSAL are already signed
    const palletSum = allPallets.reduce((a, p) => a + balanceDelta(p.type, p.qty), 0);
    if (palletSum !== 0) throw new Error(`Rollback nolga tushmadi (poddon): ${palletSum}`);

    return { reversedLedger, reversedPallets, voidedPayments: voided.count, cancelledOrders: cancelled.count, ledgerSum, palletSum };
  }, { timeout: 180_000 });
}
