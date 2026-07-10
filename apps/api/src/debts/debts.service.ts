import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere, roundMoney } from '../common/recognition';

@Injectable()
export class DebtsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const [payCliWhere, payFacWhere, payVehWhere] = await Promise.all([
      recognizedPaymentWhere(this.prisma, { type: 'CLIENT' }),
      recognizedPaymentWhere(this.prisma, { type: 'FACTORY' }),
      recognizedPaymentWhere(this.prisma, { type: 'VEHICLE' }),
    ]);
    const [clients, factories, vehicles, ordersC, ordersF, ordersV, payC, payF, payV] = await Promise.all([
      this.prisma.client.findMany({ include: { agent: true } }),
      this.prisma.factory.findMany(),
      this.prisma.vehicle.findMany(),
      // A booked (non-cancelled) order is recognized as owed the moment it exists.
      this.prisma.order.groupBy({ by: ['clientId'], where: RECOGNIZED_ORDER, _sum: { saleTotal: true } }),
      this.prisma.order.groupBy({ by: ['factoryId'], where: RECOGNIZED_ORDER, _sum: { costTotal: true } }),
      this.prisma.order.groupBy({ by: ['vehicleId'], where: RECOGNIZED_ORDER, _sum: { transportFee: true } }),
      // Payments tied to a cancelled order are excluded (see recognizedPaymentWhere).
      this.prisma.payment.groupBy({ by: ['clientId'], where: payCliWhere, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['factoryId'], where: payFacWhere, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['vehicleId'], where: payVehWhere, _sum: { amount: true } }),
    ]);
    const m = (arr: any[], key: string, field: string) => new Map(arr.map((x) => [x[key], x._sum[field] ?? 0]));
    const ocM = m(ordersC, 'clientId', 'saleTotal'), pcM = m(payC, 'clientId', 'amount');
    const ofM = m(ordersF, 'factoryId', 'costTotal'), pfM = m(payF, 'factoryId', 'amount');
    const ovM = m(ordersV, 'vehicleId', 'transportFee'), pvM = m(payV, 'vehicleId', 'amount');

    const clientRows = clients.map((c) => {
      const delivered = ocM.get(c.id) ?? 0, paid = pcM.get(c.id) ?? 0;
      return { id: c.id, name: c.name, agent: c.agent?.name ?? null, delivered, paid, balance: roundMoney(delivered - paid) };
    }).filter((r) => Math.abs(r.balance) >= 1).sort((a, b) => b.balance - a.balance);

    const factoryRows = factories.map((f) => {
      const cost = ofM.get(f.id) ?? 0, paid = pfM.get(f.id) ?? 0;
      return { id: f.id, name: f.name, cost, paid, balance: roundMoney(cost - paid) };
    }).filter((r) => Math.abs(r.balance) >= 1).sort((a, b) => b.balance - a.balance);

    const vehicleRows = vehicles.map((v) => {
      const owed = ovM.get(v.id) ?? 0, paid = pvM.get(v.id) ?? 0;
      return { id: v.id, name: v.name, owed, paid, balance: roundMoney(owed - paid) };
    }).filter((r) => Math.abs(r.balance) >= 1).sort((a, b) => b.balance - a.balance);

    // Clamp each party's totals so one party's advance never nets against another party's debt.
    const owe = (rows: { balance: number }[]) => rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
    const adv = (rows: { balance: number }[]) => rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);

    return {
      clients: clientRows,
      factories: factoryRows,
      vehicles: vehicleRows,
      totals: {
        clientsOweUs: owe(clientRows),
        clientsAdvance: adv(clientRows),
        weOweFactories: owe(factoryRows),
        factoriesAdvance: adv(factoryRows),
        weOweVehicles: owe(vehicleRows),
        vehiclesAdvance: adv(vehicleRows),
      },
    };
  }
}
