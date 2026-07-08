import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DELIVERED = { status: { in: ['DELIVERED', 'COMPLETED'] } };

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const [orderAgg, activeAgg, payCli, payFac, payVeh, clientCount, agentCount, expenseAgg, cashAgg] = await Promise.all([
      this.prisma.order.aggregate({ where: DELIVERED, _sum: { saleTotal: true, costTotal: true, transportFee: true, profit: true, quantity: true }, _count: true }),
      this.prisma.order.count({ where: { status: { in: ['NEW', 'CONFIRMED', 'LOADING', 'DELIVERING'] } } }),
      this.prisma.payment.aggregate({ where: { type: 'CLIENT' }, _sum: { amount: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { type: 'FACTORY' }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({ where: { type: 'VEHICLE' }, _sum: { amount: true } }),
      this.prisma.client.count(),
      this.prisma.agent.count(),
      this.prisma.expense.aggregate({ _sum: { amount: true } }),
      this.prisma.cashTransaction.groupBy({ by: ['direction'], _sum: { amount: true } }),
    ]);
    const sale = orderAgg._sum.saleTotal ?? 0;
    const cost = orderAgg._sum.costTotal ?? 0;
    const transport = orderAgg._sum.transportFee ?? 0;
    const paidCli = payCli._sum.amount ?? 0;
    const paidFac = payFac._sum.amount ?? 0;
    const paidVeh = payVeh._sum.amount ?? 0;
    const cashIn = cashAgg.find((c) => c.direction === 'IN')?._sum.amount ?? 0;
    const cashOut = cashAgg.find((c) => c.direction === 'OUT')?._sum.amount ?? 0;
    return {
      totalSales: sale,
      totalProfit: orderAgg._sum.profit ?? 0,
      totalCubes: orderAgg._sum.quantity ?? 0,
      ordersCount: orderAgg._count,
      activeOrders: activeAgg,
      totalPaid: paidCli,
      paymentsCount: payCli._count,
      clientsDebtToUs: sale - paidCli,
      weOweFactory: cost - paidFac,
      weOweVehicle: transport - paidVeh,
      clientCount,
      agentCount,
      totalExpense: expenseAgg._sum.amount ?? 0,
      cashBalance: cashIn - cashOut,
    };
  }

  async salesTrend() {
    const orders = await this.prisma.order.findMany({ where: DELIVERED, select: { date: true, saleTotal: true, profit: true }, orderBy: { date: 'asc' } });
    const map = new Map<string, { date: string; sales: number; profit: number }>();
    for (const o of orders) {
      const key = o.date.toISOString().slice(0, 10);
      const cur = map.get(key) || { date: key, sales: 0, profit: 0 };
      cur.sales += o.saleTotal; cur.profit += o.profit; map.set(key, cur);
    }
    return Array.from(map.values());
  }

  async agentPerformance() {
    const [orders, pays, agents] = await Promise.all([
      this.prisma.order.groupBy({ by: ['agentId'], where: DELIVERED, _sum: { saleTotal: true, profit: true }, _count: true }),
      this.prisma.payment.groupBy({ by: ['agentId'], where: { type: 'CLIENT' }, _sum: { amount: true } }),
      this.prisma.agent.findMany(),
    ]);
    const payMap = new Map(pays.map((p) => [p.agentId, p._sum.amount ?? 0]));
    return agents.map((a) => {
      const s = orders.find((x) => x.agentId === a.id);
      return { agentId: a.id, agent: a.name, groupNo: a.groupNo, sales: s?._sum.saleTotal ?? 0, profit: s?._sum.profit ?? 0, deliveries: s?._count ?? 0, collected: payMap.get(a.id) ?? 0 };
    }).sort((a, b) => b.sales - a.sales);
  }

  // count of orders per status (funnel)
  async orderFunnel() {
    const g = await this.prisma.order.groupBy({ by: ['status'], _count: true });
    return g.map((x) => ({ status: x.status, count: x._count }));
  }
}
