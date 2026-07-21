import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerAccount, OrderStatus, PalletTransactionType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CLIENT_SETTLING_KINDS } from '../common/auto-allocate';
import { LedgerService } from '../common/ledger.service';
import { D, isSettled, round2, ZERO } from '../common/money';
import { clientChargeable } from '../common/transport';
import { pageArgs, paged } from '../common/pagination';
import { agentScope, assertOwnAgent, RequestUser } from '../common/scoping';
import { DebtClientsQueryDto, StatementQueryDto } from './dto';

/** Date-only strings are inclusive through the whole day. */
const dayEnd = (s: string): Date => {
  const d = new Date(s);
  if (!s.includes('T')) d.setTime(d.getTime() + 86_400_000 - 1);
  return d;
};

/**
 * Read-only aggregation over the immutable ledger (LedgerEntry is the single
 * source of truth for balances — the v2 order/payment recomputation is gone).
 * Sign convention: >0 ⇒ asset for the dealer, <0 ⇒ dealer owes.
 */
@Injectable()
export class DebtsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  /** Σ positives and Σ |negatives| of a balance map; |balance| < 1 UZS is float residue, treated as settled. */
  private splitBalances(balances: Map<string, Prisma.Decimal>) {
    let positive = ZERO;
    let negative = ZERO;
    for (const balance of balances.values()) {
      if (isSettled(balance)) continue;
      if (balance.greaterThan(0)) positive = positive.plus(balance);
      else negative = negative.plus(balance.abs());
    }
    return { positive, negative };
  }

  /**
   * clientId → pallet balance (units). Formula (schema-canonical):
   * Σ DELIVERED_TO_CLIENT − Σ RETURNED_BY_CLIENT − Σ CHARGED_LOST + Σ signed ADJUSTMENT/REVERSAL.
   */
  private async palletBalancesByClient(): Promise<Map<string, number>> {
    const rows = await this.prisma.palletTransaction.groupBy({
      by: ['clientId', 'type'],
      where: { clientId: { not: null } },
      _sum: { qty: true },
    });
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.clientId) continue;
      const qty = row._sum.qty ?? 0;
      let delta = 0;
      switch (row.type) {
        case PalletTransactionType.DELIVERED_TO_CLIENT:
          delta = qty;
          break;
        case PalletTransactionType.RETURNED_BY_CLIENT:
        case PalletTransactionType.CHARGED_LOST:
          delta = -qty;
          break;
        case PalletTransactionType.ADJUSTMENT:
        case PalletTransactionType.REVERSAL:
          delta = qty; // stored signed
          break;
        default:
          delta = 0; // RECEIVED_FROM_FACTORY / RETURNED_TO_FACTORY are factory-side movements
      }
      map.set(row.clientId, (map.get(row.clientId) ?? 0) + delta);
    }
    return map;
  }

  /**
   * clientId → still-collectable overdue money (non-cancelled orders with dueDate < now).
   *
   * Per order: clientChargeable(order) − Σ active CLIENT-settling allocations, floored at 0 —
   * the SAME formula orders/auto-allocate use. It used to be a raw `_sum: saleTotal` groupBy,
   * which subtracted neither payments nor the CLIENT_PAYS_DRIVER slice, so a fully-paid
   * overdue order still shouted its gross face value at the operator. This figure drives the
   * ClientDetail overdue chip, the Debts board and the one-click collection prefill, so it
   * must be money that can actually be collected.
   *
   * Orders whose outstanding is already 0 do not count as overdue at all (count excludes
   * them), otherwise the chip would read «3 ta muddati oʼtgan — 0 soʼm».
   */
  private async overdueByClient(
    clientIds: string[],
    now: Date,
  ): Promise<Map<string, { total: Prisma.Decimal; count: number }>> {
    const map = new Map<string, { total: Prisma.Decimal; count: number }>();
    if (clientIds.length === 0) return map;

    const orders = await this.prisma.order.findMany({
      where: { clientId: { in: clientIds }, status: { not: OrderStatus.CANCELLED }, dueDate: { lt: now } },
      // transportMode + transportCost are REQUIRED by clientChargeable — Prisma would
      // silently hand it `undefined` if either were dropped from this select.
      select: { id: true, clientId: true, saleTotal: true, transportMode: true, transportCost: true },
    });
    if (orders.length === 0) return map;

    const allocs = await this.prisma.paymentAllocation.groupBy({
      by: ['orderId'],
      where: {
        orderId: { in: orders.map((o) => o.id) },
        voidedAt: null,
        payment: { voidedAt: null, kind: { in: CLIENT_SETTLING_KINDS } },
      },
      _sum: { amount: true },
    });
    const settled = new Map(allocs.map((a) => [a.orderId, D(a._sum.amount ?? 0)]));

    for (const o of orders) {
      const left = round2(clientChargeable(o).minus(settled.get(o.id) ?? ZERO));
      if (left.lessThanOrEqualTo(0)) continue;
      const prev = map.get(o.clientId) ?? { total: ZERO, count: 0 };
      map.set(o.clientId, { total: prev.total.plus(left), count: prev.count + 1 });
    }
    return map;
  }

  async summary() {
    const [clientBalances, factoryBalances, vehicleBalances, palletMap] = await Promise.all([
      this.ledger.clientBalances(),
      this.ledger.factoryBalances(),
      this.ledger.vehicleBalances(),
      this.palletBalancesByClient(),
    ]);
    const clients = this.splitBalances(clientBalances);
    const factories = this.splitBalances(factoryBalances);
    const vehicles = this.splitBalances(vehicleBalances);
    let palletsAtClients = 0;
    for (const qty of palletMap.values()) {
      if (qty > 0) palletsAtClients += qty;
    }
    return {
      clientsOweUs: clients.positive,
      weOweClients: clients.negative, // prepayments held
      factoryAdvance: factories.positive,
      weOweFactories: factories.negative,
      weOweVehicles: vehicles.negative,
      palletsAtClients,
    };
  }

  /** Per-client debt rows sorted by debt desc + expectedCollections over the ?days window. AGENT sees only own clients. */
  async clients(user: RequestUser, q: DebtClientsQueryDto) {
    const days = q.days ?? 7;
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 86_400_000);

    const where: Prisma.ClientWhereInput = {
      ...agentScope(user),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as Prisma.QueryMode } } : {}),
    };
    const clients = await this.prisma.client.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        paymentTermDays: true,
        creditLimit: true,
        agent: { select: { id: true, name: true } },
        region: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    const ids = clients.map((c) => c.id);
    if (ids.length === 0) {
      const { page, pageSize } = pageArgs(q);
      return { ...paged([], 0, page, pageSize), days, expectedCollections: ZERO };
    }

    const [balances, palletMap, overdueMap, upcomingDue] = await Promise.all([
      this.ledger.clientBalances(ids),
      this.palletBalancesByClient(),
      this.overdueByClient(ids, now),
      this.prisma.order.findMany({
        where: { clientId: { in: ids }, status: { not: OrderStatus.CANCELLED }, dueDate: { gte: now, lte: horizon } },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
    ]);
    const upcoming = new Set(upcomingDue.map((r) => r.clientId));

    // expectedCollections: Σ positive balances of clients with a payment term or a dueDate inside the window
    let expectedCollections = ZERO;
    for (const c of clients) {
      const balance = balances.get(c.id) ?? ZERO;
      if (isSettled(balance) || balance.lessThanOrEqualTo(0)) continue;
      if (c.paymentTermDays != null || upcoming.has(c.id)) {
        expectedCollections = expectedCollections.plus(balance);
      }
    }

    const rows = clients
      .map((c) => {
        const balance = balances.get(c.id) ?? ZERO;
        const overdue = overdueMap.get(c.id);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          agent: c.agent,
          region: c.region,
          paymentTermDays: c.paymentTermDays,
          creditLimit: c.creditLimit,
          balance,
          palletBalance: palletMap.get(c.id) ?? 0,
          hasOverdueOrders: !!overdue,
          overdueOrdersCount: overdue?.count ?? 0,
          overdueOrdersTotal: overdue?.total ?? ZERO,
          dueWithinWindow: upcoming.has(c.id),
        };
      })
      // Debts board is for collecting debt: DEFAULT lists only clients who OWE us
      // (balance > 0). 'avans' explicitly lists clients in credit (balance < 0).
      // Settled clients never appear here (pallet-only clients live on the pallets tab).
      .filter((r) => {
        if (isSettled(r.balance)) return false;
        return q.dir === 'avans' ? r.balance.lessThan(0) : r.balance.greaterThan(0);
      })
      .sort((a, b) => b.balance.comparedTo(a.balance));

    const { skip, take, page, pageSize } = pageArgs(q);
    return {
      ...paged(rows.slice(skip, skip + take), rows.length, page, pageSize),
      days,
      expectedCollections,
    };
  }

  /** Ledger statement passthrough with party names. AGENT: own clients only, never FACTORY/VEHICLE. */
  async statement(user: RequestUser, q: StatementQueryDto) {
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? dayEnd(q.to) : undefined;

    let party: { id: string; name: string };
    if (q.account === LedgerAccount.CLIENT) {
      const client = await this.prisma.client.findUnique({
        where: { id: q.partyId },
        select: { id: true, name: true, agentId: true },
      });
      if (!client) throw new NotFoundException('Mijoz topilmadi');
      assertOwnAgent(user, client.agentId);
      party = { id: client.id, name: client.name };
    } else {
      if (user.role === 'AGENT') {
        throw new ForbiddenException("Agent faqat o'z mijozlarining hisobotini ko'ra oladi");
      }
      if (q.account === LedgerAccount.FACTORY) {
        const factory = await this.prisma.factory.findUnique({
          where: { id: q.partyId },
          select: { id: true, name: true },
        });
        if (!factory) throw new NotFoundException('Zavod topilmadi');
        party = factory;
      } else {
        const vehicle = await this.prisma.vehicle.findUnique({
          where: { id: q.partyId },
          select: { id: true, name: true },
        });
        if (!vehicle) throw new NotFoundException('Mashina topilmadi');
        party = vehicle;
      }
    }

    // opening balance before the window so running figures reflect true state
    let openingBalance = ZERO;
    if (from) {
      const partyWhere =
        q.account === LedgerAccount.CLIENT
          ? { clientId: q.partyId }
          : q.account === LedgerAccount.FACTORY
            ? { factoryId: q.partyId }
            : { vehicleId: q.partyId };
      const agg = await this.prisma.ledgerEntry.aggregate({
        where: { account: q.account, ...partyWhere, date: { lt: from } },
        _sum: { amount: true },
      });
      openingBalance = D(agg._sum.amount ?? 0);
    }

    const entries = await this.ledger.statement(q.account, q.partyId, from, to);
    const adjusted = openingBalance.isZero()
      ? entries
      : entries.map((e) => ({ ...e, running: openingBalance.plus(e.running) }));
    const closingBalance = adjusted.length > 0 ? adjusted[adjusted.length - 1].running : openingBalance;

    return {
      account: q.account,
      party,
      from: q.from ?? null,
      to: q.to ?? null,
      openingBalance,
      entries: adjusted,
      closingBalance,
    };
  }
}
