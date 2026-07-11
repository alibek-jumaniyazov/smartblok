import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, PriceKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { SettingsService, SETTING_KEYS } from '../common/settings.service';
import { assertPositiveMoney, D, round3 } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { RequestUser } from '../common/scoping';
import { landedCostPerM3 } from './landed-cost.util';
import { CreateRouteDto, RoutesQueryDto } from './dto';

/** Decimal/Date-safe snapshot for AuditLog Json columns. */
const asJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

interface MatrixRow {
  productId: string;
  product: string;
  size: string | null;
  factoryId: string;
  factory: string;
  m3PerPallet: Prisma.Decimal;
  factoryPricePerM3: Prisma.Decimal;
  costPerTruck: Prisma.Decimal;
  capacityPallets: number;
  truckM3: Prisma.Decimal;
  landedCostPerM3: Prisma.Decimal;
}

interface DroppedRow {
  productId: string;
  product: string;
  factoryId: string;
  factory: string;
  reason: string;
}

@Injectable()
export class ProcurementService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private settings: SettingsService,
  ) {}

  /**
   * Landed-cost comparison matrix for a region:
   *   landed = current FACTORY_BANK price + costPerTruck / (route.capacityPallets × product.m3PerPallet)
   * Products whose factory has no current route to the region (or no FACTORY_BANK
   * price) are surfaced in `dropped` instead of silently hidden.
   */
  async matrix(regionId?: string, productId?: string) {
    if (!regionId) {
      return { regionId: null, region: null, cheapest: null, rows: [] as MatrixRow[], dropped: [] as DroppedRow[] };
    }
    const region = await this.prisma.region.findUnique({ where: { id: regionId } });
    if (!region) throw new NotFoundException('Hudud topilmadi');

    const now = new Date();
    const products = (
      await this.prisma.product.findMany({
        where: { active: true, ...(productId ? { id: productId } : {}) },
        include: { factory: { select: { id: true, name: true, active: true } } },
        orderBy: [{ factory: { name: 'asc' } }, { name: 'asc' }],
      })
    ).filter((p) => p.factory.active);

    const [priceRows, routeRows] = await Promise.all([
      products.length
        ? this.prisma.productPrice.findMany({
            where: {
              productId: { in: products.map((p) => p.id) },
              kind: PriceKind.FACTORY_BANK,
              effectiveFrom: { lte: now },
            },
            orderBy: { effectiveFrom: 'desc' },
          })
        : Promise.resolve([]),
      this.prisma.logisticsRoute.findMany({
        where: { regionId, effectiveFrom: { lte: now } },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    // first row wins = the currently effective version (desc by effectiveFrom)
    const priceByProduct = new Map<string, (typeof priceRows)[number]>();
    for (const p of priceRows) if (!priceByProduct.has(p.productId)) priceByProduct.set(p.productId, p);
    const routeByFactory = new Map<string, (typeof routeRows)[number]>();
    for (const r of routeRows) if (!routeByFactory.has(r.factoryId)) routeByFactory.set(r.factoryId, r);

    const rows: MatrixRow[] = [];
    const dropped: DroppedRow[] = [];
    for (const p of products) {
      const price = priceByProduct.get(p.id);
      if (!price) {
        dropped.push({
          productId: p.id,
          product: p.name,
          factoryId: p.factoryId,
          factory: p.factory.name,
          reason: 'FACTORY_BANK narxi kiritilmagan',
        });
        continue;
      }
      const route = routeByFactory.get(p.factoryId);
      if (!route) {
        dropped.push({
          productId: p.id,
          product: p.name,
          factoryId: p.factoryId,
          factory: p.factory.name,
          reason: "Bu hudud uchun marshrut yo'q",
        });
        continue;
      }
      rows.push({
        productId: p.id,
        product: p.name,
        size: p.size,
        factoryId: p.factoryId,
        factory: p.factory.name,
        m3PerPallet: p.m3PerPallet,
        factoryPricePerM3: price.pricePerM3,
        costPerTruck: route.costPerTruck,
        capacityPallets: route.capacityPallets,
        truckM3: round3(D(p.m3PerPallet).times(route.capacityPallets)),
        landedCostPerM3: landedCostPerM3(price.pricePerM3, route.costPerTruck, route.capacityPallets, p.m3PerPallet),
      });
    }
    rows.sort((a, b) => a.landedCostPerM3.comparedTo(b.landedCostPerM3));

    return { regionId, region: region.name, cheapest: rows[0] ?? null, rows, dropped };
  }

  // ── logistics routes (versioned inserts, like prices — no update/delete) ──

  async listRoutes(q: RoutesQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.LogisticsRouteWhereInput = {
      ...(q.factoryId ? { factoryId: q.factoryId } : {}),
      ...(q.regionId ? { regionId: q.regionId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.logisticsRoute.findMany({
        where,
        orderBy: [{ effectiveFrom: 'desc' }],
        skip,
        take,
        include: {
          factory: { select: { id: true, name: true } },
          region: { select: { id: true, name: true } },
        },
      }),
      this.prisma.logisticsRoute.count({ where }),
    ]);
    return paged(rows, total, page, pageSize);
  }

  async createRoute(dto: CreateRouteDto, user: RequestUser) {
    const [factory, region] = await Promise.all([
      this.prisma.factory.findUnique({ where: { id: dto.factoryId }, select: { id: true } }),
      this.prisma.region.findUnique({ where: { id: dto.regionId }, select: { id: true } }),
    ]);
    if (!factory) throw new BadRequestException('Zavod topilmadi');
    if (!region) throw new BadRequestException('Hudud topilmadi');

    let costPerTruck: Prisma.Decimal;
    try {
      costPerTruck = assertPositiveMoney(dto.costPerTruck, 'costPerTruck');
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    let capacityPallets = dto.capacityPallets;
    if (capacityPallets === undefined) {
      const fromSettings = await this.settings.get<unknown>(SETTING_KEYS.truckCapacityPallets);
      capacityPallets =
        typeof fromSettings === 'number' && Number.isInteger(fromSettings) && fromSettings >= 1 && fromSettings <= 40
          ? fromSettings
          : 19;
    }
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.logisticsRoute.create({
          data: { factoryId: dto.factoryId, regionId: dto.regionId, costPerTruck, capacityPallets, effectiveFrom },
        });
        await this.audit.log({
          tx,
          userId: user.userId,
          action: AuditAction.CREATE,
          entity: 'LogisticsRoute',
          entityId: row.id,
          after: asJson(row),
          note: 'Marshrut versiyalanadi — eski hisob-kitoblarga ta’sir qilmaydi',
        });
        return row;
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new BadRequestException('Shu zavod-hudud jufti uchun aynan shu vaqtdan kuchga kiruvchi marshrut allaqachon mavjud');
      }
      throw e;
    }
  }
}
