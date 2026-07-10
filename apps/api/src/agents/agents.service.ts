import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere, roundMoney } from '../common/recognition';

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const payWhere = await recognizedPaymentWhere(this.prisma, { type: 'CLIENT' });
    const agents = await this.prisma.agent.findMany({
      orderBy: { groupNo: 'asc' },
      include: { _count: { select: { clients: true, orders: true, payments: true } }, users: { select: { id: true, username: true } } },
    });
    const [salesByAgent, paysByAgent] = await Promise.all([
      this.prisma.order.groupBy({ by: ['agentId'], where: RECOGNIZED_ORDER, _sum: { saleTotal: true, profit: true } }),
      this.prisma.payment.groupBy({ by: ['agentId'], where: payWhere, _sum: { amount: true } }),
    ]);
    const sMap = new Map(salesByAgent.map((s) => [s.agentId, s._sum]));
    const pMap = new Map(paysByAgent.map((p) => [p.agentId, p._sum.amount ?? 0]));
    return agents.map((a) => ({
      ...a,
      sales: roundMoney(sMap.get(a.id)?.saleTotal ?? 0),
      profit: roundMoney(sMap.get(a.id)?.profit ?? 0),
      collected: roundMoney(pMap.get(a.id) ?? 0),
    }));
  }

  async findOne(id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: { clients: { orderBy: { name: 'asc' } }, users: { select: { id: true, username: true, active: true } } },
    });
    if (!agent) throw new NotFoundException('Agent topilmadi');

    const clientIds = agent.clients.map((c) => c.id);
    const payAgentWhere = await recognizedPaymentWhere(this.prisma, { agentId: id, type: 'CLIENT' });
    const payClientsWhere = await recognizedPaymentWhere(this.prisma, { clientId: { in: clientIds }, type: 'CLIENT' });
    const [orders, collectedAgg, deliveredByClient, paidByClient] = await Promise.all([
      this.prisma.order.findMany({ where: { agentId: id }, orderBy: { date: 'desc' }, include: { client: true, product: true, factory: true, vehicle: true } }),
      this.prisma.payment.aggregate({ where: payAgentWhere, _sum: { amount: true } }),
      this.prisma.order.groupBy({ by: ['clientId'], where: { clientId: { in: clientIds }, ...RECOGNIZED_ORDER }, _sum: { saleTotal: true } }),
      this.prisma.payment.groupBy({ by: ['clientId'], where: payClientsWhere, _sum: { amount: true } }),
    ]);

    const active = orders.filter((o) => o.status !== 'CANCELLED');
    const sales = roundMoney(active.reduce((s, o) => s + o.saleTotal, 0));
    const profit = roundMoney(active.reduce((s, o) => s + o.profit, 0));
    const collected = roundMoney(collectedAgg._sum.amount ?? 0);

    // outstanding = how much this agent's clients still owe us (sum of positive client balances)
    const dMap = new Map(deliveredByClient.map((d) => [d.clientId, d._sum.saleTotal ?? 0]));
    const pMap = new Map(paidByClient.map((p) => [p.clientId, p._sum.amount ?? 0]));
    const outstanding = clientIds.reduce((s, cid) => s + Math.max(0, roundMoney((dMap.get(cid) ?? 0) - (pMap.get(cid) ?? 0))), 0);
    const advance = clientIds.reduce((s, cid) => s + Math.max(0, roundMoney((pMap.get(cid) ?? 0) - (dMap.get(cid) ?? 0))), 0);

    return { ...agent, orders, totals: { sales, profit, collected, outstanding, advance, ordersCount: orders.length, clientsCount: clientIds.length } };
  }

  // Creating an agent also creates a linked login user (role AGENT) — atomically.
  async create(d: any) {
    let username: string | undefined;
    if (d.createUser !== false) {
      const base = (d.username || d.name || 'agent').toString().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'agent';
      username = base;
      let i = 1;
      while (await this.prisma.user.findUnique({ where: { username } })) username = base + i++;
    }
    const password = username ? await bcrypt.hash(d.password || 'agent123', 10) : '';

    return this.prisma.$transaction(async (tx) => {
      const agent = await tx.agent.create({
        data: { name: d.name, phone: d.phone ?? null, groupNo: d.groupNo ? Number(d.groupNo) : null },
      });
      if (username) {
        await tx.user.create({
          data: { username, name: d.name, role: 'AGENT', phone: d.phone ?? null, password, agentId: agent.id },
        });
        return { ...agent, createdUsername: username, defaultPassword: d.password ? undefined : 'agent123' };
      }
      return agent;
    });
  }

  update(id: string, d: any) {
    return this.prisma.agent.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.groupNo !== undefined ? { groupNo: d.groupNo ? Number(d.groupNo) : null } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
      },
    });
  }

  // block deletion when the agent has clients/orders/payments — deactivate instead
  async remove(id: string) {
    const [clients, orders, payments] = await Promise.all([
      this.prisma.client.count({ where: { agentId: id } }),
      this.prisma.order.count({ where: { agentId: id } }),
      this.prisma.payment.count({ where: { agentId: id } }),
    ]);
    if (clients > 0 || orders > 0 || payments > 0) {
      throw new BadRequestException('Agentda mijoz/buyurtma/to‘lov bor — o‘chirib bo‘lmaydi. Nofaol qiling.');
    }
    // detach any linked login user, then remove the agent
    return this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { agentId: id }, data: { agentId: null, active: false } });
      return tx.agent.delete({ where: { id } });
    });
  }
}
