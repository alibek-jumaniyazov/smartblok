import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// method -> cashbox name (seeded)
const CASHBOX_BY_METHOD: Record<string, string> = {
  CASH: 'Naqt kassa (UZS)',
  USD: 'Naqt kassa (USD)',
  CLICK: 'Click kassa',
  TERMINAL: 'Click kassa',
  BANK: 'Bank kassa',
  TRANSFER: 'Bank kassa',
};

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  findAll(user: any, q: any = {}) {
    const where: any = { ...this.scope(user) };
    if (q.type) where.type = q.type;
    if (q.clientId) where.clientId = q.clientId;
    if (q.factoryId) where.factoryId = q.factoryId;
    if (q.vehicleId) where.vehicleId = q.vehicleId;
    return this.prisma.payment.findMany({
      where, orderBy: { date: 'desc' },
      include: { agent: true, client: true, factory: true, vehicle: true, order: true, cashbox: true },
    });
  }

  private normalize(dto: any) {
    const method = dto.method || 'CASH';
    let amount = Number(dto.amount) || 0;
    const usdAmount = Number(dto.usdAmount) || 0;
    const rate = Number(dto.rate) || 0;
    if (method === 'USD' && usdAmount && rate) amount = usdAmount * rate;
    return { method, amount, usdAmount, rate };
  }

  private async postToCashbox(type: string, n: any, date: Date, note: string) {
    const boxName = CASHBOX_BY_METHOD[n.method];
    if (!boxName) return null;
    const box = await this.prisma.cashbox.findFirst({ where: { name: boxName } });
    if (!box) return null;
    const amount = box.currency === 'USD' ? n.usdAmount : n.amount;
    if (!amount) return box.id;
    const direction = type === 'CLIENT' ? 'IN' : 'OUT'; // client pays us = IN; we pay factory/vehicle = OUT
    await this.prisma.cashTransaction.create({
      data: { cashboxId: box.id, direction, amount, rate: n.rate, source: 'PAYMENT', date, note },
    });
    return box.id;
  }

  async create(dto: any) {
    const type = dto.type || 'CLIENT';
    const n = this.normalize(dto);
    const date = dto.date ? new Date(dto.date) : new Date();
    const cashboxId = await this.postToCashbox(type, n, date, "Tolov: " + type);
    return this.prisma.payment.create({
      data: {
        date, type,
        agentId: dto.agentId || null,
        clientId: type === 'CLIENT' ? (dto.clientId || null) : null,
        factoryId: type === 'FACTORY' ? (dto.factoryId || null) : null,
        vehicleId: type === 'VEHICLE' ? (dto.vehicleId || null) : null,
        orderId: dto.orderId || null,
        payerName: dto.payerName ?? null,
        note: dto.note ?? null,
        cashboxId,
        ...n,
      },
      include: { client: true, factory: true, vehicle: true },
    });
  }

  remove(id: string) { return this.prisma.payment.delete({ where: { id } }); }
}
