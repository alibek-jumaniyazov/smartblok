import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LedgerAccount, PaymentKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { assertOwnAgent, RequestUser } from '../common/scoping';
import { currentPalletPrice, dualDebt } from '../common/pallet-debt';
import { ZERO } from '../common/money';
import { EMPTY_PALLET_STATS, foldPalletStats, palletStatsSql, PalletStatsRow } from '../pallets/pallet-stats';
import { buildClientWorkbook } from './client-export.xlsx';

const CLIENT_PAYMENT_KINDS = [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND, PaymentKind.TRANSPORT_DIRECT];

/** Full client history is loaded independently of the company export and UI pagination. */
async function readClientSnapshot(tx: Prisma.TransactionClient, clientId: string, user: RequestUser, ledger: LedgerService) {
  const client = await tx.client.findUnique({ where: { id: clientId }, select: {
    id: true, name: true, legalEntity: true, phone: true, agentId: true, active: true,
    paymentTermDays: true, creditLimit: true, createdAt: true, updatedAt: true,
    agent: { select: { name: true } }, region: { select: { name: true } },
    aliases: { select: { name: true }, orderBy: { name: 'asc' } },
  } });
  if (!client) throw new NotFoundException('Mijoz topilmadi');
  assertOwnAgent(user, client.agentId);
  const office = user.role !== 'AGENT';
  const [orders, payments, pallets, entries, allocations, statuses, comments, prices, documents, balance, palletPrice, palletGroups] = await Promise.all([
    tx.order.findMany({ where: { clientId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: {
      id: true, orderNo: true, date: true, status: true, dueDate: true, saleTotal: true,
      transportMode: true, transportCost: true, transportCharge: true, transportPaidStatus: true,
      transportPaidAt: true, driverName: true, cancelMoneyMode: true,
      note: true, cancelReason: true, cancelledAt: true, completedAt: true, loadedAt: true,
      createdAt: true, updatedAt: true,
      costTotal: office, costStatus: office,
      agent: { select: { name: true } }, factory: { select: { name: true } },
      vehicle: { select: { name: true, plate: true } },
      items: { orderBy: { id: 'asc' }, select: {
        id: true, quantityM3: true, actualQuantityM3: true, palletCount: true, actualPalletCount: true,
        salePricePerM3: true, saleTotal: true, saleLumpSum: true, listPricePerM3: true, pricePending: true,
        costPricePerM3: office, finalCostPricePerM3: office, costTotal: office,
        product: { select: { name: true, size: true } },
      } },
    } }),
    tx.payment.findMany({ where: { clientId, kind: { in: CLIENT_PAYMENT_KINDS } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, date: true, kind: true, method: true, amount: true, usdAmount: true, rate: true,
        payerName: true, receiverName: true, note: true, voidedAt: true, voidReason: true,
        reconciled: true, createdAt: true, updatedAt: true,
        // Whether cash moved is useful, but no cashbox balances or global journal leave this scope.
        cashboxId: true, usdCashboxId: true,
        agent: { select: { name: true } },
        payerEntity: { select: { name: true } }, receiverEntity: { select: { name: true } },
      } }),
    tx.palletTransaction.findMany({ where: { clientId }, orderBy: [{ date: 'asc' }, { at: 'asc' }, { id: 'asc' }], select: {
      id: true, date: true, at: true, type: true, qty: true, unitPrice: true, note: true, orderId: true,
      reversalOfId: true, reversalOfType: true,
      reversals: { where: { clientId }, select: { qty: true } },
      reversalOf: { select: { clientId: true, type: true, unitPrice: true } },
    } }),
    tx.ledgerEntry.findMany({ where: { account: LedgerAccount.CLIENT, clientId },
      orderBy: [{ date: 'asc' }, { at: 'asc' }, { id: 'asc' }], select: {
        id: true, date: true, at: true, source: true, amount: true, note: true, orderId: true,
        paymentId: true, palletTransactionId: true, reversalOfId: true,
        reversedBy: { select: { id: true } },
      } }),
    // Both parties are scoped: an order's factory allocation is never a client payment.
    tx.paymentAllocation.findMany({ where: { order: { clientId }, payment: { clientId, kind: { in: CLIENT_PAYMENT_KINDS } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, orderId: true, paymentId: true, amount: true, createdAt: true, voidedAt: true, voidReason: true,
        payment: { select: { date: true, kind: true, method: true, voidedAt: true } },
      } }),
    tx.orderStatusHistory.findMany({ where: { order: { clientId } }, orderBy: [{ at: 'asc' }, { id: 'asc' }], select: {
      orderId: true, from: true, to: true, at: true, note: true, by: { select: { name: true } },
    } }),
    tx.orderComment.findMany({ where: { order: { clientId } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
      orderId: true, text: true, createdAt: true, by: { select: { name: true } },
    } }),
    tx.clientPrice.findMany({ where: { clientId }, orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }], select: {
      id: true, effectiveFrom: true, pricePerM3: true, product: { select: { name: true, size: true } },
    } }),
    tx.document.findMany({ where: { AND: [
      { OR: [{ clientId }, { order: { clientId } }] },
      { OR: [{ clientId: null }, { clientId }] },
      { OR: [{ orderId: null }, { order: { clientId } }] },
    ] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
      id: true, filename: true, mime: true, size: true, createdAt: true, orderId: true,
    } }),
    ledger.clientBalance(clientId, tx),
    currentPalletPrice(tx),
    tx.$queryRaw<PalletStatsRow[]>(palletStatsSql('clientId', [clientId])),
  ]);
  const palletStats = foldPalletStats(palletGroups, 'client', (s) =>
    (s.DELIVERED_TO_CLIENT ?? 0) - (s.RETURNED_BY_CLIENT ?? 0) - (s.CHARGED_LOST ?? 0)
      + (s.ADJUSTMENT ?? 0) + (s.REVERSAL ?? 0)).get(clientId) ?? { ...EMPTY_PALLET_STATS };
  let running = ZERO;
  const statement = entries.map((entry) => { running = running.plus(entry.amount); return { ...entry, running }; });
  // Catch missing or filtered ledger rows instead of exporting a plausible but incomplete statement.
  if (!running.eq(balance)) throw new Error('Mijoz hisoboti qoldig‘i hisob daftari bilan mos kelmadi');
  return { client, office, orders, payments, pallets, statement, allocations, statuses, comments, prices, documents,
    palletStats, debt: dualDebt(balance, palletStats.balance, palletPrice), generatedAt: new Date() };
}

export type ClientExportSnapshot = Awaited<ReturnType<typeof readClientSnapshot>>;

@Injectable()
export class ClientExportService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async buildWorkbook(clientId: string, user: RequestUser): Promise<{ buffer: Buffer; filename: string }> {
    if (!['ADMIN', 'ACCOUNTANT', 'AGENT'].includes(user.role)) throw new ForbiddenException('Mijoz eksportiga ruxsat yo‘q');
    const snapshot = await this.prisma.$transaction(
      (tx) => readClientSnapshot(tx, clientId, user, new LedgerService(this.prisma)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 },
    );
    const buffer = await buildClientWorkbook(snapshot, user);
    const name = snapshot.client.name.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Mijoz';
    const filename = `SmartBlok — ${name} — toliq hisob.xlsx`;
    await this.audit.log({ userId: user.userId, action: AuditAction.EXPORT, entity: 'Client', entityId: clientId,
      after: { orders: snapshot.orders.length, payments: snapshot.payments.length, ledger: snapshot.statement.length,
        pallets: snapshot.pallets.length, role: user.role }, note: 'Mijozning to‘liq Excel hisoboti' });
    return { buffer, filename };
  }
}
