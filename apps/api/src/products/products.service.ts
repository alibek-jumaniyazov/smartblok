import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}
  findAll(q: any = {}) {
    const where: any = {};
    if (q.factoryId) where.factoryId = q.factoryId;
    return this.prisma.product.findMany({ where, orderBy: { name: 'asc' }, include: { factory: true, _count: { select: { orders: true } } } });
  }
  create(d: any) {
    return this.prisma.product.create({
      data: {
        factoryId: d.factoryId,
        name: d.name,
        size: d.size ?? null,
        unit: d.unit || 'm3',
        costPrice: Number(d.costPrice) || 0,
        salePrice: Number(d.salePrice) || 0,
      },
    });
  }
  update(id: string, d: any) {
    const data: any = {};
    for (const k of ['factoryId', 'name', 'size', 'unit', 'active']) if (d[k] !== undefined) data[k] = d[k];
    if (d.costPrice !== undefined) data.costPrice = Number(d.costPrice) || 0;
    if (d.salePrice !== undefined) data.salePrice = Number(d.salePrice) || 0;
    return this.prisma.product.update({ where: { id }, data });
  }
  remove(id: string) { return this.prisma.product.delete({ where: { id } }); }
}
