import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FactoriesService {
  constructor(private prisma: PrismaService) {}
  findAll() {
    return this.prisma.factory.findMany({
      orderBy: { name: 'asc' },
      include: { prices: true, routes: { include: { region: true } } },
    });
  }
  create(data: any) { return this.prisma.factory.create({ data }); }
  update(id: number, data: any) { return this.prisma.factory.update({ where: { id }, data }); }
  remove(id: number) { return this.prisma.factory.delete({ where: { id } }); }
}
