import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DELIVERED = { status: { in: ['DELIVERED', 'COMPLETED'] } };

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async svod() {
    const [byAgent, paysByAgent, agents, orderAgg, facPay] = await Promise.all([
      this.prisma.order.groupBy({ by: ['agentId'], where: DELIVERED, _sum: { saleTotal: true, costTotal: true, profit: true } }),
      this.prisma.payment.groupBy({ by: ['agentId'], where: { type: 'CLIENT' }, _sum: { amount: true } }),
      this.prisma.agent.findMany({ orderBy: { groupNo: 'asc' } }),
      this.prisma.order.aggregate({ where: DELIVERED, _sum: { saleTotal: true, costTotal: true, profit: true, transportFee: true } }),
      this.prisma.payment.aggregate({ where: { type: 'FACTORY' }, _sum: { amount: true } }),
    ]);
    const payMap = new Map(paysByAgent.map((p) => [p.agentId, p._sum.amount ?? 0]));
    const perAgent = agents.map((a) => {
      const s = byAgent.find((x) => x.agentId === a.id)?._sum;
      const delivered = s?.saleTotal ?? 0;
      const paid = payMap.get(a.id) ?? 0;
      return { agentId: a.id, agent: a.name, groupNo: a.groupNo, delivered, paid, balance: delivered - paid, profit: s?.profit ?? 0 };
    });
    const goodsCost = orderAgg._sum.costTotal ?? 0;
    const factoryPaid = facPay._sum.amount ?? 0;
    return {
      perAgent,
      totals: {
        totalGoods: orderAgg._sum.saleTotal ?? 0,
        totalCost: goodsCost,
        totalProfit: orderAgg._sum.profit ?? 0,
        factoryPaid,
        factoryBalance: goodsCost - factoryPaid,
      },
    };
  }
}
