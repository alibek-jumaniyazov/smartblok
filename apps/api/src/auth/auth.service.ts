import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, UpdateProfileDto } from './dto';

const safe = { id: true, username: true, email: true, name: true, role: true, phone: true, active: true, agentId: true };
// A precomputed hash to compare against when the username is unknown, so login takes the same time
// whether or not the account exists (defeats timing-based user enumeration).
const DUMMY_HASH = '$2a$10$e18FhDN.yOLoa.3L7ECsgedjO8F0rzxqI3ndlX0.meO.HJuok0ESK';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async validateAndLogin(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    const ok = await bcrypt.compare(dto.password, user?.password ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Login yoki parol xato');
    if (!user.active) throw new ForbiddenException('Hisob bloklangan');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.sign(user);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: safe });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 12);
      // invalidate every other session on password change
      data.tokenVersion = { increment: 1 };
    }
    const updated = await this.prisma.user.update({ where: { id: userId }, data, select: { ...safe, tokenVersion: true } });
    if (dto.password) return this.sign(await this.prisma.user.findUniqueOrThrow({ where: { id: userId } }));
    return updated;
  }

  private sign(user: { id: string; username: string; role: string; name: string; agentId: string | null; tokenVersion?: number }) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      agentId: user.agentId,
      tv: user.tokenVersion ?? 0,
    };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, username: user.username, name: user.name, role: user.role, agentId: user.agentId },
    };
  }
}
