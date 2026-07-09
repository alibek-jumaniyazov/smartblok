import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const vehicles = await this.prisma.vehicle.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { orders: true } } } });
    const [transportByVehicle, paysByVehicle] = await Promise.all([
      this.prisma.order.groupBy({ by: ['vehicleId'], where: { status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { transportFee: true } }),
      this.prisma.payment.groupBy({ by: ['vehicleId'], where: { type: 'VEHICLE' }, _sum: { amount: true } }),
    ]);
    const tMap = new Map(transportByVehicle.map((t) => [t.vehicleId, t._sum.transportFee ?? 0]));
    const pMap = new Map(paysByVehicle.map((p) => [p.vehicleId, p._sum.amount ?? 0]));
    return vehicles.map((v) => {
      const owed = tMap.get(v.id) ?? 0;
      const paid = pMap.get(v.id) ?? 0;
      return { ...v, transportTotal: owed, paid, balance: owed - paid };
    });
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) return null;
    const [orders, payments] = await Promise.all([
      this.prisma.order.findMany({ where: { vehicleId: id }, orderBy: { date: 'desc' }, include: { client: true, product: true, factory: true } }),
      this.prisma.payment.findMany({ where: { vehicleId: id, type: 'VEHICLE' }, orderBy: { date: 'desc' }, include: { cashbox: true } }),
    ]);
    const owed = orders.filter((o) => ['DELIVERED', 'COMPLETED'].includes(o.status)).reduce((s, o) => s + o.transportFee, 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    // balance > 0 → we owe the vehicle; balance < 0 → we prepaid it
    return { ...vehicle, orders, payments, totals: { owed, paid, balance: owed - paid, ordersCount: orders.length } };
  }
  create(d: any) { return this.prisma.vehicle.create({ data: { name: d.name, plate: d.plate ?? null, driver: d.driver ?? null, phone: d.phone ?? null } }); }
  update(id: string, d: any) { return this.prisma.vehicle.update({ where: { id }, data: d }); }
  remove(id: string) { return this.prisma.vehicle.delete({ where: { id } }); }
}
