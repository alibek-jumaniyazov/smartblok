import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RegionsService {
  constructor(private prisma: PrismaService) {}
  findAll() { return this.prisma.region.findMany({ orderBy: { name: 'asc' } }); }
  create(data: any) { return this.prisma.region.create({ data }); }
  update(id: number, data: any) { return this.prisma.region.update({ where: { id }, data }); }
  remove(id: number) { return this.prisma.region.delete({ where: { id } }); }
}
