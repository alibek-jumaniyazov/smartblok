import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  create(dto: any) {
    const n = this.normalize(dto);
    return this.prisma.payment.create({
      data: {
        date: new Date(dto.date),
        agentId: dto.agentId ? Number(dto.agentId) : null,
        clientId: Number(dto.clientId),
        payerName: dto.payerName ?? null,
        note: dto.note ?? null,
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
