import { Injectable } from '@nestjs/common';
import {
  CashDirection,
  CostStatus,
  FactoryPayIntent,
  OrderStatus,
  PalletTransactionType,
  PaymentKind,
  Prisma,
} from '@prisma/client';
import { FactoryBuckets, LedgerService } from '../common/ledger.service';
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

/** «Kirim» is NET money collected from clients: what came in minus what went back. */
const COLLECTION_KINDS: PaymentKind[] = [PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND];
/** «Chiqim» to the factory is NET too: what we paid minus what the factory sent back. */
const FACTORY_KINDS: PaymentKind[] = [PaymentKind.FACTORY_OUT, PaymentKind.FACTORY_REFUND];

/** Σ(forward kinds) − Σ(refundKind) over a groupBy(['kind']) result. */
const netByKind = (
  groups: Array<{ kind: PaymentKind; _sum: { amount: Prisma.Decimal | null } }>,
  refundKind: PaymentKind,
): Prisma.Decimal =>
  groups.reduce(
    (net, g) => (g.kind === refundKind ? net.minus(g._sum.amount ?? 0) : net.plus(g._sum.amount ?? 0)),
    ZERO,
  );

/** Σ CLIENT_IN − Σ CLIENT_REFUND (matches the daftar «Приход»). */
const netCollected = (groups: Array<{ kind: PaymentKind; _sum: { amount: Prisma.Decimal | null } }>) =>
  netByKind(groups, PaymentKind.CLIENT_REFUND);
/** Σ FACTORY_OUT − Σ FACTORY_REFUND (matches the import's own factoryPaidTotal). */
const netFactoryPaid = (groups: Array<{ kind: PaymentKind; _sum: { amount: Prisma.Decimal | null } }>) =>
  netByKind(groups, PaymentKind.FACTORY_REFUND);

/**
 * THE PROFIT RULE (owner, 2026-07-21). An order's factory cost is DETERMINED once the
 * intent names a price book, or once real money has already bought part of it — a partly
 * settled order is priced by the money, not by a guess. Everything else is provisional at
 * the DEARER bank book, so counting it would report a profit nobody has decided yet.
 */
const DETERMINED_COST: Prisma.OrderWhereInput = {
  OR: [
    { factoryPayIntent: { not: FactoryPayIntent.UNKNOWN } },
    { costStatus: { not: CostStatus.PROVISIONAL } },
  ],
};

/** One «aniqlanmagan» window: the orders whose cost the price book can only bracket. */
interface UndeterminedAgg {
  orders: number;
  sales: Prisma.Decimal;
  transportProfit: Prisma.Decimal;
  costCash: Prisma.Decimal;
  costBank: Prisma.Decimal;
}

const EMPTY_UNDETERMINED: UndeterminedAgg = {
  orders: 0,
  sales: ZERO,
  transportProfit: ZERO,
  costCash: ZERO,
  costBank: ZERO,
};

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
    const emptyBuckets = Promise.resolve(new Map<string, FactoryBuckets>());
    const noBonus = Promise.resolve(
      [] as Array<{ factoryId: string; _sum: { amount: Prisma.Decimal | null } }>,
    );

    const [
      todayAgg,
      monthAgg,
      yearAgg,
      ordersInFlight,
      clientBalances,
      factoryBuckets,
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
      monthDetAgg,
      periodDetAgg,
      allDetAgg,
      periodUndet,
      allUndet,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...notCancelled, date: { gte: dayStart } },
        _sum: { saleTotal: true },
      }),
      // revenue only — the month's cost/transport lines come from monthDetAgg (PROFIT RULE)
      this.prisma.order.aggregate({
        where: { ...notCancelled, date: { gte: monthStart } },
        _sum: { saleTotal: true },
      }),
      this.prisma.order.aggregate({
        where: { ...notCancelled, date: { gte: yearStart } },
        _sum: { saleTotal: true },
      }),
      this.prisma.order.count({ where: { ...orderScope, status: { in: IN_FLIGHT } } }),
      // off-book «balansni nazorat qilish» corrections stay OUT of the company dashboard tiles
      this.ledger.clientBalances(agentClientIds, { includeOffBook: false }),
      agentId ? emptyBuckets : this.ledger.factoryBucketsMap({ includeOffBook: false }),
      agentId ? emptyBalances : this.ledger.vehicleBalances({ includeOffBook: false }),
      this.prisma.payment.groupBy({
        by: ['kind'],
        where: { kind: { in: COLLECTION_KINDS }, voidedAt: null, date: { gte: monthStart }, ...paymentScope },
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
      this.prisma.payment.groupBy({
        by: ['kind'],
        where: {
          kind: { in: COLLECTION_KINDS },
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
      this.prisma.payment.groupBy({
        by: ['kind'],
        where: { kind: { in: COLLECTION_KINDS }, voidedAt: null, ...paymentScope },
        _sum: { amount: true },
      }),
      // company-wide outflows (hidden for AGENT — zeroed below, kept as cheap aggregates)
      this.prisma.payment.groupBy({
        by: ['kind'],
        where: { kind: { in: FACTORY_KINDS }, voidedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { kind: PaymentKind.VEHICLE_OUT, voidedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.order.aggregate({ where: notCancelled, _min: { date: true }, _max: { date: true } }),
      // ── determined-cost twins of the three profit windows (see DETERMINED_COST) ──
      //    Sales/orders/cubes above stay TOTAL — revenue is never undetermined; only the
      //    cost and the profit lines narrow to the orders whose cost is real.
      this.prisma.order.aggregate({
        where: { ...notCancelled, ...DETERMINED_COST, date: { gte: monthStart } },
        _sum: { saleTotal: true, costTotal: true, transportCharge: true, transportCost: true },
      }),
      this.prisma.order.aggregate({
        where: { ...notCancelled, ...DETERMINED_COST, date: { gte: periodStart, lt: periodEnd } },
        _sum: { saleTotal: true, costTotal: true, transportCharge: true, transportCost: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { ...notCancelled, ...DETERMINED_COST },
        _sum: { saleTotal: true, costTotal: true, transportCharge: true, transportCost: true },
        _count: true,
      }),
      this.undeterminedAgg(agentId, { from: periodStart, to: periodEnd }),
      this.undeterminedAgg(agentId),
    ]);

    // NET receivables (debts minus advances) — the owner's «Ост» semantics: the Excel
    // journal nets client prepayments against debtors, so the dashboard must match it.
    let clientsOweUs = ZERO;
    for (const bal of clientBalances.values()) {
      clientsOweUs = clientsOweUs.plus(bal);
    }
    // Factory/vehicle: <0 ⇒ dealer owes; report the debt as a positive figure.
    // R2 is enforced in the LEDGER (an advance is never spent without an explicit draw),
    // not by restating this tile: `weOweFactories` keeps its original NET meaning, which is
    // the figure the owner reads on every report he already has. The gross open goods debt
    // and the two advance channels sit beside it, so nothing is hidden either way.
    let weOweFactories = ZERO;
    let factoryPayableOpen = ZERO;
    let factoryAdvanceCash = ZERO;
    let factoryAdvanceBank = ZERO;
    for (const b of factoryBuckets.values()) {
      if (b.net.lessThan(0)) weOweFactories = weOweFactories.plus(b.net.negated());
      if (b.payable.lessThan(0)) factoryPayableOpen = factoryPayableOpen.plus(b.payable.negated());
      factoryAdvanceCash = factoryAdvanceCash.plus(b.advanceCash);
      factoryAdvanceBank = factoryAdvanceBank.plus(b.advanceBank);
    }
    const factoryAdvanceTotal = factoryAdvanceCash.plus(factoryAdvanceBank);
    let weOweVehicles = ZERO;
    for (const bal of vehicleBalances.values()) {
      if (bal.lessThan(0)) weOweVehicles = weOweVehicles.plus(bal.negated());
    }

    const bonusWallets = sum(bonusGroups.map((g) => g._sum.amount ?? 0));
    const palletsAtClients = palletGroups.reduce(
      (acc, g) => acc + PALLET_SIGN[g.type] * (g._sum.qty ?? 0),
      0,
    );

    // `monthSale` is TOTAL revenue (a sale is never undetermined); the month profit tiles
    // below subtract on the DETERMINED base instead, or they would credit an undetermined
    // order's full sales as profit while dropping its cost.
    const monthSale = D(monthAgg._sum.saleTotal ?? 0);
    const monthDetSale = D(monthDetAgg._sum.saleTotal ?? 0);
    const monthCost = D(monthDetAgg._sum.costTotal ?? 0);

    // ── period figures: net profit = goods profit + transport profit, DETERMINED orders
    //    only (PROFIT RULE). `sales`/`orders`/`cubeSold` stay total; `determinedSales` is
    //    the base the profit lines are actually built on, so goodsProfit still reads as a
    //    subtraction on screen instead of looking like an unexplained shortfall.
    const periodSale = D(periodOrderAgg._sum.saleTotal ?? 0);
    const periodDetSale = D(periodDetAgg._sum.saleTotal ?? 0);
    // `cost` keeps its original meaning — the best-known factory cost of EVERY order in the
    // window (the workbook's «tannarx» line). Only the PROFIT lines narrow to the orders
    // whose cost is real; renaming what `cost` counts would silently restate old reports.
    const periodCost = D(periodOrderAgg._sum.costTotal ?? 0);
    const periodDetCost = D(periodDetAgg._sum.costTotal ?? 0);
    const periodGoodsProfit = periodDetSale.minus(periodDetCost);
    const periodTransportProfit = D(periodDetAgg._sum.transportCharge ?? 0).minus(
      periodDetAgg._sum.transportCost ?? 0,
    );
    const periodNetProfit = periodGoodsProfit.plus(periodTransportProfit);
    const periodUndetermined = this.undeterminedBlock(periodUndet);

    // ── all-time reconciliation: sof foyda = goods profit + transport profit over every
    //    non-cancelled order WHOSE COST IS DETERMINED; kirim = Σ CLIENT_IN,
    //    chiqim = Σ FACTORY_OUT + VEHICLE_OUT. For a workbook import this equals the Excel
    //    «Соф фойда»/«Утказилган пул» totals once every imported order carries an intent.
    const allSale = D(allOrderAgg._sum.saleTotal ?? 0);
    const allDetSale = D(allDetAgg._sum.saleTotal ?? 0);
    const allCost = D(allOrderAgg._sum.costTotal ?? 0);       // every order (see periodCost)
    const allDetCost = D(allDetAgg._sum.costTotal ?? 0);      // determined slice only
    const allGoodsProfit = allDetSale.minus(allDetCost);
    const allTransportCost = D(allDetAgg._sum.transportCost ?? 0);
    const allTransportProfit = D(allDetAgg._sum.transportCharge ?? 0).minus(allTransportCost);
    const allNetProfit = allGoodsProfit.plus(allTransportProfit);
    const allUndetermined = this.undeterminedBlock(allUndet);
    const kirim = netCollected(allCollectedAgg);
    const factoryPaidAll = agentId ? ZERO : netFactoryPaid(factoryPaidAgg);
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
        // advance no longer nets against the debt above — show it, don't hide it (R2/R3)
        factoryAdvanceCash: round2(factoryAdvanceCash),
        factoryAdvanceBank: round2(factoryAdvanceBank),
        factoryAdvanceTotal: round2(factoryAdvanceTotal),
        orders: allOrderAgg._count,
        cubeSold: round3(allCubeAgg._sum.quantityM3 ?? 0),
        determinedSales: round2(allDetSale),
        determinedCost: round2(allDetCost),
        determinedOrders: allDetAgg._count,
        undetermined: allUndetermined,
        netProfitMin: round2(allNetProfit.plus(allUndetermined.profitMin)),
        netProfitMax: round2(allNetProfit.plus(allUndetermined.profitMax)),
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
        collected: round2(netCollected(periodCollectedAgg)),
        orders: periodOrderAgg._count,
        cubeSold: round3(periodCubeAgg._sum.quantityM3 ?? 0),
        determinedSales: round2(periodDetSale),
        determinedCost: round2(periodDetCost),
        determinedOrders: periodDetAgg._count,
        undetermined: periodUndetermined,
        netProfitMin: round2(periodNetProfit.plus(periodUndetermined.profitMin)),
        netProfitMax: round2(periodNetProfit.plus(periodUndetermined.profitMax)),
      },
      todaySales: round2(todayAgg._sum.saleTotal ?? 0),
      monthSales: round2(monthSale),
      yearSales: round2(yearAgg._sum.saleTotal ?? 0),
      ordersInFlight,
      clientsOweUs: round2(clientsOweUs),
      weOweFactories: round2(weOweFactories),
      weOweVehicles: round2(weOweVehicles),
      collectedThisMonth: round2(netCollected(collectedAgg)),
      goodsProfitMonth: round2(monthDetSale.minus(monthCost)),
      // the base the two tiles above are built on, so a gap against monthSales reads as
      // «shuncha savdo hali aniqlanmagan» rather than as an unexplained shortfall
      determinedSalesMonth: round2(monthDetSale),
      // determined-only too: netProfit is goodsProfit + transportProfit over ONE partition
      // of the orders, so both halves must come from the same set
      transportProfitMonth: round2(
        D(monthDetAgg._sum.transportCharge ?? 0).minus(monthDetAgg._sum.transportCost ?? 0),
      ),
      bonusWallets: round2(bonusWallets),
      palletsAtClients,
      cubeSoldMonth: round3(cubeAgg._sum.quantityM3 ?? 0),
      expectedCollections: round2(clientsOweUs),
    };
  }

  /**
   * The «aniqlanmagan» side of the PROFIT RULE: the orders DETERMINED_COST excludes —
   * intent still UNKNOWN and no money has landed on them yet, so the price book can only
   * bracket what they cost. Returns both brackets plus the sales/transport they carry.
   *
   * Why raw SQL instead of common/factory-coverage.ts: that helper resolves ONE order with
   * a price lookup per item per book, which is right on an order screen but would be
   * hundreds of round-trips here — the dashboard aggregates every open order on every page
   * load. The LATERALs walk the helper's exact ladder (requested book → the other factory
   * book → the price the order was created with) for all items at once, round the same way
   * (per item, 2dp, on the effective actual-or-planned qty), and never touch pallets: those
   * are owed to the factory in COUNT, so no cost total on this screen carries pallet money.
   */
  private async undeterminedAgg(
    agentId: string | null,
    window?: { from: Date; to: Date },
  ): Promise<UndeterminedAgg> {
    // D1: costCash/costBank ARE the two confidential factory book totals (products.service
    // strips the same kinds for AGENT). The agent cockpit renders no profit tile, so there
    // is nothing to bracket — hand back an empty block rather than a stripped one, which
    // would otherwise read as «profit = full sales» once the cost is zeroed out.
    if (agentId) return EMPTY_UNDETERMINED;

    const windowSql = window
      ? Prisma.sql`AND o."date" >= ${window.from} AND o."date" < ${window.to}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        orders: number;
        sales: Prisma.Decimal;
        transportProfit: Prisma.Decimal;
        costCash: Prisma.Decimal;
        costBank: Prisma.Decimal;
      }>
    >(Prisma.sql`
      WITH und AS (
        SELECT o."id", o."date", o."saleTotal", o."transportCharge", o."transportCost"
        FROM "Order" o
        WHERE o."status" <> 'CANCELLED'
          AND o."factoryPayIntent" = 'UNKNOWN'
          AND o."costStatus" = 'PROVISIONAL'
          ${windowSql}
      ),
      priced AS (
        SELECT COALESCE(oi."actualQuantityM3", oi."quantityM3") AS qty,
               oi."costPricePerM3" AS prov,
               pc."pricePerM3" AS cash,
               pb."pricePerM3" AS bank
        FROM "OrderItem" oi
        JOIN und ON und."id" = oi."orderId"
        LEFT JOIN LATERAL (
          SELECT pp."pricePerM3" FROM "ProductPrice" pp
          WHERE pp."productId" = oi."productId" AND pp."kind" = 'FACTORY_CASH'
            AND pp."effectiveFrom" <= und."date"
          ORDER BY pp."effectiveFrom" DESC LIMIT 1
        ) pc ON TRUE
        LEFT JOIN LATERAL (
          SELECT pp."pricePerM3" FROM "ProductPrice" pp
          WHERE pp."productId" = oi."productId" AND pp."kind" = 'FACTORY_BANK'
            AND pp."effectiveFrom" <= und."date"
          ORDER BY pp."effectiveFrom" DESC LIMIT 1
        ) pb ON TRUE
      ),
      cost AS (
        SELECT COALESCE(SUM(ROUND(qty * COALESCE(cash, bank, prov), 2)), 0) AS "costCash",
               COALESCE(SUM(ROUND(qty * COALESCE(bank, cash, prov), 2)), 0) AS "costBank"
        FROM priced
      )
      SELECT (SELECT COUNT(*)::int FROM und) AS orders,
             (SELECT COALESCE(SUM("saleTotal"), 0) FROM und) AS sales,
             (SELECT COALESCE(SUM("transportCharge" - "transportCost"), 0) FROM und) AS "transportProfit",
             cost."costCash", cost."costBank"
      FROM cost`);

    const r = rows[0];
    if (!r) return EMPTY_UNDETERMINED;
    return {
      orders: r.orders,
      sales: D(r.sales),
      transportProfit: D(r.transportProfit),
      costCash: D(r.costCash),
      costBank: D(r.costBank),
    };
  }

  /**
   * Wire shape for one «aniqlanmagan» window. The naqd book is the cheaper one, so it
   * yields the HIGHER profit — but the bounds are taken as a true min/max rather than
   * hard-wired to a channel, because nothing stops a factory from pricing o'tkazma below
   * naqd and the field names must not start lying if one ever does. Transport rides along
   * in both bounds so the range brackets the whole order, exactly like netProfit does.
   */
  private undeterminedBlock(a: UndeterminedAgg) {
    const atCash = a.sales.minus(a.costCash).plus(a.transportProfit);
    const atBank = a.sales.minus(a.costBank).plus(a.transportProfit);
    return {
      orders: a.orders,
      sales: round2(a.sales),
      costCash: round2(a.costCash),
      costBank: round2(a.costBank),
      transportProfit: round2(a.transportProfit),
      profitMin: round2(Prisma.Decimal.min(atCash, atBank)),
      profitMax: round2(Prisma.Decimal.max(atCash, atBank)),
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
      // NET like every other «kirim» figure (summary/allTime/ranking): a CLIENT_REFUND
      // subtracts, otherwise the chart and the KPI tile above it disagree on one screen.
      this.prisma.$queryRaw<Array<{ day: string; collected: Prisma.Decimal }>>(Prisma.sql`
        SELECT to_char(date_trunc('day', (p."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent'), 'YYYY-MM-DD') AS day,
               COALESCE(SUM(CASE WHEN p."kind" = 'CLIENT_REFUND' THEN -p."amount" ELSE p."amount" END), 0) AS collected
        FROM "Payment" p
        WHERE p."kind" IN ('CLIENT_IN','CLIENT_REFUND') AND p."voidedAt" IS NULL AND p."date" >= ${from} AND p."date" < ${toExclusive} ${payAgentSql}
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
        by: ['agentId', 'kind'],
        where: {
          kind: { in: COLLECTION_KINDS },
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
          AND le."source" <> 'OFFBOOK_ADJUSTMENT'
        GROUP BY c."agentId"`),
    ]);

    const orderMap = new Map(orderGroups.map((g) => [g.agentId as string, g]));
    // net per agent: CLIENT_IN minus CLIENT_REFUND (the daftar's «Приход»)
    const payMap = new Map<string, Prisma.Decimal>();
    for (const g of payGroups) {
      const key = g.agentId as string;
      const amount = D(g._sum.amount ?? 0);
      const prev = payMap.get(key) ?? ZERO;
      payMap.set(key, g.kind === PaymentKind.CLIENT_REFUND ? prev.minus(amount) : prev.plus(amount));
    }
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
