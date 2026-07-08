import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const agents = await this.prisma.agent.findMany({
      orderBy: { groupNo: 'asc' },
      include: { _count: { select: { clients: true, orders: true, payments: true } }, users: { select: { id: true, username: true } } },
    });
    const [salesByAgent, paysByAgent] = await Promise.all([
      this.prisma.order.groupBy({ by: ['agentId'], where: { status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { saleTotal: true, profit: true } }),
      this.prisma.payment.groupBy({ by: ['agentId'], where: { type: 'CLIENT' }, _sum: { amount: true } }),
    ]);
    const sMap = new Map(salesByAgent.map((s) => [s.agentId, s._sum]));
    const pMap = new Map(paysByAgent.map((p) => [p.agentId, p._sum.amount ?? 0]));
    return agents.map((a) => ({
      ...a,
      sales: sMap.get(a.id)?.saleTotal ?? 0,
      profit: sMap.get(a.id)?.profit ?? 0,
      collected: pMap.get(a.id) ?? 0,
    }));
  }

  async findOne(id: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id }, include: { clients: true, users: { select: { id: true, username: true, active: true } } } });
    if (!agent) throw new NotFoundException('Agent topilmadi');
    return agent;
  }

  // Creating an agent also creates a linked login user (role AGENT).
  async create(d: any) {
    const agent = await this.prisma.agent.create({
      data: { name: d.name, phone: d.phone ?? null, groupNo: d.groupNo ? Number(d.groupNo) : null },
    });
    if (d.createUser !== false) {
      const base = (d.username || d.name || 'agent').toString().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'agent';
      let username = base;
      let i = 1;
      while (await this.prisma.user.findUnique({ where: { username } })) username = base + i++;
      const password = await bcrypt.hash(d.password || 'agent123', 10);
      await this.prisma.user.create({
        data: { username, name: d.name, role: 'AGENT', phone: d.phone ?? null, password, agentId: agent.id },
      });
      return { ...agent, createdUsername: username, defaultPassword: d.password ? undefined : 'agent123' };
    }
    return agent;
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

  remove(id: string) { return this.prisma.agent.delete({ where: { id } }); }
}
