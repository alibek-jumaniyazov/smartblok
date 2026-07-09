import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KassaService {
  constructor(private prisma: PrismaService) {}

  async cashboxes() {
    const boxes = await this.prisma.cashbox.findMany({ orderBy: { name: 'asc' } });
    const agg = await this.prisma.cashTransaction.groupBy({ by: ['cashboxId', 'direction'], _sum: { amount: true } });
    return boxes.map((b) => {
      const inSum = agg.find((a) => a.cashboxId === b.id && a.direction === 'IN')?._sum.amount ?? 0;
      const outSum = agg.find((a) => a.cashboxId === b.id && a.direction === 'OUT')?._sum.amount ?? 0;
      return { ...b, inTotal: inSum, outTotal: outSum, balance: inSum - outSum };
    });
  }

  createCashbox(d: any) { return this.prisma.cashbox.create({ data: { name: d.name, type: d.type || 'CASH', currency: d.currency || 'UZS' } }); }

  transactions(cashboxId?: string) {
    return this.prisma.cashTransaction.findMany({ where: cashboxId ? { cashboxId } : {}, orderBy: { date: 'desc' }, take: 200, include: { cashbox: true } });
  }

  createTransaction(d: any) {
    return this.prisma.cashTransaction.create({
      data: { cashboxId: d.cashboxId, direction: d.direction === 'OUT' ? 'OUT' : 'IN', amount: Number(d.amount) || 0, rate: Number(d.rate) || 0, note: d.note ?? null, source: 'MANUAL', date: d.date ? new Date(d.date) : new Date() },
    });
  }

  removeTransaction(id: string) { return this.prisma.cashTransaction.delete({ where: { id } }); }

  async summary() {
    const boxes = await this.cashboxes();
    const uzs = boxes.filter((b) => b.currency === 'UZS').reduce((s, b) => s + b.balance, 0);
    const usd = boxes.filter((b) => b.currency === 'USD').reduce((s, b) => s + b.balance, 0);
    return { boxes, totalUZS: uzs, totalUSD: usd };
  }
}
