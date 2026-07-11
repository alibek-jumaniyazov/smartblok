import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRegionDto, UpdateRegionDto } from './dto';

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class RegionsService {
  constructor(private prisma: PrismaService) {}

  /** Small catalog — unpaged by design. */
  findAll() {
    return this.prisma.region.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { clients: true } } },
    });
  }

  async create(dto: CreateRegionDto) {
    try {
      return await this.prisma.region.create({
        data: { name: dto.name, note: dto.note ?? null },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Bu nomdagi hudud allaqachon mavjud');
      throw e;
    }
  }

  async update(id: string, dto: UpdateRegionDto) {
    const existing = await this.prisma.region.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Hudud topilmadi');
    try {
      return await this.prisma.region.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Bu nomdagi hudud allaqachon mavjud');
      throw e;
    }
  }

  /**
   * Region has no active flag — hard delete is only allowed while nothing
   * references it (not financial data, so hard delete is acceptable here).
   */
  async remove(id: string) {
    const existing = await this.prisma.region.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Hudud topilmadi');
    const [clients, routes] = await Promise.all([
      this.prisma.client.count({ where: { regionId: id } }),
      this.prisma.logisticsRoute.count({ where: { regionId: id } }),
    ]);
    if (clients > 0 || routes > 0) {
      throw new BadRequestException(
        "Hudud mijozlar yoki marshrutlarda ishlatilmoqda — o'chirib bo'lmaydi",
      );
    }
    return this.prisma.region.delete({ where: { id } });
  }
}
