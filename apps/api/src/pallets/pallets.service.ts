import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PalletsService {
  constructor(private prisma: PrismaService) {}

  findAll(q: any = {}) {
    const where: any = {};
    if (q.clientId) where.clientId = Number(q.clientId);
    return this.prisma.palletMovement.findMany({
      where, orderBy: { date: 'desc' }, include: { client: true },
    });
  }

  async summary() {
    const grouped = await this.prisma.palletMovement.groupBy({
      by: ['clientId'], _sum: { issuedQty: true, returnedQty: true },
    });
    const clients = await this.prisma.client.findMany();
    const cMap = new Map(clients.map((c) => [c.id, c.name]));
    const rows = grouped.map((g) => ({
      clientId: g.clientId,
      client: cMap.get(g.clientId) ?? '—',
      issued: g._sum.issuedQty ?? 0,
      returned: g._sum.returnedQty ?? 0,
      balance: (g._sum.issuedQty ?? 0) - (g._sum.returnedQty ?? 0),
    })).sort((a, b) => b.balance - a.balance);
    const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
    return { totalBalance, rows };
  }

  // record a pallet return
  createReturn(dto: any) {
    return this.prisma.palletMovement.create({
      data: {
        clientId: Number(dto.clientId),
        returnedQty: Number(dto.returnedQty) || 0,
        date: dto.date ? new Date(dto.date) : new Date(),
        note: dto.note ?? 'Poddon qaytimi',
      },
    });
  }

  remove(id: number) { return this.prisma.palletMovement.delete({ where: { id } }); }
}
