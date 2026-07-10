import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere, roundMoney } from '../common/recognition';

@Injectable()
export class FactoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const payWhere = await recognizedPaymentWhere(this.prisma, { type: 'FACTORY' });
    const factories = await this.prisma.factory.findMany({
      orderBy: { name: 'asc' },
      include: { products: true, _count: { select: { orders: true, products: true } } },
    });
    const [costByFactory, paysByFactory] = await Promise.all([
      this.prisma.order.groupBy({ by: ['factoryId'], where: RECOGNIZED_ORDER, _sum: { costTotal: true } }),
      this.prisma.payment.groupBy({ by: ['factoryId'], where: payWhere, _sum: { amount: true } }),
    ]);
    const cMap = new Map(costByFactory.map((c) => [c.factoryId, c._sum.costTotal ?? 0]));
    const pMap = new Map(paysByFactory.map((p) => [p.factoryId, p._sum.amount ?? 0]));
    return factories.map((f) => {
      const cost = cMap.get(f.id) ?? 0;
      const paid = pMap.get(f.id) ?? 0;
      return { ...f, costTotal: cost, paid, balance: roundMoney(cost - paid) };
    });
  }

  async findOne(id: string) {
    const factory = await this.prisma.factory.findUnique({
      where: { id },
      include: { products: { orderBy: { name: 'asc' } }, prices: true, routes: { include: { region: true } } },
    });
    if (!factory) return null;
    const [orders, payments] = await Promise.all([
      this.prisma.order.findMany({ where: { factoryId: id }, orderBy: { date: 'desc' }, include: { client: true, product: true, vehicle: true } }),
      this.prisma.payment.findMany({ where: { factoryId: id, type: 'FACTORY' }, orderBy: { date: 'desc' }, include: { cashbox: true } }),
    ]);
    const cancelled = new Set(orders.filter((o) => o.status === 'CANCELLED').map((o) => o.id));
    const cost = orders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.costTotal, 0);
    const paid = payments.filter((p) => !p.orderId || !cancelled.has(p.orderId)).reduce((s, p) => s + p.amount, 0);
    // balance > 0 → we owe the factory; balance < 0 → we prepaid (our advance to them)
    return { ...factory, orders, payments, totals: { cost, paid, balance: roundMoney(cost - paid), ordersCount: orders.length } };
  }
  create(d: any) { return this.prisma.factory.create({ data: { name: d.name, note: d.note ?? null } }); }
  update(id: string, d: any) {
    const data: any = {};
    if (d.name !== undefined) data.name = d.name;
    if (d.note !== undefined) data.note = d.note;
    if (d.active !== undefined) data.active = !!d.active;
    return this.prisma.factory.update({ where: { id }, data });
  }
  // block deletion when history exists — deactivate (active=false) instead
  async remove(id: string) {
    const [orders, payments, products] = await Promise.all([
      this.prisma.order.count({ where: { factoryId: id } }),
      this.prisma.payment.count({ where: { factoryId: id } }),
      this.prisma.product.count({ where: { factoryId: id } }),
    ]);
    if (orders > 0 || payments > 0 || products > 0) {
      throw new BadRequestException('Zavodda buyurtma/to‘lov/mahsulot bor — o‘chirib bo‘lmaydi. Nofaol qiling.');
    }
    return this.prisma.factory.delete({ where: { id } });
  }
}
