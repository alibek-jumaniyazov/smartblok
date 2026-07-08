import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.expense.findMany({ orderBy: { date: 'desc' }, include: { category: true, cashbox: true } });
  }

  async create(dto: any) {
    const amount = Number(dto.amount) || 0;
    // money leaves the cashbox
    if (dto.cashboxId && amount) {
      await this.prisma.cashTransaction.create({
        data: { cashboxId: dto.cashboxId, direction: 'OUT', amount, source: 'EXPENSE', date: dto.date ? new Date(dto.date) : new Date(), note: dto.note ?? 'Xarajat' },
      });
    }
    return this.prisma.expense.create({
      data: {
        date: dto.date ? new Date(dto.date) : new Date(),
        categoryId: dto.categoryId || null,
        amount,
        cashboxId: dto.cashboxId || null,
        note: dto.note ?? null,
      },
      include: { category: true, cashbox: true },
    });
  }

  remove(id: string) { return this.prisma.expense.delete({ where: { id } }); }

  categories() { return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { expenses: true } } } }); }
  createCategory(d: any) { return this.prisma.expenseCategory.create({ data: { name: d.name } }); }
  removeCategory(id: string) { return this.prisma.expenseCategory.delete({ where: { id } }); }

  async summary() {
    const byCat = await this.prisma.expense.groupBy({ by: ['categoryId'], _sum: { amount: true } });
    const total = byCat.reduce((s, c) => s + (c._sum.amount ?? 0), 0);
    return { total };
  }
}
