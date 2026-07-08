import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const safe = { id: true, email: true, name: true, role: true, phone: true, active: true, agentId: true, createdAt: true };

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: { ...safe, agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: any) {
    const password = await bcrypt.hash(dto.password || 'smartblok', 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        role: dto.role || 'AGENT',
        phone: dto.phone ?? null,
        active: dto.active ?? true,
        agentId: dto.agentId ? Number(dto.agentId) : null,
        password,
      },
      select: safe,
    });
  }

  async update(id: number, dto: any) {
    const data: any = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.agentId !== undefined) data.agentId = dto.agentId ? Number(dto.agentId) : null;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    return this.prisma.user.update({ where: { id }, data, select: safe });
  }

  remove(id: number) {
    return this.prisma.user.delete({ where: { id } });
  }
}
