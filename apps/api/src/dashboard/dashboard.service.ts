import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const [salesAgg, payAgg, factoryPayAgg, clientCount, agentCount, palletAgg] = await Promise.all([
      this.prisma.sale.aggregate({ _sum: { saleTotal: true, costTotal: true, palletTotal: true, profit: true, cubes: true }, _count: true }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, _count: true }),
      this.prisma.factoryPayment.aggregate({ _sum: { amount: true } }),
      this.prisma.client.count(),
      this.prisma.agent.count(),
      this.prisma.palletMovement.aggregate({ _sum: { issuedQty: true, returnedQty: true } }),
    ]);

    const totalSales = salesAgg._sum.saleTotal ?? 0;
    const totalProfit = salesAgg._sum.profit ?? 0;
    const totalPaid = payAgg._sum.amount ?? 0;
    const totalCost = salesAgg._sum.costTotal ?? 0;
    const totalPalletCost = salesAgg._sum.palletTotal ?? 0;
    const factoryPaid = factoryPayAgg._sum.amount ?? 0;

    return {
      totalSales,
      totalProfit,
      totalCubes: salesAgg._sum.cubes ?? 0,
      salesCount: salesAgg._count,
      totalPaid,
      paymentsCount: payAgg._count,
      receivable: totalSales - totalPaid, // clients owe (delivered - paid)
      factoryBalance: (totalCost + totalPalletCost) - factoryPaid, // Завод Остаток
      clientCount,
      agentCount,
      palletBalance: (palletAgg._sum.issuedQty ?? 0) - (palletAgg._sum.returnedQty ?? 0),
    };
  }

  // sales & profit grouped by day
  async salesTrend() {
    const sales = await this.prisma.sale.findMany({ select: { date: true, saleTotal: true, profit: true }, orderBy: { date: 'asc' } });
    const map = new Map<string, { date: string; sales: number; profit: number }>();
    for (const s of sales) {
      const key = s.date.toISOString().slice(0, 10);
      const cur = map.get(key) || { date: key, sales: 0, profit: 0 };
      cur.sales += s.saleTotal;
      cur.profit += s.profit;
      map.set(key, cur);
    }
    return Array.from(map.values());
  }

  // leaderboard by agent
  async agentPerformance() {
    const [sales, pays, agents] = await Promise.all([
      this.prisma.sale.groupBy({ by: ['agentId'], _sum: { saleTotal: true, profit: true }, _count: true }),
      this.prisma.payment.groupBy({ by: ['agentId'], _sum: { amount: true } }),
      this.prisma.agent.findMany(),
    ]);
    const payMap = new Map(pays.map((p) => [p.agentId, p._sum.amount ?? 0]));
    return agents.map((a) => {
      const s = sales.find((x) => x.agentId === a.id);
      return {
        agentId: a.id,
        agent: a.name,
        groupNo: a.groupNo,
        sales: s?._sum.saleTotal ?? 0,
        profit: s?._sum.profit ?? 0,
        deliveries: s?._count ?? 0,
        collected: payMap.get(a.id) ?? 0,
      };
    }).sort((a, b) => b.sales - a.sales);
  }
}
