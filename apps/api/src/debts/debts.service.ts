import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DebtsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const [clients, factories, vehicles, ordersC, ordersF, ordersV, payC, payF, payV] = await Promise.all([
      this.prisma.client.findMany({ include: { agent: true } }),
      this.prisma.factory.findMany(),
      this.prisma.vehicle.findMany(),
      this.prisma.order.groupBy({ by: ['clientId'], where: { status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { saleTotal: true } }),
      this.prisma.order.groupBy({ by: ['factoryId'], where: { status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { costTotal: true } }),
      this.prisma.order.groupBy({ by: ['vehicleId'], where: { status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { transportFee: true } }),
      this.prisma.payment.groupBy({ by: ['clientId'], where: { type: 'CLIENT' }, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['factoryId'], where: { type: 'FACTORY' }, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['vehicleId'], where: { type: 'VEHICLE' }, _sum: { amount: true } }),
    ]);
    const m = (arr: any[], key: string, field: string) => new Map(arr.map((x) => [x[key], x._sum[field] ?? 0]));
    const ocM = m(ordersC, 'clientId', 'saleTotal'), pcM = m(payC, 'clientId', 'amount');
    const ofM = m(ordersF, 'factoryId', 'costTotal'), pfM = m(payF, 'factoryId', 'amount');
    const ovM = m(ordersV, 'vehicleId', 'transportFee'), pvM = m(payV, 'vehicleId', 'amount');

    const clientRows = clients.map((c) => {
      const delivered = ocM.get(c.id) ?? 0, paid = pcM.get(c.id) ?? 0;
      return { id: c.id, name: c.name, agent: c.agent?.name ?? null, delivered, paid, balance: delivered - paid };
    }).filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);

    const factoryRows = factories.map((f) => {
      const cost = ofM.get(f.id) ?? 0, paid = pfM.get(f.id) ?? 0;
      return { id: f.id, name: f.name, cost, paid, balance: cost - paid };
    }).filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);

    const vehicleRows = vehicles.map((v) => {
      const owed = ovM.get(v.id) ?? 0, paid = pvM.get(v.id) ?? 0;
      return { id: v.id, name: v.name, owed, paid, balance: owed - paid };
    }).filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);

    return {
      clients: clientRows,
      factories: factoryRows,
      vehicles: vehicleRows,
      totals: {
        clientsOweUs: clientRows.reduce((s, r) => s + Math.max(0, r.balance), 0),
        clientsAdvance: clientRows.reduce((s, r) => s + Math.max(0, -r.balance), 0),
        weOweFactories: factoryRows.reduce((s, r) => s + r.balance, 0),
        weOweVehicles: vehicleRows.reduce((s, r) => s + r.balance, 0),
      },
    };
  }
}
