import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { RequestUser } from '../common/scoping';
import { CreateLegalEntityDto, UpdateLegalEntityDto } from './dto';

/** Date-safe snapshot for AuditLog Json columns. */
const asJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

@Injectable()
export class LegalEntitiesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Small catalog — unpaged; payment forms need the full list. */
  findAll() {
    return this.prisma.legalEntity.findMany({ orderBy: { name: 'asc' } });
  }

  async create(dto: CreateLegalEntityDto, user: RequestUser) {
    let row;
    try {
      row = await this.prisma.legalEntity.create({
        data: { name: dto.name.trim(), kind: dto.kind, inn: dto.inn ?? null, note: dto.note ?? null },
      });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.CREATE,
      entity: 'LegalEntity',
      entityId: row.id,
      after: asJson(row),
    });
    return row;
  }

  async update(id: string, dto: UpdateLegalEntityDto, user: RequestUser) {
    const before = await this.prisma.legalEntity.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Yuridik shaxs topilmadi');
    const data: Prisma.LegalEntityUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.inn !== undefined) data.inn = dto.inn;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.active !== undefined) data.active = dto.active;
    let row;
    try {
      row = await this.prisma.legalEntity.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.UPDATE,
      entity: 'LegalEntity',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
    });
    return row;
  }

  /** Soft-delete: deactivate only — payments reference legal entities. */
  async deactivate(id: string, user: RequestUser) {
    const before = await this.prisma.legalEntity.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Yuridik shaxs topilmadi');
    if (!before.active) return before;
    const row = await this.prisma.legalEntity.update({ where: { id }, data: { active: false } });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.DELETE,
      entity: 'LegalEntity',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
      note: 'Soft-delete: yuridik shaxs nofaol qilindi',
    });
    return row;
  }

  private rethrowUnique(e: unknown): never {
    if ((e as { code?: string })?.code === 'P2002') {
      throw new BadRequestException('Bu nomli yuridik shaxs allaqachon mavjud');
    }
    throw e;
  }
}
