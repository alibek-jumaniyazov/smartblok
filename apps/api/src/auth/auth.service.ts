import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, UpdateProfileDto } from './dto';

const safe = { id: true, username: true, email: true, name: true, role: true, phone: true, active: true, agentId: true };

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async validateAndLogin(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Login yoki parol xato');
    }
    if (!user.active) throw new ForbiddenException('Hisob bloklangan');
    return this.sign(user);
  }

  async me(userId: number) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: safe });
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.update({ where: { id: userId }, data, select: safe });
  }

  private sign(user: { id: number; username: string; role: string; name: string; agentId: number | null }) {
    const payload = { sub: user.id, username: user.username, role: user.role, name: user.name, agentId: user.agentId };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, username: user.username, name: user.name, role: user.role, agentId: user.agentId },
    };
  }
}
