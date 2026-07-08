import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  // Agents only see their own clients
  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  async findAll(user: any) {
    const where = this.scope(user);
    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { agent: true, region: true },
    });

    const [salesByClient, paysByClient, palletsByClient] = await Promise.all([
      this.prisma.sale.groupBy({ by: ['clientId'], _sum: { saleTotal: true, palletQty: true } }),
      this.prisma.payment.groupBy({ by: ['clientId'], _sum: { amount: true } }),
      this.prisma.palletMovement.groupBy({ by: ['clientId'], _sum: { issuedQty: true, returnedQty: true } }),
    ]);

    const sMap = new Map(salesByClient.map((s) => [s.clientId, s._sum]));
    const pMap = new Map(paysByClient.map((p) => [p.clientId, p._sum]));
    const palMap = new Map(palletsByClient.map((p) => [p.clientId, p._sum]));

    return clients.map((c) => {
      const delivered = sMap.get(c.id)?.saleTotal ?? 0;
      const paid = pMap.get(c.id)?.amount ?? 0;
      const palIssued = palMap.get(c.id)?.issuedQty ?? 0;
      const palReturned = palMap.get(c.id)?.returnedQty ?? 0;
      return {
        ...c,
        delivered,
        paid,
        balance: paid - delivered, // negative = client owes money (qarzdor)
        palletBalance: palIssued - palReturned,
      };
    });
  }

  async findOne(id: number) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { agent: true, region: true },
    });
    if (!client) throw new NotFoundException('Mijoz topilmadi');
    return client;
  }

  create(data: any) { return this.prisma.client.create({ data }); }
  update(id: number, data: any) { return this.prisma.client.update({ where: { id }, data }); }
  remove(id: number) { return this.prisma.client.delete({ where: { id } }); }
}
