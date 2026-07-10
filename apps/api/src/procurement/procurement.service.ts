import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { landedCostPerM3, netCostAfterBonus } from './landed-cost.util';

@Injectable()
export class ProcurementService {
  constructor(private prisma: PrismaService) {}

  createPrice(d: any) {
    return this.prisma.factoryPrice.create({
      data: { factoryId: d.factoryId, paymentMethod: d.paymentMethod || 'TRANSFER', pricePerM3: Number(d.pricePerM3) || 0, dealerBonusPct: Number(d.dealerBonusPct) || 0 },
    });
  }
  // whitelist + coerce (never spread the raw body — that let strings 500 and allowed factoryId reassignment)
  updatePrice(id: string, d: any) {
    const data: any = {};
    if (d.paymentMethod !== undefined) data.paymentMethod = d.paymentMethod;
    if (d.pricePerM3 !== undefined) data.pricePerM3 = Number(d.pricePerM3) || 0;
    if (d.dealerBonusPct !== undefined) data.dealerBonusPct = Number(d.dealerBonusPct) || 0;
    return this.prisma.factoryPrice.update({ where: { id }, data });
  }
  removePrice(id: string) { return this.prisma.factoryPrice.delete({ where: { id } }); }
  listPrices() { return this.prisma.factoryPrice.findMany({ include: { factory: true } }); }

  createRoute(d: any) {
    return this.prisma.logisticsRoute.create({
      data: { factoryId: d.factoryId, regionId: d.regionId, costPerTruck: Number(d.costPerTruck) || 0, truckCapacityM3: Number(d.truckCapacityM3) || 33 },
    });
  }
  updateRoute(id: string, d: any) {
    const data: any = {};
    if (d.costPerTruck !== undefined) data.costPerTruck = Number(d.costPerTruck) || 0;
    if (d.truckCapacityM3 !== undefined) data.truckCapacityM3 = Number(d.truckCapacityM3) || 33;
    return this.prisma.logisticsRoute.update({ where: { id }, data });
  }
  removeRoute(id: string) { return this.prisma.logisticsRoute.delete({ where: { id } }); }
  listRoutes() { return this.prisma.logisticsRoute.findMany({ include: { factory: true, region: true } }); }

  async matrix(regionId: string) {
    // no region selected → empty matrix instead of a 500 (region.findUnique with undefined id threw)
    if (!regionId) return { region: null, regionId: null, cheapest: null, rows: [], droppedFactories: [] };

    const [prices, routes, region] = await Promise.all([
      this.prisma.factoryPrice.findMany({ include: { factory: true }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.logisticsRoute.findMany({ where: { regionId }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.region.findUnique({ where: { id: regionId } }),
    ]);

    // keep only the most-recent, currently-effective route per factory
    const routeByFactory = new Map<string, (typeof routes)[number]>();
    for (const r of routes) if (!routeByFactory.has(r.factoryId)) routeByFactory.set(r.factoryId, r);

    // keep only the most-recent, currently-effective price per factory+method (prices are desc by
    // effectiveFrom) so a stale historical price can never win "cheapest".
    const now = new Date();
    const priceByKey = new Map<string, (typeof prices)[number]>();
    for (const p of prices) {
      if (p.effectiveFrom > now) continue;
      const key = p.factoryId + '|' + p.paymentMethod;
      if (!priceByKey.has(key)) priceByKey.set(key, p);
    }

    const rows: any[] = [];
    const droppedFactories: any[] = [];
    for (const p of priceByKey.values()) {
      const route = routeByFactory.get(p.factoryId);
      if (!route) {
        // priced but no route to this region — surface it instead of silently hiding the supplier
        droppedFactories.push({ factoryId: p.factoryId, factory: p.factory.name, paymentMethod: p.paymentMethod, pricePerM3: p.pricePerM3, reason: 'Bu hudud uchun marshrut yo‘q' });
        continue;
      }
      const landed = landedCostPerM3(p.pricePerM3, route.costPerTruck, route.truckCapacityM3);
      const net = netCostAfterBonus(landed, p.dealerBonusPct);
      rows.push({
        factoryId: p.factoryId, factory: p.factory.name, paymentMethod: p.paymentMethod,
        pricePerM3: p.pricePerM3, logisticsCostPerTruck: route.costPerTruck, truckCapacityM3: route.truckCapacityM3,
        dealerBonusPct: p.dealerBonusPct, landedCostPerM3: Math.round(landed), netCostPerM3: Math.round(net),
      });
    }
    rows.sort((a, b) => a.landedCostPerM3 - b.landedCostPerM3);

    return { region: region?.name ?? null, regionId, cheapest: rows[0] ?? null, rows, droppedFactories };
  }
}
