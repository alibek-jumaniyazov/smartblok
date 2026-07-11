import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit.service';
import { RequestUser } from '../common/scoping';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto';

const BCRYPT_ROUNDS = 12;

/** Password is NEVER selected — no route can leak a hash. */
const SAFE_SELECT = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  active: true,
  agentId: true,
  agent: { select: { id: true, name: true } },
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/** Audit snapshot: identity fields only; password always masked, never a hash. */
const auditSnapshot = (u: Partial<User>) => ({
  username: u.username,
  email: u.email ?? null,
  name: u.name,
  role: u.role,
  phone: u.phone ?? null,
  active: u.active,
  agentId: u.agentId ?? null,
  password: '***',
});

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    return user;
  }

  async create(dto: CreateUserDto, actor: RequestUser) {
    if (dto.role === Role.AGENT && !dto.agentId) {
      throw new BadRequestException("AGENT roli uchun agentId ko'rsatilishi shart");
    }
    if (dto.agentId) {
      const agent = await this.prisma.agent.findUnique({ where: { id: dto.agentId } });
      if (!agent) throw new BadRequestException('Agent topilmadi');
    }
    const dupUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (dupUsername) throw new ConflictException('Bu username allaqachon band');
    if (dto.email) {
      const dupEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (dupEmail) throw new ConflictException('Bu email allaqachon band');
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          password,
          name: dto.name,
          role: dto.role,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          agentId: dto.agentId ?? null,
        },
        select: SAFE_SELECT,
      });
      await this.audit.log({
        tx,
        userId: actor.userId,
        action: AuditAction.CREATE,
        entity: 'User',
        entityId: user.id,
        after: auditSnapshot({ ...dto, active: true } as Partial<User>),
      });
      return user;
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: RequestUser) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Foydalanuvchi topilmadi');

    const nextRole = dto.role ?? existing.role;
    const nextActive = dto.active ?? existing.active;

    if (id === actor.userId && dto.active === false) {
      throw new BadRequestException("O'z hisobingizni bloklab bo'lmaysiz");
    }
    if (
      existing.role === Role.ADMIN &&
      existing.active &&
      (nextRole !== Role.ADMIN || nextActive === false)
    ) {
      await this.assertNotLastAdmin(id);
    }
    if (nextRole === Role.AGENT) {
      const effectiveAgentId = dto.agentId !== undefined ? dto.agentId : existing.agentId;
      if (!effectiveAgentId) {
        throw new BadRequestException("AGENT roli uchun agentId ko'rsatilishi shart");
      }
    }
    if (dto.agentId) {
      const agent = await this.prisma.agent.findUnique({ where: { id: dto.agentId } });
      if (!agent) throw new BadRequestException('Agent topilmadi');
    }
    if (dto.username && dto.username !== existing.username) {
      const dup = await this.prisma.user.findUnique({ where: { username: dto.username } });
      if (dup) throw new ConflictException('Bu username allaqachon band');
    }
    if (dto.email && dto.email !== existing.email) {
      const dup = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (dup) throw new ConflictException('Bu email allaqachon band');
    }

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.agentId !== undefined) data.agentId = dto.agentId || null;
    if (dto.active !== undefined) data.active = dto.active;

    // Session-kill triggers: password change, deactivation, role change.
    let bumpTokenVersion = false;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      bumpTokenVersion = true;
    }
    if (dto.active === false && existing.active) bumpTokenVersion = true;
    if (dto.role !== undefined && dto.role !== existing.role) bumpTokenVersion = true;
    if (bumpTokenVersion) data.tokenVersion = { increment: 1 };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data, select: SAFE_SELECT });
      await this.audit.log({
        tx,
        userId: actor.userId,
        action: AuditAction.UPDATE,
        entity: 'User',
        entityId: id,
        before: auditSnapshot(existing),
        after: auditSnapshot({ ...existing, ...updated } as Partial<User>),
        note: dto.password ? 'parol almashtirildi (sessiyalar bekor qilindi)' : null,
      });
      return updated;
    });
  }

  /** Soft-delete: deactivate + kill live sessions. Never a hard delete. */
  async deactivate(id: string, actor: RequestUser) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Foydalanuvchi topilmadi');
    if (id === actor.userId) {
      throw new BadRequestException("O'z hisobingizni bloklab bo'lmaysiz");
    }
    if (existing.role === Role.ADMIN && existing.active) {
      await this.assertNotLastAdmin(id);
    }
    if (!existing.active) {
      return this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { active: false, tokenVersion: { increment: 1 } },
        select: SAFE_SELECT,
      });
      await this.audit.log({
        tx,
        userId: actor.userId,
        action: AuditAction.DELETE,
        entity: 'User',
        entityId: id,
        before: auditSnapshot(existing),
        after: auditSnapshot({ ...existing, active: false }),
        note: 'deaktivatsiya (soft delete)',
      });
      return updated;
    });
  }

  private async assertNotLastAdmin(excludeId: string) {
    const otherAdmins = await this.prisma.user.count({
      where: { role: Role.ADMIN, active: true, id: { not: excludeId } },
    });
    if (otherAdmins === 0) {
      throw new BadRequestException("Oxirgi administratorni bloklab bo'lmaydi");
    }
  }
}
