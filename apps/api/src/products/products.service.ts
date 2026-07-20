import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, PriceKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { D } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { startOfDayUtc } from '../common/pricing.service';
import { RequestUser } from '../common/scoping';
import { AddProductPriceDto, CreateProductDto, ProductsQueryDto, UpdateProductDto } from './dto';

/** Decimal/Date-safe snapshot for AuditLog Json columns. */
const asJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/**
 * Positive Decimal guard for high-precision unit fields. NOT assertPositiveMoney:
 * that helper rounds to 2dp, which would corrupt 6dp per-m³ prices (732542.438)
 * and 3dp pallet volumes (1.728).
 */
const positiveDecimal = (v: number | string, field: string, dp: number): Prisma.Decimal => {
  const d = D(v);
  if (!d.isFinite() || d.lessThanOrEqualTo(0)) {
    throw new BadRequestException(`${field} musbat son bo'lishi kerak`);
  }
  return d.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);
};

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Catalog with CURRENT price per kind. ADMIN/ACCOUNTANT see all three kinds;
   * AGENT sees ONLY DEALER_SALE (factory cost prices are hidden) and only active rows.
   */
  async findAll(user: RequestUser, q: ProductsQueryDto) {
    const isAgent = user.role === 'AGENT';
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.ProductWhereInput = {
      ...(q.factoryId ? { factoryId: q.factoryId } : {}),
      ...(q.search ? { name: { contains: q.search, mode: Prisma.QueryMode.insensitive } } : {}),
      ...(isAgent ? { active: true } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ factory: { name: 'asc' } }, { name: 'asc' }],
        skip,
        take,
        include: { factory: { select: { id: true, name: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);

    const kinds = isAgent
      ? [PriceKind.DEALER_SALE]
      : [PriceKind.DEALER_SALE, PriceKind.FACTORY_CASH, PriceKind.FACTORY_BANK];
    const now = new Date();
    const priceRows = rows.length
      ? await this.prisma.productPrice.findMany({
          where: { productId: { in: rows.map((r) => r.id) }, kind: { in: kinds }, effectiveFrom: { lte: now } },
          orderBy: { effectiveFrom: 'desc' },
        })
      : [];
    // first row per (product, kind) is the current one (desc by effectiveFrom)
    const current = new Map<string, { pricePerM3: Prisma.Decimal; effectiveFrom: Date }>();
    for (const p of priceRows) {
      const key = `${p.productId}|${p.kind}`;
      if (!current.has(key)) current.set(key, { pricePerM3: p.pricePerM3, effectiveFrom: p.effectiveFrom });
    }

    const items = rows.map((p) => {
      const prices: Record<string, { pricePerM3: Prisma.Decimal; effectiveFrom: Date }> = {};
      for (const kind of kinds) {
        const c = current.get(`${p.id}|${kind}`);
        if (c) prices[kind] = c;
      }
      return {
        id: p.id,
        factoryId: p.factoryId,
        factoryName: p.factory.name,
        name: p.name,
        size: p.size,
        m3PerPallet: p.m3PerPallet,
        blocksPerPallet: p.blocksPerPallet,
        unit: p.unit,
        active: p.active,
        prices,
      };
    });
    return paged(items, total, page, pageSize);
  }

  async create(dto: CreateProductDto, user: RequestUser) {
    const factory = await this.prisma.factory.findUnique({ where: { id: dto.factoryId }, select: { id: true } });
    if (!factory) throw new BadRequestException('Zavod topilmadi');

    // Boshlang'ich narxlar (ixtiyoriy) — mahsulot bilan bitta tranzaksiyada.
    const initialPrices: { kind: PriceKind; pricePerM3: Prisma.Decimal }[] = [];
    if (dto.priceFactoryCash != null)
      initialPrices.push({ kind: PriceKind.FACTORY_CASH, pricePerM3: positiveDecimal(dto.priceFactoryCash, 'priceFactoryCash', 6) });
    if (dto.priceFactoryBank != null)
      initialPrices.push({ kind: PriceKind.FACTORY_BANK, pricePerM3: positiveDecimal(dto.priceFactoryBank, 'priceFactoryBank', 6) });
    if (dto.priceDealerSale != null)
      initialPrices.push({ kind: PriceKind.DEALER_SALE, pricePerM3: positiveDecimal(dto.priceDealerSale, 'priceDealerSale', 6) });

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            factoryId: dto.factoryId,
            name: dto.name.trim(),
            size: dto.size ?? null,
            m3PerPallet: positiveDecimal(dto.m3PerPallet, 'm3PerPallet', 3),
            blocksPerPallet: dto.blocksPerPallet ?? null,
            unit: dto.unit || 'm³',
          },
        });
        if (initialPrices.length) {
          const effectiveFrom = startOfDayUtc(new Date());
          await tx.productPrice.createMany({
            data: initialPrices.map((p) => ({
              productId: product.id,
              kind: p.kind,
              pricePerM3: p.pricePerM3,
              effectiveFrom,
              createdBy: user.userId,
            })),
          });
        }
        return product;
      });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.CREATE,
      entity: 'Product',
      entityId: row.id,
      after: asJson(row),
    });
    return row;
  }

  /** factoryId is intentionally NOT updatable — moving a product across factories would break past orders' invariant. */
  async update(id: string, dto: UpdateProductDto, user: RequestUser) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mahsulot topilmadi');
    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.size !== undefined) data.size = dto.size;
    if (dto.m3PerPallet !== undefined) data.m3PerPallet = positiveDecimal(dto.m3PerPallet, 'm3PerPallet', 3);
    if (dto.blocksPerPallet !== undefined) data.blocksPerPallet = dto.blocksPerPallet;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.active !== undefined) data.active = dto.active;
    let row;
    try {
      row = await this.prisma.product.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.UPDATE,
      entity: 'Product',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
    });
    return row;
  }

  /** Soft-delete: catalog rows deactivate, never hard-delete. */
  async deactivate(id: string, user: RequestUser) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mahsulot topilmadi');
    if (!before.active) return before;
    const row = await this.prisma.product.update({ where: { id }, data: { active: false } });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.DELETE,
      entity: 'Product',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
      note: 'Soft-delete: mahsulot nofaol qilindi',
    });
    return row;
  }

  // ── price book (versioned inserts, never updated) ──

  async addPrice(productId: string, dto: AddProductPriceDto, user: RequestUser) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    const pricePerM3 = positiveDecimal(dto.pricePerM3, 'pricePerM3', 6);
    const effectiveFrom = startOfDayUtc(dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date());

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.productPrice.create({
          data: { productId, kind: dto.kind, pricePerM3, effectiveFrom, createdBy: user.userId },
        });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.CREATE,
          entity: 'ProductPrice',
          entityId: row.id,
          after: asJson(row),
          note: 'Narx versiyalanadi — eski buyurtmalarga ta’sir qilmaydi',
        });
        return row;
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new BadRequestException('Shu tur va shu vaqt uchun narx allaqachon kiritilgan');
      }
      throw e;
    }
  }

  /** Full versioned history, all three kinds. */
  async getPrices(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return this.prisma.productPrice.findMany({
      where: { productId },
      orderBy: [{ kind: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  private rethrowUnique(e: unknown): never {
    if ((e as { code?: string })?.code === 'P2002') {
      throw new BadRequestException('Bu zavodda shu nomli mahsulot allaqachon bor');
    }
    throw e;
  }
}
