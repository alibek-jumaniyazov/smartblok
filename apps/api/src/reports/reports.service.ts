import { Injectable } from '@nestjs/common';
import { OrderStatus, PalletTransactionType, PaymentKind, Prisma } from '@prisma/client';
import { LedgerService } from '../common/ledger.service';
import { D, round2, round3, sum, ZERO } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { parseTashkentFrom, parseTashkentTo } from '../dashboard/tashkent-time';
import { OrdersRegisterQueryDto } from './dto';

/** Client pallet balance: Σ DELIVERED − RETURNED − CHARGED_LOST + signed ADJ/REV (excel-spec §9). */
const PALLET_SIGN: Record<PalletTransactionType, number> = {
  [PalletTransactionType.DELIVERED_TO_CLIENT]: 1,
  [PalletTransactionType.RETURNED_BY_CLIENT]: -1,
  [PalletTransactionType.CHARGED_LOST]: -1,
  [PalletTransactionType.ADJUSTMENT]: 1, // qty is signed
  [PalletTransactionType.REVERSAL]: 1, // qty is signed
  [PalletTransactionType.RECEIVED_FROM_FACTORY]: 0,
  [PalletTransactionType.RETURNED_TO_FACTORY]: 0,
};

interface SvodClientRow {
  clientId: string;
  client: string;
  goods: Prisma.Decimal;
  payments: Prisma.Decimal;
  balance: Prisma.Decimal;
  palletBalance: number;
  driverDirect: Prisma.Decimal;
}

const emptySubtotal = () => ({
  goods: ZERO,
  payments: ZERO,
  balance: ZERO,
  palletBalance: 0,
  driverDirect: ZERO,
});

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  /**
   * Свод Завод equivalent (excel-spec §6): factory block + per-agent client
   * blocks + grand totals + the two §9 reconciliation identities as `checks`
   * (0 by construction — a non-zero value flags orphaned rows).
   * from/to bound flows (orders/payments); balances are always CURRENT ledger sums.
   */
  async svod(fromStr?: string, toStr?: string) {
    const from = parseTashkentFrom(fromStr);
    const to = parseTashkentTo(toStr);
    const dateFilter: Prisma.DateTimeFilter | undefined =
      from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined;
    const orderWhere: Prisma.OrderWhereInput = {
      status: { not: OrderStatus.CANCELLED },
      ...(dateFilter ? { date: dateFilter } : {}),
    };
    const payDateWhere: Prisma.PaymentWhereInput = dateFilter ? { date: dateFilter } : {};

    const fromSql = from ? Prisma.sql`AND o."date" >= ${from}` : Prisma.empty;
    const toSql = to ? Prisma.sql`AND o."date" < ${to}` : Prisma.empty;

    const [
      factories,
      factoryItemRows,
      factoryPayGroups,
      factoryBalances,
      agents,
      clients,
      orderGroups,
      payGroups,
      clientBalances,
      palletGroups,
      totalSalesAgg,
      totalClientPayAgg,
    ] = await Promise.all([
      this.prisma.factory.findMany({ orderBy: { name: 'asc' } }),
      // goods = blocks only (m³ × best-known cost price); pallets = count × pallet price
      this.prisma.$queryRaw<Array<{ factoryId: string; goods: Prisma.Decimal; pallets: Prisma.Decimal }>>(
        Prisma.sql`
          SELECT o."factoryId" AS "factoryId",
                 COALESCE(SUM(oi."quantityM3" * COALESCE(oi."finalCostPricePerM3", oi."costPricePerM3")), 0) AS goods,
                 COALESCE(SUM(oi."palletCount" * oi."palletPrice"), 0) AS pallets
          FROM "OrderItem" oi
          JOIN "Order" o ON o."id" = oi."orderId"
          WHERE o."status" <> 'CANCELLED' ${fromSql} ${toSql}
          GROUP BY o."factoryId"`,
      ),
      this.prisma.payment.groupBy({
        by: ['factoryId'],
        where: {
          kind: PaymentKind.FACTORY_OUT, // incl. method=BONUS debt offsets
          voidedAt: null,
          factoryId: { not: null },
          ...payDateWhere,
        },
        _sum: { amount: true },
      }),
      this.ledger.factoryBalances(),
      this.prisma.agent.findMany({ orderBy: [{ sortNo: 'asc' }, { name: 'asc' }] }),
      this.prisma.client.findMany({
        select: { id: true, name: true, active: true, agentId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.order.groupBy({ by: ['clientId'], where: orderWhere, _sum: { saleTotal: true } }),
      this.prisma.payment.groupBy({
        by: ['clientId', 'kind'],
        where: {
          kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.TRANSPORT_DIRECT] },
          voidedAt: null,
          clientId: { not: null },
          ...payDateWhere,
        },
        _sum: { amount: true },
      }),
      this.ledger.clientBalances(),
      this.prisma.palletTransaction.groupBy({
        by: ['clientId', 'type'],
        where: { clientId: { not: null } },
        _sum: { qty: true },
      }),
      this.prisma.order.aggregate({ where: orderWhere, _sum: { saleTotal: true } }),
      this.prisma.payment.aggregate({
        where: {
          kind: { in: [PaymentKind.CLIENT_IN, PaymentKind.TRANSPORT_DIRECT] },
          voidedAt: null,
          ...payDateWhere,
        },
        _sum: { amount: true },
      }),
    ]);

    // ── factory block ──
    const itemMap = new Map(factoryItemRows.map((r) => [r.factoryId, r]));
    const paidMap = new Map(factoryPayGroups.map((g) => [g.factoryId as string, D(g._sum.amount ?? 0)]));
    const factoryRows = factories
      .map((f) => {
        const it = itemMap.get(f.id);
        const goods = round2(it?.goods ?? ZERO);
        const pallets = round2(it?.pallets ?? ZERO);
        const paidToFactory = round2(paidMap.get(f.id) ?? ZERO);
        const factoryBalance = round2(factoryBalances.get(f.id) ?? ZERO);
        return {
          factoryId: f.id,
          factory: f.name,
          goods,
          pallets,
          goodsWithPallets: round2(goods.plus(pallets)),
          paidToFactory,
          factoryBalance,
        };
      })
      .filter(
        (r) =>
          !r.goods.isZero() ||
          !r.pallets.isZero() ||
          !r.paidToFactory.isZero() ||
          !r.factoryBalance.isZero(),
      );
    const factoryTotals = {
      goods: round2(sum(factoryRows.map((r) => r.goods))),
      pallets: round2(sum(factoryRows.map((r) => r.pallets))),
      goodsWithPallets: round2(sum(factoryRows.map((r) => r.goodsWithPallets))),
      paidToFactory: round2(sum(factoryRows.map((r) => r.paidToFactory))),
      factoryBalance: round2(sum(factoryRows.map((r) => r.factoryBalance))),
    };

    // ── per-client rows ──
    const goodsMap = new Map(orderGroups.map((g) => [g.clientId, D(g._sum.saleTotal ?? 0)]));
    const clientInMap = new Map<string, Prisma.Decimal>();
    const driverDirectMap = new Map<string, Prisma.Decimal>();
    for (const g of payGroups) {
      const cid = g.clientId as string;
      const amt = D(g._sum.amount ?? 0);
      if (g.kind === PaymentKind.TRANSPORT_DIRECT) {
        driverDirectMap.set(cid, (driverDirectMap.get(cid) ?? ZERO).plus(amt));
      } else {
        clientInMap.set(cid, (clientInMap.get(cid) ?? ZERO).plus(amt));
      }
    }
    const palletMap = new Map<string, number>();
    for (const g of palletGroups) {
      const cid = g.clientId as string;
      palletMap.set(cid, (palletMap.get(cid) ?? 0) + PALLET_SIGN[g.type] * (g._sum.qty ?? 0));
    }

    const rowsByAgent = new Map<string | null, SvodClientRow[]>();
    for (const c of clients) {
      const goods = round2(goodsMap.get(c.id) ?? ZERO);
      const driverDirect = round2(driverDirectMap.get(c.id) ?? ZERO);
      const payments = round2((clientInMap.get(c.id) ?? ZERO).plus(driverDirect));
      const balance = round2(clientBalances.get(c.id) ?? ZERO);
      const palletBalance = palletMap.get(c.id) ?? 0;
      const hasActivity =
        !goods.isZero() || !payments.isZero() || !balance.isZero() || palletBalance !== 0;
      if (!hasActivity && !c.active) continue;
      const row: SvodClientRow = {
        clientId: c.id,
        client: c.name,
        goods,
        payments,
        balance,
        palletBalance,
        driverDirect,
      };
      const key = c.agentId ?? null;
      const list = rowsByAgent.get(key) ?? [];
      list.push(row);
      rowsByAgent.set(key, list);
    }

    const subtotalOf = (rows: SvodClientRow[]) => ({
      goods: round2(sum(rows.map((r) => r.goods))),
      payments: round2(sum(rows.map((r) => r.payments))),
      balance: round2(sum(rows.map((r) => r.balance))),
      palletBalance: rows.reduce((n, r) => n + r.palletBalance, 0),
      driverDirect: round2(sum(rows.map((r) => r.driverDirect))),
    });

    const agentBlocks: Array<{
      agentId: string | null;
      agent: string;
      rows: SvodClientRow[];
      subtotal: ReturnType<typeof emptySubtotal>;
    }> = [];
    for (const a of agents) {
      const rows = rowsByAgent.get(a.id) ?? [];
      if (!rows.length && !a.active) continue;
      agentBlocks.push({ agentId: a.id, agent: a.name, rows, subtotal: subtotalOf(rows) });
    }
    const unassigned = rowsByAgent.get(null) ?? [];
    if (unassigned.length) {
      agentBlocks.push({
        agentId: null,
        agent: 'Biriktirilmagan',
        rows: unassigned,
        subtotal: subtotalOf(unassigned),
      });
    }

    const allRows = agentBlocks.flatMap((b) => b.rows);
    const totals = subtotalOf(allRows);

    // ── §9 reconciliation identities (must be 0 by construction) ──
    const goodsIdentity = round2(D(totalSalesAgg._sum.saleTotal ?? 0).minus(totals.goods));
    const paymentsIdentity = round2(D(totalClientPayAgg._sum.amount ?? 0).minus(totals.payments));

    return {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      factory: factoryTotals,
      factories: factoryRows,
      agents: agentBlocks,
      totals,
      checks: {
        // Σ(client payments incl. driver-direct, whole table) − Σ(per-client payment column)
        paymentsIdentity,
        // Σ(order saleTotal, whole table) − Σ(per-client goods column)
        goodsIdentity,
      },
    };
  }

  /**
   * Flat orders register (the Товар ledger shape) — one row per order/truck,
   * paged, flat enough for an AntD table and xlsx export.
   */
  async ordersRegister(q: OrdersRegisterQueryDto) {
    const from = parseTashkentFrom(q.from);
    const to = parseTashkentTo(q.to);
    const where: Prisma.OrderWhereInput = {
      status: { not: OrderStatus.CANCELLED },
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.factoryId ? { factoryId: q.factoryId } : {}),
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    };
    const { skip, take, page, pageSize } = pageArgs(q);

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ date: 'asc' }, { orderNo: 'asc' }],
        skip,
        take,
        include: {
          client: { select: { name: true } },
          agent: { select: { name: true } },
          factory: { select: { name: true } },
          vehicle: { select: { plate: true, name: true } },
          items: { include: { product: { select: { name: true, size: true } } } },
        },
      }),
    ]);

    const rows = orders.map((o) => {
      const m3 = round3(sum(o.items.map((i) => i.quantityM3)));
      const blocksCost = sum(
        o.items.map((i) => D(i.quantityM3).times(i.finalCostPricePerM3 ?? i.costPricePerM3)),
      );
      const pallets = o.items.reduce((n, i) => n + i.palletCount, 0);
      const palletMoney = round2(sum(o.items.map((i) => D(i.palletPrice).times(i.palletCount))));
      const sizes = Array.from(
        new Set(o.items.map((i) => i.product.size || i.product.name)),
      ).join(', ');
      // per-m³ prices back-solved from totals (workbook keeps fractional 6dp prices)
      const costPrice = m3.isZero() ? ZERO : blocksCost.div(m3).toDecimalPlaces(6);
      const salePrice = m3.isZero() ? ZERO : D(o.saleTotal).div(m3).toDecimalPlaces(6);
      return {
        id: o.id,
        orderNo: o.orderNo,
        date: o.date,
        status: o.status,
        agent: o.agent?.name ?? null,
        client: o.client.name,
        factory: o.factory.name,
        plate: o.vehicle?.plate ?? o.vehicle?.name ?? null,
        driver: o.driverName ?? null,
        sizes,
        m3,
        costPrice,
        costTotal: round2(o.costTotal),
        costStatus: o.costStatus,
        pallets,
        palletMoney,
        salePrice,
        saleTotal: round2(o.saleTotal),
        transportCost: round2(o.transportCost),
        transportCharge: round2(o.transportCharge),
        transportPaidStatus: o.transportPaidStatus,
        // saleTotal − costTotal (costTotal includes pallet money — dashboard definition)
        goodsProfit: round2(D(o.saleTotal).minus(o.costTotal)),
      };
    });

    return paged(rows, total, page, pageSize);
  }
}
