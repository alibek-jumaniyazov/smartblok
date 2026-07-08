import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // Client account statement (two-sided): payments vs deliveries + running balance
  async clientStatement(clientId: number) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { agent: true, region: true },
    });
    if (!client) throw new NotFoundException('Mijoz topilmadi');

    const [sales, payments, pallets] = await Promise.all([
      this.prisma.sale.findMany({ where: { clientId }, orderBy: { date: 'asc' }, include: { blockSize: true } }),
      this.prisma.payment.findMany({ where: { clientId }, orderBy: { date: 'asc' } }),
      this.prisma.palletMovement.groupBy({ by: ['clientId'], where: { clientId }, _sum: { issuedQty: true, returnedQty: true } }),
    ]);

    const deliveries = sales.map((s) => ({
      id: s.id, date: s.date, plate: s.plate, size: s.blockSize?.name ?? null,
      cubes: s.cubes, palletQty: s.palletQty, salePricePerM3: s.salePricePerM3, amount: s.saleTotal,
    }));
    const pays = payments.map((p) => ({
      id: p.id, date: p.date, method: p.method, payerName: p.payerName, amount: p.amount, note: p.note,
    }));

    const totalDelivered = deliveries.reduce((s, d) => s + d.amount, 0);
    const totalPaid = pays.reduce((s, p) => s + p.amount, 0);
    const pal = pallets[0]?._sum;

    return {
      client,
      deliveries,
      payments: pays,
      totals: {
        delivered: totalDelivered,
        paid: totalPaid,
        balance: totalPaid - totalDelivered, // negative = qarzdor
        palletBalance: (pal?.issuedQty ?? 0) - (pal?.returnedQty ?? 0),
      },
    };
  }

  // Свод Завод: per-agent roll-up + factory reconciliation
  async svod() {
    const [salesByAgent, paysByAgent, agents, salesAgg, factoryPayAgg] = await Promise.all([
      this.prisma.sale.groupBy({ by: ['agentId'], _sum: { saleTotal: true, costTotal: true, palletTotal: true, profit: true } }),
      this.prisma.payment.groupBy({ by: ['agentId'], _sum: { amount: true } }),
      this.prisma.agent.findMany({ orderBy: { groupNo: 'asc' } }),
      this.prisma.sale.aggregate({ _sum: { saleTotal: true, costTotal: true, palletTotal: true, profit: true } }),
      this.prisma.factoryPayment.aggregate({ _sum: { amount: true } }),
    ]);

    const payMap = new Map(paysByAgent.map((p) => [p.agentId, p._sum.amount ?? 0]));
    const perAgent = agents.map((a) => {
      const s = salesByAgent.find((x) => x.agentId === a.id)?._sum;
      const delivered = s?.saleTotal ?? 0;
      const paid = payMap.get(a.id) ?? 0;
      return {
        agentId: a.id, agent: a.name, groupNo: a.groupNo,
        delivered, paid, balance: paid - delivered, profit: s?.profit ?? 0,
      };
    });

    const goodsCost = (salesAgg._sum.costTotal ?? 0) + (salesAgg._sum.palletTotal ?? 0);
    const factoryPaid = factoryPayAgg._sum.amount ?? 0;

    return {
      perAgent,
      totals: {
        totalGoods: salesAgg._sum.saleTotal ?? 0,
        totalCost: salesAgg._sum.costTotal ?? 0,
        totalPalletCost: salesAgg._sum.palletTotal ?? 0,
        totalProfit: salesAgg._sum.profit ?? 0,
        factoryPaid,
        factoryBalance: goodsCost - factoryPaid, // Завод Остаток
      },
    };
  }
}
