import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlockSizesService {
  constructor(private prisma: PrismaService) {}
  findAll() { return this.prisma.blockSize.findMany({ orderBy: { name: 'asc' } }); }
  create(data: any) { return this.prisma.blockSize.create({ data }); }
  update(id: number, data: any) { return this.prisma.blockSize.update({ where: { id }, data }); }
  remove(id: number) { return this.prisma.blockSize.delete({ where: { id } }); }
}
