import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere, roundMoney } from '../common/recognition';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const payWhere = await recognizedPaymentWhere(this.prisma, { type: 'VEHICLE' });
    const vehicles = await this.prisma.vehicle.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { orders: true } } } });
    const [transportByVehicle, paysByVehicle] = await Promise.all([
      this.prisma.order.groupBy({ by: ['vehicleId'], where: RECOGNIZED_ORDER, _sum: { transportFee: true } }),
      this.prisma.payment.groupBy({ by: ['vehicleId'], where: payWhere, _sum: { amount: true } }),
    ]);
    const tMap = new Map(transportByVehicle.map((t) => [t.vehicleId, t._sum.transportFee ?? 0]));
    const pMap = new Map(paysByVehicle.map((p) => [p.vehicleId, p._sum.amount ?? 0]));
    return vehicles.map((v) => {
      const owed = tMap.get(v.id) ?? 0;
      const paid = pMap.get(v.id) ?? 0;
      return { ...v, transportTotal: owed, paid, balance: roundMoney(owed - paid) };
    });
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) return null;
    const [orders, payments] = await Promise.all([
      this.prisma.order.findMany({ where: { vehicleId: id }, orderBy: { date: 'desc' }, include: { client: true, product: true, factory: true } }),
      this.prisma.payment.findMany({ where: { vehicleId: id, type: 'VEHICLE' }, orderBy: { date: 'desc' }, include: { cashbox: true } }),
    ]);
    const cancelled = new Set(orders.filter((o) => o.status === 'CANCELLED').map((o) => o.id));
    const owed = orders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.transportFee, 0);
    const paid = payments.filter((p) => !p.orderId || !cancelled.has(p.orderId)).reduce((s, p) => s + p.amount, 0);
    // balance > 0 → we owe the vehicle; balance < 0 → we prepaid it
    return { ...vehicle, orders, payments, totals: { owed, paid, balance: roundMoney(owed - paid), ordersCount: orders.length } };
  }
  create(d: any) { return this.prisma.vehicle.create({ data: { name: d.name, plate: d.plate ?? null, driver: d.driver ?? null, phone: d.phone ?? null } }); }
  update(id: string, d: any) {
    const data: any = {};
    for (const k of ['name', 'plate', 'driver', 'phone']) if (d[k] !== undefined) data[k] = d[k];
    if (d.active !== undefined) data.active = !!d.active;
    return this.prisma.vehicle.update({ where: { id }, data });
  }
  // block deletion when history exists — deactivate instead
  async remove(id: string) {
    const [orders, payments] = await Promise.all([
      this.prisma.order.count({ where: { vehicleId: id } }),
      this.prisma.payment.count({ where: { vehicleId: id } }),
    ]);
    if (orders > 0 || payments > 0) {
      throw new BadRequestException('Moshinada buyurtma/to‘lov bor — o‘chirib bo‘lmaydi. Nofaol qiling.');
    }
    return this.prisma.vehicle.delete({ where: { id } });
  }
}
