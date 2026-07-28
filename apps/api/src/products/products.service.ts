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
   *
   * Har bir tur uchun UCHTA maydon qaytadi, va bu ataylab (2026-07-28):
   *   `prices[kind]`         — BUGUN kuchda turgan narx (qiymat + sanasi),
   *   `firstPriceFrom[kind]` — shu tur bo'yicha eng ERTA narx sanasi,
   *   `pendingPrices[kind]`  — hali kuchga kirmagan (kelajak sanali) narx.
   * …va mahsulot darajasida `oldestOrderDate`.
   *
   * Sababi: ro'yxat narxni `now` da yechadi, buyurtma esa O'Z SANASIDA. Faqat birinchisi
   * ko'rsatilganda ekran «narx bor» deb turardi, buyurtma esa o'sha mahsulotni «narxi
   * belgilanmagan» deb rad etardi — egasining «qo'shsam ham kiritilmagan deyapti» degan
   * shikoyati aynan shu. `firstPriceFrom` bo'lsa UI «faqat 26.07 dan» deb ayta oladi,
   * `pendingPrices` bo'lsa kelajak sanali (xato kiritilgan) narx «umuman yo'q» bo'lib
   * ko'rinmaydi.
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
    /**
     * Kunning BOSHI, `new Date()` emas (2026-07-28).
     *
     * Narx qatori UTC yarim tunga tekislanadi, taqqoslash esa jonli vaqt bilan borardi.
     * Toshkent (UTC+5) da tunda 01:30 da «bugun» deb kiritilgan narx UTC bo'yicha
     * 2026-07-28T00:00Z bo'ladi, `now` esa hali 2026-07-27T20:30Z — ya'ni narx ro'yxatda
     * mahalliy soat 05:00 gacha KO'RINMASDI va «kiritilmagan» bo'lib turardi.
     */
    const now = startOfDayUtc(new Date());
    const ids = rows.map((r) => r.id);
    // NOT filtered by `effectiveFrom <= now` any more: a row stamped with a FUTURE date is
    // exactly the case the screen has to warn about, and filtering it out is what made a
    // mis-dated price indistinguishable from no price at all.
    const priceRows = ids.length
      ? await this.prisma.productPrice.findMany({
          where: { productId: { in: ids }, kind: { in: kinds } },
          orderBy: { effectiveFrom: 'desc' },
        })
      : [];

    type PriceCell = { pricePerM3: Prisma.Decimal; effectiveFrom: Date };
    const current = new Map<string, PriceCell>();
    const pending = new Map<string, PriceCell>();
    const firstFrom = new Map<string, Date>();
    for (const p of priceRows) {
      const key = `${p.productId}|${p.kind}`;
      const cell = { pricePerM3: p.pricePerM3, effectiveFrom: p.effectiveFrom };
      if (p.effectiveFrom > now) {
        // desc order ⇒ keep the SOONEST future row (the last one seen before `now`)
        pending.set(key, cell);
      } else if (!current.has(key)) {
        current.set(key, cell);
      }
      firstFrom.set(key, p.effectiveFrom); // desc ⇒ the last write wins = the earliest row
    }

    // Eng eski buyurtma sanasi — «narx qaysi kundan kuchga kirsin?» degan savolga
    // yagona to'g'ri javob shu. Egasi bir marta shu sanani tanlasa, o'sha mahsulotning
    // BUTUN tarixi qamrab olinadi; usiz u har bir buyurtma uchun alohida narx kiritishga
    // majbur bo'lardi. Bitta agregat so'rov (Prisma groupBy bog'langan ustun bo'yicha
    // MIN ololmaydi — shuning uchun raw).
    const oldestOrderDate = new Map<string, Date>();
    if (ids.length) {
      const agg = await this.prisma.$queryRaw<{ productId: string; oldest: Date | null }[]>`
        SELECT oi."productId" AS "productId", MIN(o."date") AS "oldest"
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        WHERE oi."productId" = ANY(${ids}::text[]) AND o."cancelledAt" IS NULL
        GROUP BY oi."productId"`;
      for (const r of agg) if (r.oldest) oldestOrderDate.set(r.productId, r.oldest);
    }

    const items = rows.map((p) => {
      const prices: Record<string, PriceCell> = {};
      const pendingPrices: Record<string, PriceCell> = {};
      const firsts: Record<string, Date> = {};
      for (const kind of kinds) {
        const key = `${p.id}|${kind}`;
        const c = current.get(key);
        if (c) prices[kind] = c;
        const fut = pending.get(key);
        if (fut) pendingPrices[kind] = fut;
        const f = firstFrom.get(key);
        if (f) firsts[kind] = f;
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
        /** kuchga kirmagan (kelajak sanali) narx — «kiritilmagan» bilan adashtirmaslik uchun */
        pendingPrices,
        /** shu tur bo'yicha eng erta narx sanasi — undan OLDINGI buyurtmalar qamralmagan */
        firstPriceFrom: firsts,
        /** shu mahsulot ishtirok etgan eng eski buyurtma sanasi (yo'q bo'lsa — null) */
        oldestOrderDate: oldestOrderDate.get(p.id) ?? null,
      };
    });
    return paged(items, total, page, pageSize);
  }

  async create(dto: CreateProductDto, user: RequestUser) {
    const factory = await this.prisma.factory.findUnique({ where: { id: dto.factoryId }, select: { id: true } });
    if (!factory) throw new BadRequestException('Zavod topilmadi');

    // Boshlang'ich narxlar — mahsulot bilan bitta tranzaksiyada. Zavod narxlari majburiy
    // (DTO darajasida), sotish narxi ixtiyoriy.
    const initialPrices: { kind: PriceKind; pricePerM3: Prisma.Decimal }[] = [
      { kind: PriceKind.FACTORY_CASH, pricePerM3: positiveDecimal(dto.priceFactoryCash, 'priceFactoryCash', 6) },
      { kind: PriceKind.FACTORY_BANK, pricePerM3: positiveDecimal(dto.priceFactoryBank, 'priceFactoryBank', 6) },
    ];
    if (dto.priceDealerSale != null && dto.priceDealerSale !== '')
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
          const effectiveFrom = startOfDayUtc(
            dto.pricesEffectiveFrom ? new Date(dto.pricesEffectiveFrom) : new Date(),
          );
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

  // ── price book (versioned inserts; only the CURRENT day's row may be corrected) ──

  /**
   * Adds a price version — or CORRECTS the one already stamped for that same effective day.
   *
   * Versioning is deliberate: an old order must keep resolving the price it was sold at. But
   * `effectiveFrom` is bucketed to UTC midnight and the unique key is
   * (product, kind, effectiveFrom), so a typo entered today used to be un-fixable for the rest
   * of the day — P2002, and no update or delete route exists anywhere in the API. That became
   * material on 2026-07-26: entering the missing zavod NAQD price is now the remedy for a
   * whole class of «naqd va o'tkazma bir xil ko'rinadi» problems, and a remedy you cannot
   * correct is not a remedy. Overwriting the SAME day's row moves no history — every order
   * dated before it still resolves the older version — and the audit log keeps before/after.
   */
  async addPrice(productId: string, dto: AddProductPriceDto, user: RequestUser) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    const pricePerM3 = positiveDecimal(dto.pricePerM3, 'pricePerM3', 6);
    const effectiveFrom = startOfDayUtc(dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date());

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.productPrice.findUnique({
          where: { productId_kind_effectiveFrom: { productId, kind: dto.kind, effectiveFrom } },
        });
        const row = existing
          ? await tx.productPrice.update({
              where: { id: existing.id },
              data: { pricePerM3, createdBy: user.userId },
            })
          : await tx.productPrice.create({
              data: { productId, kind: dto.kind, pricePerM3, effectiveFrom, createdBy: user.userId },
            });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
          entity: 'ProductPrice',
          entityId: row.id,
          before: existing ? asJson(existing) : undefined,
          after: asJson(row),
          note: existing
            ? "Shu kunga kiritilgan narx tuzatildi — oldingi kunlardagi buyurtmalar o'zgarmaydi"
            : 'Narx versiyalanadi — eski buyurtmalarga ta’sir qilmaydi',
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

  /**
   * Deletes ONE price version.
   *
   * The book is versioned, not append-only-at-any-cost. `addPrice` can only correct the row
   * stamped for the SAME UTC day, so a price entered with the wrong DATE — the single easiest
   * mistake to make now that the date is a real field — was permanent, and a mistyped future
   * date would quietly become the ruling price the moment it arrived. Orders are unaffected:
   * every order stores its own `costPricePerM3`/`salePricePerM3`, the book is only consulted
   * for NEW work. Audited with the full row so the deletion is reconstructible.
   */
  async removePrice(productId: string, priceId: string, user: RequestUser) {
    const row = await this.prisma.productPrice.findUnique({ where: { id: priceId } });
    if (!row || row.productId !== productId) throw new NotFoundException('Narx qatori topilmadi');
    await this.prisma.productPrice.delete({ where: { id: priceId } });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.DELETE,
      entity: 'ProductPrice',
      entityId: priceId,
      before: asJson(row),
      note: "Narx versiyasi o'chirildi — mavjud buyurtmalar o'z narxini saqlaydi",
    });
    return { id: priceId };
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
