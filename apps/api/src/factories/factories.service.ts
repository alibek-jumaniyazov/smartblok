import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FactoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const factories = await this.prisma.factory.findMany({
      orderBy: { name: 'asc' },
      include: { products: true, _count: { select: { orders: true, products: true } } },
    });
    const [costByFactory, paysByFactory] = await Promise.all([
      this.prisma.order.groupBy({ by: ['factoryId'], where: { status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { costTotal: true } }),
      this.prisma.payment.groupBy({ by: ['factoryId'], where: { type: 'FACTORY' }, _sum: { amount: true } }),
    ]);
    const cMap = new Map(costByFactory.map((c) => [c.factoryId, c._sum.costTotal ?? 0]));
    const pMap = new Map(paysByFactory.map((p) => [p.factoryId, p._sum.amount ?? 0]));
    return factories.map((f) => {
      const cost = cMap.get(f.id) ?? 0;
      const paid = pMap.get(f.id) ?? 0;
      return { ...f, costTotal: cost, paid, balance: cost - paid };
    });
  }

  findOne(id: string) { return this.prisma.factory.findUnique({ where: { id }, include: { products: true, prices: true, routes: { include: { region: true } } } }); }
  create(d: any) { return this.prisma.factory.create({ data: { name: d.name, note: d.note ?? null } }); }
  update(id: string, d: any) { return this.prisma.factory.update({ where: { id }, data: d }); }
  remove(id: string) { return this.prisma.factory.delete({ where: { id } }); }
}
