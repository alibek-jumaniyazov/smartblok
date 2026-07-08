import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// map payment method -> cashbox name (seeded in prisma/seed.ts)
const CASHBOX_BY_METHOD: Record<string, string> = {
  CASH: 'Naqt kassa (UZS)',
  USD: 'Naqt kassa (USD)',
  CLICK: 'Click kassa',
  TERMINAL: 'Click kassa',
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
    if (q.clientId) where.clientId = Number(q.clientId);
    if (q.from || q.to) {
      where.date = {};
      if (q.from) where.date.gte = new Date(q.from);
      if (q.to) where.date.lte = new Date(q.to);
    }
    return this.prisma.payment.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { agent: true, client: true },
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

  // post an IN transaction into the matching cashbox (best-effort)
  private async postToCashbox(n: { method: string; amount: number; usdAmount: number; rate: number }, date: Date) {
    const boxName = CASHBOX_BY_METHOD[n.method];
    if (!boxName) return null;
    const box = await this.prisma.cashbox.findFirst({ where: { name: boxName } });
    if (!box) return null;
    const amount = box.currency === 'USD' ? n.usdAmount : n.amount;
    if (!amount) return null;
    await this.prisma.cashTransaction.create({
      data: { cashboxId: box.id, direction: 'IN', amount, rate: n.rate, source: 'PAYMENT', date, note: "To'lov" },
    });
    return box.id;
  }

  async create(dto: any) {
    const n = this.normalize(dto);
    const date = new Date(dto.date);
    const cashboxId = await this.postToCashbox(n, date);
    return this.prisma.payment.create({
      data: {
        date,
        agentId: dto.agentId ? Number(dto.agentId) : null,
        clientId: Number(dto.clientId),
        payerName: dto.payerName ?? null,
        note: dto.note ?? null,
        cashboxId,
        ...n,
      },
    });
  }

  update(id: number, dto: any) {
    const n = this.normalize(dto);
    return this.prisma.payment.update({
      where: { id },
      data: {
        ...(dto.date ? { date: new Date(dto.date) } : {}),
        ...(dto.agentId !== undefined ? { agentId: dto.agentId ? Number(dto.agentId) : null } : {}),
        ...(dto.clientId !== undefined ? { clientId: Number(dto.clientId) } : {}),
        ...(dto.payerName !== undefined ? { payerName: dto.payerName } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...n,
      },
    });
  }

  remove(id: number) { return this.prisma.payment.delete({ where: { id } }); }
}
