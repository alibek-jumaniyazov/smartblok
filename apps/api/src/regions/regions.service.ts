import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RegionsService {
  constructor(private prisma: PrismaService) {}
  findAll() { return this.prisma.region.findMany({ orderBy: { name: 'asc' } }); }
  create(d: any) { return this.prisma.region.create({ data: { name: d.name, note: d.note ?? null } }); }
  update(id: string, d: any) { return this.prisma.region.update({ where: { id }, data: d }); }
  remove(id: string) { return this.prisma.region.delete({ where: { id } }); }
}
