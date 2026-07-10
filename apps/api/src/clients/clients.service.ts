import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere, roundMoney } from '../common/recognition';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  async findAll(user: any) {
    const where = this.scope(user);
    const payWhere = await recognizedPaymentWhere(this.prisma, { type: 'CLIENT' });
    const clients = await this.prisma.client.findMany({ where, orderBy: { name: 'asc' }, include: { agent: true, region: true } });
    const [ordersByClient, paysByClient] = await Promise.all([
      this.prisma.order.groupBy({ by: ['clientId'], where: RECOGNIZED_ORDER, _sum: { saleTotal: true } }),
      this.prisma.payment.groupBy({ by: ['clientId'], where: payWhere, _sum: { amount: true } }),
    ]);
    const oMap = new Map(ordersByClient.map((o) => [o.clientId, o._sum.saleTotal ?? 0]));
    const pMap = new Map(paysByClient.map((p) => [p.clientId, p._sum.amount ?? 0]));
    return clients.map((c) => {
      const delivered = oMap.get(c.id) ?? 0;
      const paid = pMap.get(c.id) ?? 0;
      return { ...c, delivered, paid, balance: roundMoney(delivered - paid) }; // positive = client owes us, negative = advance
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id }, include: { agent: true, region: true } });
    if (!client) throw new NotFoundException('Mijoz topilmadi');
    const [orders, payments] = await Promise.all([
      this.prisma.order.findMany({ where: { clientId: id }, orderBy: { date: 'desc' }, include: { product: true, factory: true, vehicle: true } }),
      this.prisma.payment.findMany({ where: { clientId: id, type: 'CLIENT' }, orderBy: { date: 'desc' } }),
    ]);
    const cancelled = new Set(orders.filter((o) => o.status === 'CANCELLED').map((o) => o.id));
    const delivered = orders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.saleTotal, 0);
    const paid = payments.filter((p) => !p.orderId || !cancelled.has(p.orderId)).reduce((s, p) => s + p.amount, 0);
    return { ...client, orders, payments, totals: { delivered, paid, balance: roundMoney(delivered - paid), ordersCount: orders.length } };
  }

  create(d: any, user?: any) {
    // an AGENT only ever creates clients under their own agent id; others must pick one
    const agentId = user?.role === 'AGENT' && user?.agentId ? user.agentId : (d.agentId || null);
    if (!agentId) throw new BadRequestException('Mijoz agentga bog‘lanishi shart — agent tanlang');
    return this.prisma.client.create({
      data: { name: d.name, legalEntity: d.legalEntity ?? null, phone: d.phone ?? null, regionId: d.regionId || null, agentId, creditLimit: Number(d.creditLimit) || 0 },
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
  // block deletion when history exists so orders/payments never orphan into phantom balances
  async remove(id: string) {
    const [orders, payments] = await Promise.all([
      this.prisma.order.count({ where: { clientId: id } }),
      this.prisma.payment.count({ where: { clientId: id } }),
    ]);
    if (orders > 0 || payments > 0) {
      throw new BadRequestException('Mijozda buyurtma yoki to‘lov tarixi bor — o‘chirib bo‘lmaydi');
    }
    return this.prisma.client.delete({ where: { id } });
  }
}
