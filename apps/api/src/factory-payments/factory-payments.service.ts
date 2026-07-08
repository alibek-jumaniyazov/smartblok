import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FactoryPaymentsService {
  constructor(private prisma: PrismaService) {}
  findAll() {
    return this.prisma.factoryPayment.findMany({ orderBy: { date: 'desc' }, include: { factory: true } });
  }
  create(dto: any) {
    return this.prisma.factoryPayment.create({
      data: {
        date: new Date(dto.date),
        factoryId: dto.factoryId ? Number(dto.factoryId) : null,
        amount: Number(dto.amount) || 0,
        payer: dto.payer ?? null,
        recipient: dto.recipient ?? null,
        note: dto.note ?? null,
      },
    });
  }
  remove(id: number) { return this.prisma.factoryPayment.delete({ where: { id } }); }
}
