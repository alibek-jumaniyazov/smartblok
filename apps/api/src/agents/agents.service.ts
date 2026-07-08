import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.agent.findMany({
      orderBy: { groupNo: 'asc' },
      include: { _count: { select: { clients: true, sales: true, payments: true } } },
    });
  }

  async findOne(id: number) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: { clients: true },
    });
    if (!agent) throw new NotFoundException('Agent topilmadi');
    return agent;
  }

  create(data: any) {
    return this.prisma.agent.create({ data });
  }

  update(id: number, data: any) {
    return this.prisma.agent.update({ where: { id }, data });
  }

  remove(id: number) {
    return this.prisma.agent.delete({ where: { id } });
  }
}
