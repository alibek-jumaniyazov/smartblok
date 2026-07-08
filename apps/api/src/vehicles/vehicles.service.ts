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

  findOne(id: string) { return this.prisma.vehicle.findUnique({ where: { id } }); }
  create(d: any) { return this.prisma.vehicle.create({ data: { name: d.name, plate: d.plate ?? null, driver: d.driver ?? null, phone: d.phone ?? null } }); }
  update(id: string, d: any) { return this.prisma.vehicle.update({ where: { id }, data: d }); }
  remove(id: string) { return this.prisma.vehicle.delete({ where: { id } }); }
}
