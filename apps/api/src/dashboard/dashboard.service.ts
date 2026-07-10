import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DebtsService } from '../debts/debts.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere, roundMoney } from '../common/recognition';

const ACTIVE = ['NEW', 'CONFIRMED', 'LOADING', 'DELIVERING'];

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private debts: DebtsService) {}

  private agentOf(user: any): string | null {
    return user?.role === 'AGENT' && user?.agentId ? (user.agentId as string) : null;
  }

  // Cash balance for one currency only — never mix raw USD units into a UZS total.
  private async cashByCurrency(currency: string) {
    const boxes = await this.prisma.cashbox.findMany({ where: { currency }, select: { id: true } });
    const ids = boxes.map((b) => b.id);
    if (!ids.length) return 0;
    const agg = await this.prisma.cashTransaction.groupBy({ by: ['direction'], where: { cashboxId: { in: ids } }, _sum: { amount: true } });
    const cin = agg.find((a) => a.direction === 'IN')?._sum.amount ?? 0;
    const cout = agg.find((a) => a.direction === 'OUT')?._sum.amount ?? 0;
    return roundMoney(cin - cout);
  }

  // gross owed / gross advance across one agent's own clients
  private async agentClientDebt(agentId: string) {
    const clients = await this.prisma.client.findMany({ where: { agentId }, select: { id: true } });
    const ids = clients.map((c) => c.id);
    if (!ids.length) return { oweUs: 0, advance: 0 };
    const payWhere = await recognizedPaymentWhere(this.prisma, { type: 'CLIENT', clientId: { in: ids } });
    const [ord, pay] = await Promise.all([
      this.prisma.order.groupBy({ by: ['clientId'], where: { ...RECOGNIZED_ORDER, clientId: { in: ids } }, _sum: { saleTotal: true } }),
      this.prisma.payment.groupBy({ by: ['clientId'], where: payWhere, _sum: { amount: true } }),
    ]);
    const oM = new Map(ord.map((o) => [o.clientId, o._sum.saleTotal ?? 0]));
    const pM = new Map(pay.map((p) => [p.clientId, p._sum.amount ?? 0]));
    let oweUs = 0, advance = 0;
    for (const cid of ids) {
      const bal = roundMoney((oM.get(cid) ?? 0) - (pM.get(cid) ?? 0));
      if (bal > 0) oweUs += bal; else advance += -bal;
    }
    return { oweUs, advance };
  }

  async summary(user?: any) {
    const agentId = this.agentOf(user);
    const orderWhere: any = agentId ? { ...RECOGNIZED_ORDER, agentId } : { ...RECOGNIZED_ORDER };
    const activeWhere: any = agentId ? { status: { in: ACTIVE }, agentId } : { status: { in: ACTIVE } };
    const payCliWhere = await recognizedPaymentWhere(this.prisma, agentId ? { type: 'CLIENT', agentId } : { type: 'CLIENT' });

    const [orderAgg, activeAgg, payCli, clientCount, agentCount] = await Promise.all([
      this.prisma.order.aggregate({ where: orderWhere, _sum: { saleTotal: true, costTotal: true, transportFee: true, profit: true, quantity: true }, _count: true }),
      this.prisma.order.count({ where: activeWhere }),
      this.prisma.payment.aggregate({ where: payCliWhere, _sum: { amount: true }, _count: true }),
      agentId ? this.prisma.client.count({ where: { agentId } }) : this.prisma.client.count(),
      agentId ? Promise.resolve(1) : this.prisma.agent.count(),
    ]);

    let clientsDebtToUs = 0, clientsAdvance = 0, weOweFactory = 0, weOweVehicle = 0, cashBalance = 0, cashUSD = 0, totalExpense = 0;
    if (agentId) {
      const d = await this.agentClientDebt(agentId);
      clientsDebtToUs = d.oweUs;
      clientsAdvance = d.advance;
      // company-wide figures (factory/vehicle debt, cash, expenses) are intentionally hidden from agents
    } else {
      const debts = await this.debts.summary();
      clientsDebtToUs = debts.totals.clientsOweUs;
      clientsAdvance = debts.totals.clientsAdvance;
      weOweFactory = debts.totals.weOweFactories;
      weOweVehicle = debts.totals.weOweVehicles;
      cashBalance = await this.cashByCurrency('UZS');
      cashUSD = await this.cashByCurrency('USD');
      totalExpense = roundMoney((await this.prisma.expense.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0);
    }

    return {
      totalSales: roundMoney(orderAgg._sum.saleTotal ?? 0),
      totalProfit: roundMoney(orderAgg._sum.profit ?? 0),
      totalCubes: orderAgg._sum.quantity ?? 0,
      ordersCount: orderAgg._count,
      activeOrders: activeAgg,
      totalPaid: roundMoney(payCli._sum.amount ?? 0),
      paymentsCount: payCli._count,
      clientsDebtToUs,
      clientsAdvance,
      weOweFactory,
      weOweVehicle,
      cashBalance,
      cashUSD,
      clientCount,
      agentCount,
      totalExpense,
      scope: agentId ? 'agent' : 'global',
    };
  }

  async salesTrend(user?: any) {
    const agentId = this.agentOf(user);
    const where: any = agentId ? { ...RECOGNIZED_ORDER, agentId } : { ...RECOGNIZED_ORDER };
    const orders = await this.prisma.order.findMany({ where, select: { date: true, saleTotal: true, profit: true }, orderBy: { date: 'asc' } });
    const map = new Map<string, { date: string; sales: number; profit: number }>();
    for (const o of orders) {
      const key = o.date.toISOString().slice(0, 10);
      const cur = map.get(key) || { date: key, sales: 0, profit: 0 };
      cur.sales += o.saleTotal; cur.profit += o.profit; map.set(key, cur);
    }
    return Array.from(map.values());
  }

  async agentPerformance(user?: any) {
    const agentId = this.agentOf(user);
    // an agent only ever sees their own row — no peeking at rival agents
    const agentFilter = agentId ? { id: agentId } : {};
    const orderFilter: any = agentId ? { ...RECOGNIZED_ORDER, agentId } : { ...RECOGNIZED_ORDER };
    const payWhere = await recognizedPaymentWhere(this.prisma, agentId ? { type: 'CLIENT', agentId } : { type: 'CLIENT' });
    const [orders, pays, agents] = await Promise.all([
      this.prisma.order.groupBy({ by: ['agentId'], where: orderFilter, _sum: { saleTotal: true, profit: true }, _count: true }),
      this.prisma.payment.groupBy({ by: ['agentId'], where: payWhere, _sum: { amount: true } }),
      this.prisma.agent.findMany({ where: agentFilter }),
    ]);
    const payMap = new Map(pays.map((p) => [p.agentId, p._sum.amount ?? 0]));
    return agents.map((a) => {
      const s = orders.find((x) => x.agentId === a.id);
      return { agentId: a.id, agent: a.name, groupNo: a.groupNo, sales: roundMoney(s?._sum.saleTotal ?? 0), profit: roundMoney(s?._sum.profit ?? 0), deliveries: s?._count ?? 0, collected: roundMoney(payMap.get(a.id) ?? 0) };
    }).sort((a, b) => b.sales - a.sales);
  }

  // count of orders per status (funnel) — scoped to the agent for agent logins
  async orderFunnel(user?: any) {
    const agentId = this.agentOf(user);
    const g = await this.prisma.order.groupBy({ by: ['status'], where: agentId ? { agentId } : {}, _count: true });
    return g.map((x) => ({ status: x.status, count: x._count }));
  }
}
