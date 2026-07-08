import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KassaService {
  constructor(private prisma: PrismaService) {}

  async cashboxes() {
    const boxes = await this.prisma.cashbox.findMany({ orderBy: { id: 'asc' } });
    const agg = await this.prisma.cashTransaction.groupBy({
      by: ['cashboxId', 'direction'],
      _sum: { amount: true },
    });
    return boxes.map((b) => {
      const inSum = agg.find((a) => a.cashboxId === b.id && a.direction === 'IN')?._sum.amount ?? 0;
      const outSum = agg.find((a) => a.cashboxId === b.id && a.direction === 'OUT')?._sum.amount ?? 0;
      return { ...b, inTotal: inSum, outTotal: outSum, balance: inSum - outSum };
    });
  }

  createCashbox(dto: any) {
    return this.prisma.cashbox.create({
      data: {
        name: dto.name,
        type: dto.type || 'CASH',
        currency: dto.currency || 'UZS',
      },
    });
  }

  transactions(cashboxId?: number) {
    return this.prisma.cashTransaction.findMany({
      where: cashboxId ? { cashboxId } : {},
      orderBy: { date: 'desc' },
      take: 200,
      include: { cashbox: true },
    });
  }

  createTransaction(dto: any) {
    return this.prisma.cashTransaction.create({
      data: {
        cashboxId: Number(dto.cashboxId),
        direction: dto.direction === 'OUT' ? 'OUT' : 'IN',
        amount: Number(dto.amount) || 0,
        rate: Number(dto.rate) || 0,
        note: dto.note ?? null,
        source: 'MANUAL',
        date: dto.date ? new Date(dto.date) : new Date(),
      },
    });
  }

  removeTransaction(id: number) {
    return this.prisma.cashTransaction.delete({ where: { id } });
  }

  async summary() {
    const boxes = await this.cashboxes();
    const uzs = boxes.filter((b) => b.currency === 'UZS').reduce((s, b) => s + b.balance, 0);
    const usd = boxes.filter((b) => b.currency === 'USD').reduce((s, b) => s + b.balance, 0);
    return { boxes, totalUZS: uzs, totalUSD: usd };
  }
}
