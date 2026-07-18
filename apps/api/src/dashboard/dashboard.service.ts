import { Injectable } from '@nestjs/common';
import {
  CashDirection,
  OrderStatus,
  PalletTransactionType,
  PaymentKind,
  Prisma,
} from '@prisma/client';
import { LedgerService } from '../common/ledger.service';
import { D, round2, round3, sum, ZERO } from '../common/money';
import { RequestUser } from '../common/scoping';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseTashkentFrom,
  parseTashkentTo,
  tashkentDateStr,
  tashkentDayStart,
  tashkentMonthStart,
  tashkentMonthWindow,
  tashkentYearStart,
} from './tashkent-time';

const IN_FLIGHT: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.LOADING, OrderStatus.DELIVERING];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pallet balance formula: Σ DELIVERED − RETURNED − CHARGED_LOST + signed ADJ/REV. */
const PALLET_SIGN: Record<PalletTransactionType, number> = {
  [PalletTransactionType.DELIVERED_TO_CLIENT]: 1,
  [PalletTransactionType.RETURNED_BY_CLIENT]: -1,
  [PalletTransactionType.CHARGED_LOST]: -1,
  [PalletTransactionType.ADJUSTMENT]: 1, // qty is signed
  [PalletTransactionType.REVERSAL]: 1, // qty is signed
  [PalletTransactionType.RECEIVED_FROM_FACTORY]: 0, // factory-side rows never carry clientId
  [PalletTransactionType.RETURNED_TO_FACTORY]: 0,
};

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  private agentOf(user?: RequestUser): string | null {
    return user?.role === 'AGENT' && user.agentId ? user.agentId : null;
  }

  /**
   * All KPI numbers are SQL aggregates (no table loads into JS).
   * AGENT sees the same shape scoped to their own orders/clients; company-wide
   * liabilities (factory/vehicle debts, bonus wallets) are hidden (0) for them.
   */
  async summary(user?: RequestUser, range?: { from?: string; to?: string }) {
    const agentId = this.agentOf(user);
    const now = new Date();
    const dayStart = tashkentDayStart(now);
    const monthStart = tashkentMonthStart(now);
    const yearStart = tashkentYearStart(now);

    // ── period window (Tashkent days): the owner/agent cockpit's date range.
    // Balances stay point-in-time; only flow metrics (sales, profit, collected,
    // volume, orders) are scoped to [periodStart, periodEnd). Default: month→today.
    let periodStart = parseTashkentFrom(range?.from) ?? monthStart;
    let periodEnd = parseTashkentTo(range?.to) ?? (parseTashkentTo(tashkentDateStr(now)) as Date);
    if (periodEnd.getTime() <= periodStart.getTime()) {
      // guard against reversed/degenerate ranges — fall back to a single day
      periodEnd = new Date(periodStart.getTime() + DAY_MS);
    }
    const periodFrom = tashkentDateStr(periodStart);
    const periodTo = tashkentDateStr(new Date(periodEnd.getTime() - DAY_MS));

    const orderScope: Prisma.OrderWhereInput = agentId ? { agentId } : {};
    const notCancelled: Prisma.OrderWhereInput = { status: { not: OrderStatus.CANCELLED }, ...orderScope };
    const paymentScope: Prisma.PaymentWhereInput = agentId ? { client: { agentId } } : {};

    const agentClientIds = agentId
      ? (await this.prisma.client.findMany({ where: { agentId }, select: { id: true } })).map((c) => c.id)
      : undefined;

    const emptyBalances = Promise.resolve(new Map<string, Prisma.Decimal>());
    const noBonus = Promise.resolve(
      [] as Array<{ factoryId: string; _sum: { amount: Prisma.Decimal | null } }>,
    );

    const [
      todayAgg,
      monthAgg,
      yearAgg,
      ordersInFlight,
      clientBalances,
      factoryBalances,
      vehicleBalances,
      collectedAgg,
      bonusGroups,
      palletGroups,
      cubeAgg,
      periodOrderAgg,
      periodCollectedAgg,
      periodCubeAgg,
      allOrderAgg,
      allCubeAgg,
      allCollectedAgg,
      factoryPaidAgg,
      vehiclePaidAgg,
      dateAgg,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...notCancelled, date: { gte: dayStart } },
        _sum: { saleTotal: true },
      }),
      this.prisma.order.aggregate({
        where: { ...notCancelled, date: { gte: monthStart } },
        _sum: { saleTotal: true, costTotal: true, transportCharge: true, transportCost: true },
      }),
      this.prisma.order.aggregate({
        where: { ...notCancelled, date: { gte: yearStart } },
        _sum: { saleTotal: true },
      }),
      this.prisma.order.count({ where: { ...orderScope, status: { in: IN_FLIGHT } } }),
      this.ledger.clientBalances(agentClientIds),
      agentId ? emptyBalances : this.ledger.factoryBalances(),
      agentId ? emptyBalances : this.ledger.vehicleBalances(),
      this.prisma.payment.aggregate({
        where: { kind: PaymentKind.CLIENT_IN, voidedAt: null, date: { gte: monthStart }, ...paymentScope },
        _sum: { amount: true },
      }),
      agentId
        ? noBonus
        : this.prisma.bonusTransaction.groupBy({ by: ['factoryId'], _sum: { amount: true } }),
      this.prisma.palletTransaction.groupBy({
        by: ['type'],
        where: { clientId: { not: null }, ...(agentId ? { client: { agentId } } : {}) },
        _sum: { qty: true },
      }),
      this.prisma.orderItem.aggregate({
        where: { order: { ...notCancelled, date: { gte: monthStart } } },
        _sum: { quantityM3: true },
      }),
      // ── period-scoped flow metrics (drive the date-ranged cockpit) ──
      this.prisma.order.aggregate({
        where: { ...notCancelled, date: { gte: periodStart, lt: periodEnd } },
        _sum: { saleTotal: true, costTotal: true, transportCharge: true, transportCost: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          kind: PaymentKind.CLIENT_IN,
          voidedAt: null,
          date: { gte: periodStart, lt: periodEnd },
          ...paymentScope,
        },
        _sum: { amount: true },
      }),
      this.prisma.orderItem.aggregate({
        where: { order: { ...notCancelled, date: { gte: periodStart, lt: periodEnd } } },
        _sum: { quantityM3: true },
      }),
      // ── all-time reconciliation (Excel proof, NOT date-windowed): the imported
      //    figures the owner cross-checks against the workbook regardless of filter.
      this.prisma.order.aggregate({
        where: notCancelled,
        _sum: { saleTotal: true, costTotal: true, transportCharge: true, transportCost: true },
        _count: true,
      }),
      this.prisma.orderItem.aggregate({
        where: { order: notCancelled },
        _sum: { quantityM3: true },
      }),
      this.prisma.payment.aggregate({
        where: { kind: PaymentKind.CLIENT_IN, voidedAt: null, ...paymentScope },
        _sum: { amount: true },
      }),
      // company-wide outflows (hidden for AGENT — zeroed below, kept as cheap aggregates)
      this.prisma.payment.aggregate({
        where: { kind: PaymentKind.FACTORY_OUT, voidedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { kind: PaymentKind.VEHICLE_OUT, voidedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.order.aggregate({ where: notCancelled, _min: { date: true }, _max: { date: true } }),
    ]);

    // NET receivables (debts minus advances) — the owner's «Ост» semantics: the Excel
    // journal nets client prepayments against debtors, so the dashboard must match it.
    let clientsOweUs = ZERO;
    for (const bal of clientBalances.values()) {
      clientsOweUs = clientsOweUs.plus(bal);
    }
    // Factory/vehicle: <0 ⇒ dealer owes; report the debt as a positive figure.
    let weOweFactories = ZERO;
    for (const bal of factoryBalances.values()) {
      if (bal.lessThan(0)) weOweFactories = weOweFactories.plus(bal.negated());
    }
    let weOweVehicles = ZERO;
    for (const bal of vehicleBalances.values()) {
      if (bal.lessThan(0)) weOweVehicles = weOweVehicles.plus(bal.negated());
    }

    const bonusWallets = sum(bonusGroups.map((g) => g._sum.amount ?? 0));
    const palletsAtClients = palletGroups.reduce(
      (acc, g) => acc + PALLET_SIGN[g.type] * (g._sum.qty ?? 0),
      0,
    );

    const monthSale = D(monthAgg._sum.saleTotal ?? 0);
    const monthCost = D(monthAgg._sum.costTotal ?? 0);

    // ── period figures: net profit = goods profit + transport profit ──
    const periodSale = D(periodOrderAgg._sum.saleTotal ?? 0);
    const periodCost = D(periodOrderAgg._sum.costTotal ?? 0);
    const periodGoodsProfit = periodSale.minus(periodCost);
    const periodTransportProfit = D(periodOrderAgg._sum.transportCharge ?? 0).minus(
      periodOrderAgg._sum.transportCost ?? 0,
    );
    const periodNetProfit = periodGoodsProfit.plus(periodTransportProfit);

    // ── all-time reconciliation: sof foyda = goods profit + transport profit over EVERY
    //    non-cancelled order; kirim = Σ CLIENT_IN, chiqim = Σ FACTORY_OUT + VEHICLE_OUT.
    //    For a workbook import this equals the Excel «Соф фойда»/«Утказилган пул» totals.
    const allSale = D(allOrderAgg._sum.saleTotal ?? 0);
    const allCost = D(allOrderAgg._sum.costTotal ?? 0);
    const allGoodsProfit = allSale.minus(allCost);
    const allTransportCost = D(allOrderAgg._sum.transportCost ?? 0);
    const allTransportProfit = D(allOrderAgg._sum.transportCharge ?? 0).minus(allTransportCost);
    const allNetProfit = allGoodsProfit.plus(allTransportProfit);
    const kirim = D(allCollectedAgg._sum.amount ?? 0);
    const factoryPaidAll = agentId ? ZERO : D(factoryPaidAgg._sum.amount ?? 0);
    const vehiclePaidAll = agentId ? ZERO : D(vehiclePaidAgg._sum.amount ?? 0);
    const chiqim = factoryPaidAll.plus(vehiclePaidAll);
    const dMin = dateAgg._min.date;
    const dMax = dateAgg._max.date;

    return {
      scope: agentId ? 'agent' : 'global',
      // actual data span (Tashkent days) so the cockpit can open on the real dates the
      // records carry (e.g. an imported June workbook) instead of an empty current month.
      dataRange: dMin && dMax ? { from: tashkentDateStr(dMin), to: tashkentDateStr(dMax) } : null,
      // all-time proof block (matches the workbook): headline sof foyda, kirim, chiqim.
      allTime: {
        sales: round2(allSale),
        cost: round2(allCost),
        goodsProfit: round2(allGoodsProfit),
        transportProfit: round2(allTransportProfit),
        transportCost: round2(allTransportCost),
        netProfit: round2(allNetProfit),
        collected: round2(kirim), // kirim — client money in
        factoryPaid: round2(factoryPaidAll),
        vehiclePaid: round2(vehiclePaidAll),
        chiqim: round2(chiqim), // chiqim — factory + driver money out
        clientsOweUs: round2(clientsOweUs),
        weOweFactories: round2(weOweFactories),
        orders: allOrderAgg._count,
        cubeSold: round3(allCubeAgg._sum.quantityM3 ?? 0),
      },
      // period window echo + date-ranged flow metrics (the cockpit's headline)
      period: {
        from: periodFrom,
        to: periodTo,
        sales: round2(periodSale),
        cost: round2(periodCost),
        goodsProfit: round2(periodGoodsProfit),
        transportProfit: round2(periodTransportProfit),
        netProfit: round2(periodNetProfit),
        collected: round2(periodCollectedAgg._sum.amount ?? 0),
        orders: periodOrderAgg._count,
        cubeSold: round3(periodCubeAgg._sum.quantityM3 ?? 0),
      },
      todaySales: round2(todayAgg._sum.saleTotal ?? 0),
      monthSales: round2(monthSale),
      yearSales: round2(yearAgg._sum.saleTotal ?? 0),
      ordersInFlight,
      clientsOweUs: round2(clientsOweUs),
      weOweFactories: round2(weOweFactories),
      weOweVehicles: round2(weOweVehicles),
      collectedThisMonth: round2(collectedAgg._sum.amount ?? 0),
      goodsProfitMonth: round2(monthSale.minus(monthCost)),
      transportProfitMonth: round2(
        D(monthAgg._sum.transportCharge ?? 0).minus(monthAgg._sum.transportCost ?? 0),
      ),
      bonusWallets: round2(bonusWallets),
      palletsAtClients,
      cubeSoldMonth: round3(cubeAgg._sum.quantityM3 ?? 0),
      expectedCollections: round2(clientsOweUs),
    };
  }

  /**
   * Daily buckets computed by Postgres (one GROUP BY per source table).
   * DB timestamps are UTC ⇒ AT TIME ZONE 'UTC' first, then to Tashkent wallclock.
   */
  async trends(opts: { days?: number; from?: string; to?: string } = {}, user?: RequestUser) {
    const agentId = this.agentOf(user);

    // Window (Tashkent days): an explicit from/to range wins (date-to-date, the
    // only date control in the UI); otherwise fall back to the last `days` days
    // ending today. Upper bound is exclusive (start of the day after `to`).
    let from: Date;
    let toExclusive: Date;
    if (opts.from || opts.to) {
      from = parseTashkentFrom(opts.from) ?? tashkentDayStart();
      toExclusive = parseTashkentTo(opts.to) ?? (parseTashkentTo(tashkentDateStr(new Date())) as Date);
      if (from.getTime() >= toExclusive.getTime()) toExclusive = new Date(from.getTime() + DAY_MS);
    } else {
      const days = opts.days ?? 30;
      from = new Date(tashkentDayStart().getTime() - (days - 1) * DAY_MS);
      toExclusive = new Date(tashkentDayStart().getTime() + DAY_MS); // through end of today
    }
    // guard against unbounded ranges — cap the number of daily buckets
    const dayCount = Math.max(1, Math.min(Math.round((toExclusive.getTime() - from.getTime()) / DAY_MS), 366));

    const orderAgentSql = agentId ? Prisma.sql`AND o."agentId" = ${agentId}` : Prisma.empty;
    const payAgentSql = agentId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Client" c WHERE c."id" = p."clientId" AND c."agentId" = ${agentId})`
      : Prisma.empty;

    const [orderRows, payRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: string; sales: Prisma.Decimal; orders: number }>>(Prisma.sql`
        SELECT to_char(date_trunc('day', (o."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'), 'YYYY-MM-DD') AS day,
               COALESCE(SUM(o."saleTotal"), 0) AS sales,
               COUNT(*)::int AS orders
        FROM "Order" o
        WHERE o."status" <> 'CANCELLED' AND o."date" >= ${from} AND o."date" < ${toExclusive} ${orderAgentSql}
        GROUP BY 1
        ORDER BY 1`),
      this.prisma.$queryRaw<Array<{ day: string; collected: Prisma.Decimal }>>(Prisma.sql`
        SELECT to_char(date_trunc('day', (p."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'), 'YYYY-MM-DD') AS day,
               COALESCE(SUM(p."amount"), 0) AS collected
        FROM "Payment" p
        WHERE p."kind" = 'CLIENT_IN' AND p."voidedAt" IS NULL AND p."date" >= ${from} AND p."date" < ${toExclusive} ${payAgentSql}
        GROUP BY 1
        ORDER BY 1`),
    ]);

    // zero-fill the requested window so charts get a continuous series
    const buckets = new Map<
      string,
      { date: string; sales: Prisma.Decimal; orders: number; collected: Prisma.Decimal }
    >();
    for (let i = 0; i < dayCount; i++) {
      const key = tashkentDateStr(new Date(from.getTime() + i * DAY_MS));
      buckets.set(key, { date: key, sales: ZERO, orders: 0, collected: ZERO });
    }
    for (const r of orderRows) {
      const b = buckets.get(r.day);
      if (b) {
        b.sales = round2(D(r.sales));
        b.orders = r.orders;
      }
    }
    for (const r of payRows) {
      const b = buckets.get(r.day);
      if (b) b.collected = round2(D(r.collected));
    }
    return Array.from(buckets.values());
  }

  /** CASHIER's view: per-cashbox balances plus today's in/out flows. */
  async kassa() {
    const dayStart = tashkentDayStart();
    const [boxes, allTime, today] = await Promise.all([
      this.prisma.cashbox.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      this.prisma.cashTransaction.groupBy({ by: ['cashboxId', 'direction'], _sum: { amount: true } }),
      this.prisma.cashTransaction.groupBy({
        by: ['cashboxId', 'direction'],
        where: { date: { gte: dayStart } },
        _sum: { amount: true },
      }),
    ]);
    const key = (id: string, dir: CashDirection) => `${id}:${dir}`;
    const allMap = new Map(allTime.map((r) => [key(r.cashboxId, r.direction), D(r._sum.amount ?? 0)]));
    const todayMap = new Map(today.map((r) => [key(r.cashboxId, r.direction), D(r._sum.amount ?? 0)]));

    return boxes.map((b) => {
      const inAll = allMap.get(key(b.id, CashDirection.IN)) ?? ZERO;
      const outAll = allMap.get(key(b.id, CashDirection.OUT)) ?? ZERO;
      return {
        cashboxId: b.id,
        name: b.name,
        type: b.type,
        currency: b.currency,
        balance: round2(inAll.minus(outAll)),
        todayIn: round2(todayMap.get(key(b.id, CashDirection.IN)) ?? ZERO),
        todayOut: round2(todayMap.get(key(b.id, CashDirection.OUT)) ?? ZERO),
      };
    });
  }

  /** Per-agent KPI ranking for a Tashkent-local calendar month. */
  async agentsRanking(monthParam?: string) {
    const { start, end, month } = tashkentMonthWindow(monthParam);

    const [agents, orderGroups, payGroups, debtRows] = await Promise.all([
      this.prisma.agent.findMany({ orderBy: [{ sortNo: 'asc' }, { name: 'asc' }] }),
      this.prisma.order.groupBy({
        by: ['agentId'],
        where: {
          status: { not: OrderStatus.CANCELLED },
          date: { gte: start, lt: end },
          agentId: { not: null },
        },
        _sum: { saleTotal: true, costTotal: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['agentId'],
        where: {
          kind: PaymentKind.CLIENT_IN,
          voidedAt: null,
          date: { gte: start, lt: end },
          agentId: { not: null },
        },
        _sum: { amount: true },
      }),
      // NET client balance per agent (debts minus advances — the journal's «Ост»).
      this.prisma.$queryRaw<Array<{ agentId: string; debt: Prisma.Decimal }>>(Prisma.sql`
        SELECT c."agentId" AS "agentId", COALESCE(SUM(le."amount"), 0) AS debt
        FROM "LedgerEntry" le
        JOIN "Client" c ON c."id" = le."clientId"
        WHERE le."account" = 'CLIENT' AND c."agentId" IS NOT NULL
        GROUP BY c."agentId"`),
    ]);

    const orderMap = new Map(orderGroups.map((g) => [g.agentId as string, g]));
    const payMap = new Map(payGroups.map((g) => [g.agentId as string, D(g._sum.amount ?? 0)]));
    const debtMap = new Map(debtRows.map((r) => [r.agentId, D(r.debt)]));

    const rows = agents.map((a) => {
      const o = orderMap.get(a.id);
      const sales = D(o?._sum.saleTotal ?? 0);
      const cost = D(o?._sum.costTotal ?? 0);
      return {
        agentId: a.id,
        agent: a.name,
        sales: round2(sales),
        goodsProfit: round2(sales.minus(cost)),
        collected: round2(payMap.get(a.id) ?? ZERO),
        outstandingDebt: round2(debtMap.get(a.id) ?? ZERO),
        orders: o?._count ?? 0,
      };
    });
    rows.sort((x, y) => y.sales.comparedTo(x.sales));
    return { month, agents: rows };
  }
}
