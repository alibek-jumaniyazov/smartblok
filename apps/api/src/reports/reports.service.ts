import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere, roundMoney } from '../common/recognition';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async svod() {
    const [payAgentWhere, payFacWhere] = await Promise.all([
      recognizedPaymentWhere(this.prisma, { type: 'CLIENT' }),
      recognizedPaymentWhere(this.prisma, { type: 'FACTORY' }),
    ]);
    const [byAgent, paysByAgent, agents, orderAgg, facPay] = await Promise.all([
      this.prisma.order.groupBy({ by: ['agentId'], where: RECOGNIZED_ORDER, _sum: { saleTotal: true, costTotal: true, profit: true } }),
      this.prisma.payment.groupBy({ by: ['agentId'], where: payAgentWhere, _sum: { amount: true } }),
      this.prisma.agent.findMany({ orderBy: { groupNo: 'asc' } }),
      this.prisma.order.aggregate({ where: RECOGNIZED_ORDER, _sum: { saleTotal: true, costTotal: true, profit: true, transportFee: true } }),
      this.prisma.payment.aggregate({ where: payFacWhere, _sum: { amount: true } }),
    ]);
    const payMap = new Map(paysByAgent.map((p) => [p.agentId, p._sum.amount ?? 0]));
    const perAgent = agents.map((a) => {
      const s = byAgent.find((x) => x.agentId === a.id)?._sum;
      const delivered = s?.saleTotal ?? 0;
      const paid = payMap.get(a.id) ?? 0;
      return { agentId: a.id, agent: a.name, groupNo: a.groupNo, delivered: roundMoney(delivered), paid: roundMoney(paid), balance: roundMoney(delivered - paid), profit: roundMoney(s?.profit ?? 0) };
    });
    const goodsCost = orderAgg._sum.costTotal ?? 0;
    const factoryPaid = facPay._sum.amount ?? 0;
    return {
      perAgent,
      totals: {
        totalGoods: roundMoney(orderAgg._sum.saleTotal ?? 0),
        totalCost: roundMoney(goodsCost),
        totalProfit: roundMoney(orderAgg._sum.profit ?? 0),
        factoryPaid: roundMoney(factoryPaid),
        factoryBalance: roundMoney(goodsCost - factoryPaid),
      },
    };
  }
}
