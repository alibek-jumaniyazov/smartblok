import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
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

  // Manual kassa entry: validate the cashbox exists/active, require a positive amount, and make
  // sure a USD box entry carries an exchange rate so raw dollars are never mistaken for soms.
  async createTransaction(d: any) {
    if (!d.cashboxId) throw new BadRequestException('Kassa majburiy');
    const box = await this.prisma.cashbox.findUnique({ where: { id: d.cashboxId } });
    if (!box) throw new NotFoundException('Kassa topilmadi');
    if (!box.active) throw new BadRequestException('Kassa faol emas');
    const amount = Number(d.amount) || 0;
    if (amount <= 0) throw new BadRequestException('Summa 0 dan katta bolishi kerak');
    const rate = Number(d.rate) || 0;
    if (box.currency === 'USD' && rate <= 0) {
      throw new BadRequestException('Dollar kassasi uchun kurs (rate) kiritilishi shart');
    }
    return this.prisma.cashTransaction.create({
      data: {
        cashboxId: d.cashboxId,
        direction: d.direction === 'OUT' ? 'OUT' : 'IN',
        amount,
        rate,
        note: d.note ?? null,
        source: 'MANUAL',
        date: d.date ? new Date(d.date) : new Date(),
      },
    });
  }

  // Only MANUAL rows may be deleted here. PAYMENT/EXPENSE rows mirror a Payment/Expense; deleting
  // them from the journal would drop cash while the debt reduction survived — cancel the parent instead.
  async removeTransaction(id: string) {
    const row = await this.prisma.cashTransaction.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Tranzaksiya topilmadi');
    if (row.source !== 'MANUAL') {
      throw new BadRequestException(
        "Bu yozuv to'lov yoki xarajatdan kelib chiqqan — uni shu yerdan o'chirib bo'lmaydi. Tegishli to'lov/xarajatni bekor qiling.",
      );
    }
    return this.prisma.cashTransaction.delete({ where: { id } });
  }

  async summary() {
    const boxes = await this.cashboxes();
    const uzs = boxes.filter((b) => b.currency === 'UZS').reduce((s, b) => s + b.balance, 0);
    const usd = boxes.filter((b) => b.currency === 'USD').reduce((s, b) => s + b.balance, 0);
    return { boxes, totalUZS: uzs, totalUSD: usd };
  }
}
