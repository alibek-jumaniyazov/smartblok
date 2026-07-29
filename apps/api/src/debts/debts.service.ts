import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FactoryPayIntent, LedgerAccount, PaymentKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PalletService } from '../pallets/pallets.service';
import { CLIENT_SETTLING_KINDS } from '../common/auto-allocate';
import { LedgerService } from '../common/ledger.service';
import { D, isSettled, round2, ZERO } from '../common/money';
import { COST_POSTED_STATUSES } from '../common/order-cost';
import { NOT_CANCELLED } from '../common/order-scope';
import { clientChargeable } from '../common/transport';
import { pageArgs, paged } from '../common/pagination';
import { agentScope, assertOwnAgent, RequestUser } from '../common/scoping';
import { DebtClientsQueryDto, FactoryOrderDebtsQueryDto, StatementQueryDto } from './dto';

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
    private pallets: PalletService,
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

  /** Σ of the positive side of a pallet-count map (who still holds OUR pallets / whose we hold). */
  private static sumPositive(counts: Map<string, number>): number {
    let total = 0;
    for (const qty of counts.values()) if (qty > 0) total += qty;
    return total;
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
      where: { clientId: { in: clientIds }, ...NOT_CANCELLED, dueDate: { lt: now } },
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

  /**
   * Every order that still owes the factory money, WITH the channel the
   * dealer means to pay it through (owner rule, 2026-07-26: «zavodlarga qarzimiz naqd
   * usulda / o'tkazmada» + «to'lov usuli aniq bo'lmagan buyurtmalar»).
   *
   * The open figure is `costTotal − Σ active FACTORY_OUT allocations`, gated on the cost
   * being ON the ledger (COST_POSTED_STATUSES) — byte-identical to the order card's
   * `factoryOutstanding`, so a row here and the order it opens can never disagree.
   *
   * It is deliberately NOT `factoryCoverage.remaining[channel]`: coverage re-reads the
   * price book per item (two lookups × N items × N orders) and, because coverage anchors
   * to the order's OWN `costPricePerM3`, the anchored channel's remainder IS this number.
   * The other channel's hypothetical price is an order-card question, not a list question.
   *
   * CANCELLED can never appear: it is not in COST_POSTED_STATUSES.
   */
  private async factoryOrderDebts(where: Prisma.OrderWhereInput = {}) {
    // `status` LAST — a caller's filter may narrow the set, never widen it into orders
    // whose cost is not on the ledger yet (there is no factory debt to show on those).
    const orderWhere: Prisma.OrderWhereInput = { ...where, status: { in: COST_POSTED_STATUSES } };
    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderNo: true,
        date: true,
        status: true,
        costStatus: true,
        costTotal: true,
        factoryPayIntent: true,
        factory: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    });
    if (orders.length === 0) return [];

    const allocs = await this.prisma.paymentAllocation.groupBy({
      by: ['orderId'],
      where: {
        voidedAt: null,
        payment: { voidedAt: null, kind: PaymentKind.FACTORY_OUT },
        // The SAME order predicate rather than `orderId: { in: [...] }`. The id list is
        // unbounded (every posted order ever) and would eventually blow past the driver's
        // bind-parameter ceiling — a failure that would arrive as a mystery 500 on the
        // exact day the business got big enough to need this board most.
        order: orderWhere,
      },
      _sum: { amount: true },
    });
    const paidMap = new Map(allocs.map((a) => [a.orderId, D(a._sum.amount ?? 0)]));

    return orders
      .map((o) => {
        const factoryPaid = paidMap.get(o.id) ?? ZERO;
        const raw = round2(D(o.costTotal).minus(factoryPaid));
        return { ...o, factoryPaid, open: raw.lessThan(0) ? ZERO : raw };
      })
      // under 1 so'm left is float residue from back-solved prices — that order is settled
      .filter((r) => !isSettled(r.open));
  }

  /** Σ open order debt per pay-intent — the three figures the Qarzlar cards read. */
  private static splitByIntent(rows: { factoryPayIntent: FactoryPayIntent; open: Prisma.Decimal }[]) {
    const by: Record<FactoryPayIntent, Prisma.Decimal> = {
      [FactoryPayIntent.CASH]: ZERO,
      [FactoryPayIntent.BANK]: ZERO,
      [FactoryPayIntent.UNKNOWN]: ZERO,
    };
    let total = ZERO;
    for (const r of rows) {
      by[r.factoryPayIntent] = by[r.factoryPayIntent].plus(r.open);
      total = total.plus(r.open);
    }
    return { by, total };
  }

  /**
   * «Shu kesimda zavodga qancha qarzimiz qoldi» — the board above, opened to other modules.
   *
   * The factory report needs the OPEN factory debt of one period's orders. It deliberately
   * asks here instead of writing `costTotal − Σ allocations` again: that expression has
   * three quiet conditions attached to it (cost must be ON the ledger, a negative remainder
   * clamps to zero, and under one so'm counts as settled). A second copy would agree today
   * and drift the first time one of them moved — and the drift would look like a data
   * problem, not a code one.
   *
   * `where` is intersected, never widened: COST_POSTED_STATUSES stays the last word.
   */
  async factoryOrderDebtBoard(where: Prisma.OrderWhereInput = {}) {
    const rows = await this.factoryOrderDebts(where);
    const { by, total } = DebtsService.splitByIntent(rows);
    return { rows, count: rows.length, total, byIntent: by };
  }

  async summary() {
    // Company-wide rollup — the SAME figures the dashboard tiles show, so off-book
    // «balansni nazorat qilish» corrections must be excluded here too (they move only the
    // per-party balance + its statement, not the company totals). Owner rule, 2026-07-22.
    const [clientBalances, factoryBuckets, vehicleBalances, clientPallets, factoryPallets, orderDebts] =
      await Promise.all([
        this.ledger.clientBalances(undefined, { includeOffBook: false }),
        this.ledger.factoryBucketsMap({ includeOffBook: false }),
        this.ledger.vehicleBalances({ includeOffBook: false }),
        this.pallets.clientPalletBalances(),
        this.pallets.factoryPalletBalances(),
        this.factoryOrderDebts(),
      ]);
    const clients = this.splitBalances(clientBalances);
    const vehicles = this.splitBalances(vehicleBalances);

    // Factory side is NOT netted (owner's rule, 2026-07-21). These two figures used to be
    // the positive/negative halves of ONE balance per factory: a factory we owed 10M at
    // and held 4M of advance with showed up as 6M of debt and 0 advance — exactly the
    // auto-netting the owner banned. Debt now comes from the PAYABLE bucket alone and
    // advance from the two ADVANCE_* buckets; money crosses over only when someone
    // presses «avansdan yechish» (which posts the ADVANCE_DRAW pair).
    let factoryPayableOpen = ZERO;
    let factoryAdvanceCash = ZERO;
    let factoryAdvanceBank = ZERO;
    let weOweFactories = ZERO;
    for (const b of factoryBuckets.values()) {
      if (!isSettled(b.payable) && b.payable.lessThan(0)) {
        factoryPayableOpen = factoryPayableOpen.plus(b.payable.abs());
      }
      factoryAdvanceCash = factoryAdvanceCash.plus(b.advanceCash);
      factoryAdvanceBank = factoryAdvanceBank.plus(b.advanceBank);
      // `weOweFactories` keeps its ORIGINAL meaning — the NET still owed after applying
      // everything parked at that factory. The owner reads this number on every report he
      // already has, so re-pointing it at the gross payable would silently restate his
      // books (78M would read as 340M). The gross and the advance sit beside it instead,
      // which is what he actually asked to see: nothing is hidden, nothing is auto-spent.
      if (!isSettled(b.net) && b.net.lessThan(0)) weOweFactories = weOweFactories.plus(b.net.abs());
    }

    // Kanal bo'yicha bo'linish (egasi qoidasi, 2026-07-26). The split is driven by the
    // ORDER's `factoryPayIntent` — the dealer's decision about how this truck will be paid
    // for — because that decision is also what fixes the order's cost basis. UNKNOWN gets
    // no card of its own: it stays inside «Zavodlarga qarzimiz», which is the whole point
    // of the owner's ask («to'lov usuli aniq bo'lmagan buyurtmalar o'zida chiqib turadi»).
    const intents = DebtsService.splitByIntent(orderDebts);

    return {
      clientsOweUs: clients.positive,
      weOweClients: clients.negative, // prepayments held
      factoryAdvance: factoryAdvanceCash.plus(factoryAdvanceBank),
      factoryAdvanceCash,
      factoryAdvanceBank,
      /** GROSS open goods debt, before any advance is applied to it */
      factoryPayableOpen,
      /** NET still owed once the parked advance is counted (the legacy figure) */
      weOweFactories,
      /** Σ of the order board = the three intents below; the card and its drill-down agree */
      factoryPayableOrders: intents.total,
      factoryPayableCash: intents.by[FactoryPayIntent.CASH],
      factoryPayableBank: intents.by[FactoryPayIntent.BANK],
      factoryPayableUnknown: intents.by[FactoryPayIntent.UNKNOWN],
      /** open orders carrying factory debt — the board's row count */
      factoryOpenOrders: orderDebts.length,
      /**
       * Ledger payable MINUS what the open orders account for. Normally 0. It is non-zero
       * only for money that sits on the PAYABLE bucket without an open order behind it
       * (a bonus offset, an overpayment the factory owes back, an imported adjustment), so
       * it is REPORTED rather than quietly folded into one of the three channels.
       */
      factoryPayableUnlinked: round2(factoryPayableOpen.minus(intents.total)),
      weOweVehicles: vehicles.negative,
      // R4: pallets are owed in KIND on BOTH sides — counts, never money.
      palletsAtClients: DebtsService.sumPositive(clientPallets),
      palletsOwedToFactories: DebtsService.sumPositive(factoryPallets),
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
      this.pallets.clientPalletBalances(ids),
      this.overdueByClient(ids, now),
      this.prisma.order.findMany({
        where: { clientId: { in: ids }, ...NOT_CANCELLED, dueDate: { gte: now, lte: horizon } },
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
        const palletBalance = palletMap.get(c.id) ?? 0;
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          agent: c.agent,
          region: c.region,
          paymentTermDays: c.paymentTermDays,
          creditLimit: c.creditLimit,
          balance,
          palletBalance,
          /** owes nothing in money, still holds our pallets — in-kind debt only (R4) */
          palletOnly: isSettled(balance) && palletBalance > 0,
          hasOverdueOrders: !!overdue,
          overdueOrdersCount: overdue?.count ?? 0,
          overdueOrdersTotal: overdue?.total ?? ZERO,
          dueWithinWindow: upcoming.has(c.id),
        };
      })
      // Debts board is for collecting debt: DEFAULT lists clients who OWE us — in MONEY
      // (balance > 0) or, under R4, in PALLETS alone. A client who paid every soʼm but
      // still sits on 40 of our pallets used to vanish from the board entirely (the row
      // was filtered on the money balance), so nobody ever went to collect them.
      // 'avans' stays money-only: it lists clients in credit (balance < 0), and pallets
      // held are a debt to us, not a prepayment.
      .filter((r) => {
        if (q.dir === 'avans') return !isSettled(r.balance) && r.balance.lessThan(0);
        return (!isSettled(r.balance) && r.balance.greaterThan(0)) || r.palletOnly;
      })
      // worst-first by money; pallet-only rows carry ~0 and land under the money debtors,
      // above nobody — they are the tail of the collection queue, not hidden from it.
      .sort((a, b) => b.balance.comparedTo(a.balance));

    const { skip, take, page, pageSize } = pageArgs(q);
    return {
      ...paged(rows.slice(skip, skip + take), rows.length, page, pageSize),
      days,
      expectedCollections,
    };
  }

  /**
   * Qarzlar → Zavodlar → «Buyurtmalar» doskasi: HAR BIR ochiq zavod qarzi bitta qator
   * (egasi qoidasi, 2026-07-26 — «hamma qarz bo'lingan buyurtmalar aniq qilib chiqishi
   * kerak»). Zavod darajasidagi bitta yig'indi qaysi buyurtma to'lanmaganini yashirardi.
   *
   * TOTALS COME FROM THE SERVER, not from the page (owner rule, [[totals-above-table]]):
   * this list is server-paginated, so a strip summed over the loaded 50 rows would print a
   * smaller number than the card above it and both would look authoritative.
   *
   * Two scopes, both stated explicitly to the UI so the strip can label itself:
   *   • `totals`   — search / factory scope, ALL intents (the strip above the table);
   *   • `filtered` — the same PLUS the intent chip (what the table actually lists).
   * Mixing the two inside one strip is exactly the trap `SummaryStrip` was built to avoid.
   */
  async factoryOrders(q: FactoryOrderDebtsQueryDto) {
    const rows = await this.factoryOrderDebts(q.factoryId ? { factoryId: q.factoryId } : {});

    const search = q.search?.trim().toLowerCase();
    const scoped = search
      ? rows.filter((r) =>
          [r.orderNo, r.client.name, r.factory.name].some((f) => f.toLowerCase().includes(search)),
        )
      : rows;

    const intents = DebtsService.splitByIntent(scoped);
    const listed = q.intent ? scoped.filter((r) => r.factoryPayIntent === q.intent) : scoped;

    // worst-first — the same law the rest of this page follows (biggest open debt on top)
    const sorted = listed
      .slice()
      .sort((a, b) => b.open.comparedTo(a.open) || a.date.getTime() - b.date.getTime());

    const { skip, take, page, pageSize } = pageArgs(q);
    return {
      ...paged(sorted.slice(skip, skip + take), sorted.length, page, pageSize),
      /** ALL intents inside the search/factory scope — the strip's own scope */
      totals: {
        open: intents.total,
        cash: intents.by[FactoryPayIntent.CASH],
        bank: intents.by[FactoryPayIntent.BANK],
        unknown: intents.by[FactoryPayIntent.UNKNOWN],
        count: scoped.length,
      },
      /** what the table below is listing right now (intent chip applied) */
      filtered: {
        open: DebtsService.splitByIntent(listed).total,
        count: listed.length,
      },
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
