import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  async findAll(user: any) {
    const where = this.scope(user);
    const clients = await this.prisma.client.findMany({ where, orderBy: { name: 'asc' }, include: { agent: true, region: true } });
    const [ordersByClient, paysByClient] = await Promise.all([
      this.prisma.order.groupBy({ by: ['clientId'], where: { status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { saleTotal: true } }),
      this.prisma.payment.groupBy({ by: ['clientId'], where: { type: 'CLIENT' }, _sum: { amount: true } }),
    ]);
    const oMap = new Map(ordersByClient.map((o) => [o.clientId, o._sum.saleTotal ?? 0]));
    const pMap = new Map(paysByClient.map((p) => [p.clientId, p._sum.amount ?? 0]));
    return clients.map((c) => {
      const delivered = oMap.get(c.id) ?? 0;
      const paid = pMap.get(c.id) ?? 0;
      return { ...c, delivered, paid, balance: delivered - paid }; // positive = client owes us, negative = advance
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id }, include: { agent: true, region: true } });
    if (!client) throw new NotFoundException('Mijoz topilmadi');
    const [orders, payments] = await Promise.all([
      this.prisma.order.findMany({ where: { clientId: id }, orderBy: { date: 'desc' }, include: { product: true, factory: true, vehicle: true } }),
      this.prisma.payment.findMany({ where: { clientId: id, type: 'CLIENT' }, orderBy: { date: 'desc' } }),
    ]);
    const delivered = orders.filter((o) => ['DELIVERED', 'COMPLETED'].includes(o.status)).reduce((s, o) => s + o.saleTotal, 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    return { ...client, orders, payments, totals: { delivered, paid, balance: delivered - paid, ordersCount: orders.length } };
  }

  create(d: any) {
    return this.prisma.client.create({
      data: { name: d.name, legalEntity: d.legalEntity ?? null, phone: d.phone ?? null, regionId: d.regionId || null, agentId: d.agentId || null, creditLimit: Number(d.creditLimit) || 0 },
    });
  }
  update(id: string, d: any) {
    return this.prisma.client.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.legalEntity !== undefined ? { legalEntity: d.legalEntity } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.regionId !== undefined ? { regionId: d.regionId || null } : {}),
        ...(d.agentId !== undefined ? { agentId: d.agentId || null } : {}),
        ...(d.creditLimit !== undefined ? { creditLimit: Number(d.creditLimit) || 0 } : {}),
      },
    });
  }
  remove(id: string) { return this.prisma.client.delete({ where: { id } }); }
}
