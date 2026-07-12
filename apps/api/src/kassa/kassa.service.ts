import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CashboxType, CashDirection, CashSource, Currency, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { assertPositiveMoney, D, ZERO } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { RequestUser } from '../common/scoping';
import {
  CreateCashboxDto,
  KassaSummaryQueryDto,
  ManualCashDto,
  ReverseCashDto,
  TransactionsQueryDto,
  UpdateCashboxDto,
} from './dto';

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
export class KassaService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Σ(IN) − Σ(OUT) for one cashbox, in the cashbox currency. */
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

  /** Every cashbox with balance = Σ(IN) − Σ(OUT). USD boxes report in USD (amounts are stored in the box currency). */
  async cashboxes() {
    const [boxes, agg] = await Promise.all([
      this.prisma.cashbox.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: { entity: { select: { id: true, name: true } } },
      }),
      this.prisma.cashTransaction.groupBy({
        by: ['cashboxId', 'direction'],
        _sum: { amount: true },
      }),
    ]);
    const totals = new Map<string, { inTotal: Prisma.Decimal; outTotal: Prisma.Decimal }>();
    for (const row of agg) {
      const t = totals.get(row.cashboxId) ?? { inTotal: ZERO, outTotal: ZERO };
      const amount = D(row._sum.amount ?? 0);
      if (row.direction === CashDirection.IN) t.inTotal = t.inTotal.plus(amount);
      else t.outTotal = t.outTotal.plus(amount);
      totals.set(row.cashboxId, t);
    }
    return boxes.map((b) => {
      const t = totals.get(b.id) ?? { inTotal: ZERO, outTotal: ZERO };
      return { ...b, inTotal: t.inTotal, outTotal: t.outTotal, balance: t.inTotal.minus(t.outTotal) };
    });
  }

  /** Create a cashbox / bank account (name unique, currency fixed at creation). */
  async createCashbox(dto: CreateCashboxDto, user: RequestUser) {
    const name = dto.name.trim();
    const dup = await this.prisma.cashbox.findFirst({ where: { name } });
    if (dup) throw new BadRequestException('Bu nomli hisob allaqachon mavjud');
    const box = await this.prisma.cashbox
      .create({
        data: { name, type: dto.type, currency: dto.currency ?? Currency.UZS },
        include: { entity: { select: { id: true, name: true } } },
      })
      .catch((e) => {
        // race past the pre-check → unique(name) index → friendly 400, not a 500
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new BadRequestException('Bu nomli hisob allaqachon mavjud');
        throw e;
      });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.CREATE,
      entity: 'Cashbox',
      entityId: box.id,
      after: { name: box.name, type: box.type, currency: box.currency },
    });
    return { ...box, inTotal: ZERO, outTotal: ZERO, balance: ZERO };
  }

  /** Rename / (de)activate a cashbox. Type & currency are immutable once created
   * (transactions are stored in the box currency). Deactivating hides it from
   * pickers but preserves its ledger — cashboxes are never hard-deleted. */
  async updateCashbox(id: string, dto: UpdateCashboxDto, user: RequestUser) {
    const box = await this.prisma.cashbox.findUnique({ where: { id } });
    if (!box) throw new NotFoundException('Hisob topilmadi');
    if (dto.name != null) {
      const name = dto.name.trim();
      const dup = await this.prisma.cashbox.findFirst({ where: { name, id: { not: id } } });
      if (dup) throw new BadRequestException('Bu nomli hisob allaqachon mavjud');
    }
    const updated = await this.prisma.cashbox
      .update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name.trim() } : {}),
          ...(dto.active != null ? { active: dto.active } : {}),
        },
        include: { entity: { select: { id: true, name: true } } },
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new BadRequestException('Bu nomli hisob allaqachon mavjud');
        throw e;
      });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.UPDATE,
      entity: 'Cashbox',
      entityId: id,
      before: { name: box.name, active: box.active },
      after: { name: updated.name, active: updated.active },
    });
    const balance = await this.boxBalance(this.prisma, id);
    return { ...updated, balance };
  }

  /** Soft delete = deactivate (CashTransaction has onDelete: Restrict). */
  async deleteCashbox(id: string, user: RequestUser) {
    return this.updateCashbox(id, { active: false }, user);
  }

  async transactions(q: TransactionsQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.CashTransactionWhereInput = {
      ...(q.cashboxId ? { cashboxId: q.cashboxId } : {}),
      // scope splits the journal by cashbox family (Kassa page vs Bank page)
      ...(q.scope === 'bank'
        ? { cashbox: { type: CashboxType.BANK } }
        : q.scope === 'cash'
          ? { cashbox: { type: { not: CashboxType.BANK } } }
          : {}),
      ...(q.direction ? { direction: q.direction } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            date: {
              ...(q.dateFrom ? { gte: dayStart(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: dayEnd(q.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.cashTransaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          cashbox: { select: { id: true, name: true, type: true, currency: true } },
          payment: {
            select: {
              id: true,
              kind: true,
              method: true,
              amount: true,
              date: true,
              voidedAt: true,
              client: { select: { id: true, name: true } },
              factory: { select: { id: true, name: true } },
              vehicle: { select: { id: true, name: true } },
            },
          },
          expense: {
            select: {
              id: true,
              amount: true,
              date: true,
              note: true,
              voidedAt: true,
              category: { select: { id: true, name: true } },
            },
          },
          bonusTransaction: {
            select: { id: true, type: true, amount: true, factory: { select: { id: true, name: true } } },
          },
          reversalOf: { select: { id: true, direction: true, amount: true, source: true, date: true } },
          reversedBy: { select: { id: true, date: true, note: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.cashTransaction.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  /** Manual kassa entry; OUT must not push the cashbox balance below zero. */
  async manual(dto: ManualCashDto, user: RequestUser) {
    const amount = positiveMoney(dto.amount, 'amount');
    const date = dto.date ? new Date(dto.date) : new Date();
    return this.prisma.$transaction(async (tx) => {
      const box = await tx.cashbox.findUnique({ where: { id: dto.cashboxId } });
      if (!box) throw new NotFoundException('Kassa topilmadi');
      if (!box.active) throw new BadRequestException('Kassa faol emas');
      // serialize concurrent OUTs on this box - the never-below-zero check must not race
      await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${box.id} FOR UPDATE`;
      if (dto.direction === CashDirection.OUT) {
        const balance = await this.boxBalance(tx, box.id);
        if (balance.minus(amount).isNegative()) {
          throw new BadRequestException(
            `Kassada mablag' yetarli emas: joriy qoldiq ${balance.toFixed(2)} ${box.currency}, ` +
              `so'ralgan chiqim ${amount.toFixed(2)} ${box.currency}`,
          );
        }
      }
      const row = await tx.cashTransaction.create({
        data: {
          cashboxId: box.id,
          direction: dto.direction,
          amount,
          source: CashSource.MANUAL,
          date,
          note: dto.note ?? null,
          createdById: user.userId,
        },
        include: { cashbox: { select: { id: true, name: true, currency: true } } },
      });
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.CREATE,
        entity: 'CashTransaction',
        entityId: row.id,
        after: {
          cashboxId: row.cashboxId,
          direction: row.direction,
          amount: amount.toFixed(2),
          source: row.source,
          date: row.date.toISOString(),
          note: row.note,
        },
      });
      return row;
    });
  }

  /** Compensating REVERSAL row for a MANUAL entry. Never a hard delete. */
  async reverse(id: string, dto: ReverseCashDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.cashTransaction.findUnique({
        where: { id },
        include: { reversedBy: { select: { id: true } }, cashbox: { select: { id: true, currency: true } } },
      });
      if (!row) throw new NotFoundException('Tranzaksiya topilmadi');
      if (row.source !== CashSource.MANUAL) {
        throw new BadRequestException(
          "Faqat qo'lda kiritilgan (MANUAL) yozuvni qaytarish mumkin — to'lov/xarajat yozuvi uchun tegishli hujjatni bekor qiling",
        );
      }
      if (row.reversedBy) throw new BadRequestException('Bu yozuv allaqachon qaytarilgan');

      const direction = row.direction === CashDirection.IN ? CashDirection.OUT : CashDirection.IN;
      await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${row.cashboxId} FOR UPDATE`;
      if (direction === CashDirection.OUT) {
        const balance = await this.boxBalance(tx, row.cashboxId);
        if (balance.minus(D(row.amount)).isNegative()) {
          throw new BadRequestException(
            `Qaytarish kassa qoldig'ini manfiy qiladi: joriy qoldiq ${balance.toFixed(2)} ${row.cashbox.currency}`,
          );
        }
      }
      const reversal = await tx.cashTransaction.create({
        data: {
          cashboxId: row.cashboxId,
          direction,
          amount: row.amount,
          rate: row.rate,
          source: CashSource.REVERSAL,
          date: new Date(),
          note: dto.reason,
          reversalOfId: row.id,
          createdById: user.userId,
        },
        include: { cashbox: { select: { id: true, name: true, currency: true } } },
      });
      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.VOID,
        entity: 'CashTransaction',
        entityId: row.id,
        before: { direction: row.direction, amount: D(row.amount).toFixed(2), source: row.source },
        after: { reversalId: reversal.id, direction: reversal.direction },
        note: dto.reason,
      });
      return reversal;
    });
  }

  /** Per-cashbox opening (before dateFrom), in/out within [dateFrom, dateTo], closing. */
  async summary(q: KassaSummaryQueryDto) {
    const from = q.dateFrom ? dayStart(q.dateFrom) : undefined;
    const to = q.dateTo ? dayEnd(q.dateTo) : undefined;
    const boxes = await this.prisma.cashbox.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });

    const windowWhere: Prisma.CashTransactionWhereInput =
      from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
    const [openingAgg, windowAgg] = await Promise.all([
      from
        ? this.prisma.cashTransaction.groupBy({
            by: ['cashboxId', 'direction'],
            where: { date: { lt: from } },
            _sum: { amount: true },
          })
        : Promise.resolve([] as { cashboxId: string; direction: CashDirection; _sum: { amount: Prisma.Decimal | null } }[]),
      this.prisma.cashTransaction.groupBy({
        by: ['cashboxId', 'direction'],
        where: windowWhere,
        _sum: { amount: true },
      }),
    ]);

    const opening = new Map<string, Prisma.Decimal>();
    for (const row of openingAgg) {
      const amount = D(row._sum.amount ?? 0);
      const signed = row.direction === CashDirection.IN ? amount : amount.negated();
      opening.set(row.cashboxId, (opening.get(row.cashboxId) ?? ZERO).plus(signed));
    }
    const flows = new Map<string, { inSum: Prisma.Decimal; outSum: Prisma.Decimal }>();
    for (const row of windowAgg) {
      const f = flows.get(row.cashboxId) ?? { inSum: ZERO, outSum: ZERO };
      const amount = D(row._sum.amount ?? 0);
      if (row.direction === CashDirection.IN) f.inSum = f.inSum.plus(amount);
      else f.outSum = f.outSum.plus(amount);
      flows.set(row.cashboxId, f);
    }

    let totalUZS = ZERO;
    let totalUSD = ZERO;
    const rows = boxes.map((b) => {
      const open = opening.get(b.id) ?? ZERO;
      const f = flows.get(b.id) ?? { inSum: ZERO, outSum: ZERO };
      const closing = open.plus(f.inSum).minus(f.outSum);
      if (b.currency === 'USD') totalUSD = totalUSD.plus(closing);
      else totalUZS = totalUZS.plus(closing);
      return {
        id: b.id,
        name: b.name,
        type: b.type,
        currency: b.currency,
        active: b.active,
        opening: open,
        in: f.inSum,
        out: f.outSum,
        closing,
      };
    });
    return {
      dateFrom: q.dateFrom ?? null,
      dateTo: q.dateTo ?? null,
      cashboxes: rows,
      totals: { UZS: totalUZS, USD: totalUSD },
    };
  }
}
