import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.expense.findMany({ orderBy: { date: 'desc' }, include: { category: true, cashbox: true } });
  }

  async create(dto: any) {
    const amount = Number(dto.amount) || 0;
    if (!amount || amount <= 0) throw new BadRequestException("Xarajat summasi 0 dan katta bo'lishi kerak");
    if (!dto.categoryId) throw new BadRequestException('Xarajat kategoriyasi majburiy');
    if (!dto.cashboxId) throw new BadRequestException("Kassa majburiy — pul qaysi kassadan chiqishini tanlang");
    const date = dto.date ? new Date(dto.date) : new Date();

    // expense + kassa OUT entry are written together so the ledger can never drift
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: { date, categoryId: dto.categoryId, amount, cashboxId: dto.cashboxId, note: dto.note ?? null },
        include: { category: true, cashbox: true },
      });
      await tx.cashTransaction.create({
        data: {
          cashboxId: dto.cashboxId, direction: 'OUT', amount, source: 'EXPENSE',
          date, note: dto.note ?? 'Xarajat', expenseId: expense.id,
        },
      });
      return expense;
    });
  }

  // deleting an expense also reverses its kassa entry
  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.cashTransaction.deleteMany({ where: { expenseId: id } });
      return tx.expense.delete({ where: { id } });
    });
  }

  categories() { return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { expenses: true } } } }); }
  createCategory(d: any) { return this.prisma.expenseCategory.create({ data: { name: d.name } }); }
  removeCategory(id: string) { return this.prisma.expenseCategory.delete({ where: { id } }); }

  async summary() {
    const byCat = await this.prisma.expense.groupBy({ by: ['categoryId'], _sum: { amount: true } });
    const total = byCat.reduce((s, c) => s + (c._sum.amount ?? 0), 0);
    return { total };
  }
}
