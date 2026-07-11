import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CashDirection, CashSource, Currency, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { assertPositiveMoney, D, ZERO } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { RequestUser } from '../common/scoping';
import { CreateExpenseDto, ExpenseCategoryDto, ExpensesQueryDto, VoidExpenseDto } from './dto';

const dayStart = (s: string): Date => new Date(s);

/** Date-only strings are inclusive through the whole day (same UTC basis as dayStart). */
const dayEnd = (s: string): Date => {
  const d = new Date(s);
  if (!s.includes('T')) d.setTime(d.getTime() + 86_400_000 - 1);
  return d;
};

const positiveMoney = (value: Prisma.Decimal.Value, field: string): Prisma.Decimal => {
  try {
    return assertPositiveMoney(value, field);
  } catch (e) {
    throw new BadRequestException(e instanceof Error ? e.message : String(e));
  }
};

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async boxBalance(db: Prisma.TransactionClient, cashboxId: string): Promise<Prisma.Decimal> {
    const agg = await db.cashTransaction.groupBy({
      by: ['direction'],
      where: { cashboxId },
      _sum: { amount: true },
    });
    let balance = ZERO;
    for (const row of agg) {
      const amount = D(row._sum.amount ?? 0);
      balance = row.direction === CashDirection.IN ? balance.plus(amount) : balance.minus(amount);
    }
    return balance;
  }

  async findAll(q: ExpensesQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.ExpenseWhereInput = {
      ...(q.includeVoided === 'true' ? {} : { voidedAt: null }),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.cashboxId ? { cashboxId: q.cashboxId } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            date: {
              ...(q.dateFrom ? { gte: dayStart(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: dayEnd(q.dateTo) } : {}),
            },
          }
        : {}),
      ...(q.search ? { note: { contains: q.search, mode: 'insensitive' as Prisma.QueryMode } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          category: { select: { id: true, name: true } },
          cashbox: { select: { id: true, name: true, currency: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.expense.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  /** Expense + kassa OUT row written atomically; the cashbox must be an active UZS box with sufficient balance. */
  async create(dto: CreateExpenseDto, user: RequestUser) {
    const amount = positiveMoney(dto.amount, 'amount');
    const date = new Date(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const box = await tx.cashbox.findUnique({ where: { id: dto.cashboxId } });
      if (!box) throw new NotFoundException('Kassa topilmadi');
      if (!box.active) throw new BadRequestException('Kassa faol emas');
      if (box.currency !== Currency.UZS) {
        throw new BadRequestException("Xarajat faqat so'm (UZS) kassasidan chiqarilishi mumkin");
      }
      if (dto.categoryId) {
        const category = await tx.expenseCategory.findUnique({ where: { id: dto.categoryId } });
        if (!category) throw new BadRequestException('Xarajat kategoriyasi topilmadi');
      }
      const balance = await this.boxBalance(tx, box.id);
      if (balance.minus(amount).isNegative()) {
        throw new BadRequestException(
          `Kassada mablag' yetarli emas: joriy qoldiq ${balance.toFixed(2)} UZS, xarajat ${amount.toFixed(2)} UZS`,
        );
      }
      const expense = await tx.expense.create({
        data: {
          date,
          amount,
          categoryId: dto.categoryId ?? null,
          cashboxId: box.id,
          note: dto.note ?? null,
          createdById: user.userId,
        },
        include: {
          category: { select: { id: true, name: true } },
          cashbox: { select: { id: true, name: true, currency: true } },
        },
      });
      await tx.cashTransaction.create({
        data: {
          cashboxId: box.id,
          direction: CashDirection.OUT,
          amount,
          source: CashSource.EXPENSE,
          expenseId: expense.id,
          date,
          note: dto.note ?? 'Xarajat',
          createdById: user.userId,
        },
      });
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.CREATE,
        entity: 'Expense',
        entityId: expense.id,
        after: {
          date: expense.date.toISOString(),
          amount: amount.toFixed(2),
          categoryId: expense.categoryId,
          cashboxId: expense.cashboxId,
          note: expense.note,
        },
      });
      return expense;
    });
  }

  /** Soft-void: voidedAt/voidReason + compensating REVERSAL (IN) cash row. Never a hard delete. */
  async void(id: string, dto: VoidExpenseDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findUnique({
        where: { id },
        include: { cashTransactions: true },
      });
      if (!expense) throw new NotFoundException('Xarajat topilmadi');
      if (expense.voidedAt) throw new BadRequestException('Xarajat allaqachon bekor qilingan');

      const updated = await tx.expense.update({
        where: { id },
        data: { voidedAt: new Date(), voidReason: dto.reason },
        include: {
          category: { select: { id: true, name: true } },
          cashbox: { select: { id: true, name: true, currency: true } },
        },
      });

      const original = expense.cashTransactions.find(
        (t) => t.source === CashSource.EXPENSE && t.direction === CashDirection.OUT,
      );
      if (original) {
        const alreadyReversed = await tx.cashTransaction.findUnique({
          where: { reversalOfId: original.id },
        });
        if (!alreadyReversed) {
          await tx.cashTransaction.create({
            data: {
              cashboxId: original.cashboxId,
              direction: CashDirection.IN,
              amount: original.amount,
              source: CashSource.REVERSAL,
              reversalOfId: original.id,
              expenseId: expense.id,
              date: new Date(),
              note: `Xarajat bekor qilindi: ${dto.reason}`,
              createdById: user.userId,
            },
          });
        }
      }
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.VOID,
        entity: 'Expense',
        entityId: id,
        before: { amount: D(expense.amount).toFixed(2), voidedAt: null },
        after: { voidedAt: updated.voidedAt?.toISOString(), voidReason: dto.reason },
        note: dto.reason,
      });
      return updated;
    });
  }

  // ── categories (small catalog: unpaged; hard delete only when unused) ──

  categories() {
    return this.prisma.expenseCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { expenses: true } } },
    });
  }

  async createCategory(dto: ExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findUnique({ where: { name: dto.name } });
    if (existing) throw new BadRequestException('Bunday nomli kategoriya allaqachon mavjud');
    return this.prisma.expenseCategory.create({ data: { name: dto.name } });
  }

  async updateCategory(id: string, dto: ExpenseCategoryDto) {
    const category = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Kategoriya topilmadi');
    const clash = await this.prisma.expenseCategory.findUnique({ where: { name: dto.name } });
    if (clash && clash.id !== id) throw new BadRequestException('Bunday nomli kategoriya allaqachon mavjud');
    return this.prisma.expenseCategory.update({ where: { id }, data: { name: dto.name } });
  }

  async removeCategory(id: string) {
    const category = await this.prisma.expenseCategory.findUnique({
      where: { id },
      include: { _count: { select: { expenses: true } } },
    });
    if (!category) throw new NotFoundException('Kategoriya topilmadi');
    if (category._count.expenses > 0) {
      throw new BadRequestException(
        `Kategoriya ishlatilgan (${category._count.expenses} ta xarajat) — o'chirish mumkin emas`,
      );
    }
    return this.prisma.expenseCategory.delete({ where: { id } });
  }
}
