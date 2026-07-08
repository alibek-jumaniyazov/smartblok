import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { landedCostPerM3, netCostAfterBonus } from './landed-cost.util';

@Injectable()
export class ProcurementService {
  constructor(private prisma: PrismaService) {}

  // ----- Factory prices -----
  createPrice(data: any) { return this.prisma.factoryPrice.create({ data }); }
  updatePrice(id: number, data: any) { return this.prisma.factoryPrice.update({ where: { id }, data }); }
  removePrice(id: number) { return this.prisma.factoryPrice.delete({ where: { id } }); }
  listPrices() { return this.prisma.factoryPrice.findMany({ include: { factory: true } }); }

  // ----- Logistics routes -----
  createRoute(data: any) { return this.prisma.logisticsRoute.create({ data }); }
  updateRoute(id: number, data: any) { return this.prisma.logisticsRoute.update({ where: { id }, data }); }
  removeRoute(id: number) { return this.prisma.logisticsRoute.delete({ where: { id } }); }
  listRoutes() {
    return this.prisma.logisticsRoute.findMany({ include: { factory: true, region: true } });
  }

  // ----- Landed-cost matrix for a region -----
  async matrix(regionId: number) {
    const [prices, routes, region] = await Promise.all([
      this.prisma.factoryPrice.findMany({ include: { factory: true }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.logisticsRoute.findMany({ where: { regionId }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.region.findUnique({ where: { id: regionId } }),
    ]);

    // latest route per factory for this region
    const routeByFactory = new Map<number, (typeof routes)[number]>();
    for (const r of routes) if (!routeByFactory.has(r.factoryId)) routeByFactory.set(r.factoryId, r);

    const rows = prices
      .filter((p) => routeByFactory.has(p.factoryId))
      .map((p) => {
        const route = routeByFactory.get(p.factoryId)!;
        const landed = landedCostPerM3(p.pricePerM3, route.costPerTruck, route.truckCapacityM3);
        const net = netCostAfterBonus(landed, p.dealerBonusPct);
        return {
          factoryId: p.factoryId,
          factory: p.factory.name,
          paymentMethod: p.paymentMethod,
          pricePerM3: p.pricePerM3,
          logisticsCostPerTruck: route.costPerTruck,
          truckCapacityM3: route.truckCapacityM3,
          dealerBonusPct: p.dealerBonusPct,
          landedCostPerM3: Math.round(landed),
          netCostPerM3: Math.round(net),
        };
      })
      .sort((a, b) => a.landedCostPerM3 - b.landedCostPerM3);

    return {
      region: region?.name ?? null,
      regionId,
      cheapest: rows[0] ?? null,
      rows,
    };
  }
}
