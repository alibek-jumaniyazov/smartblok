import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LedgerAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { ZERO } from '../common/money';
import { pageArgs, paged, PageQueryDto } from '../common/pagination';
import { RequestUser } from '../common/scoping';
import { CreateVehicleDto, UpdateVehicleDto } from './dto';

/** Decimal/Date-safe snapshot for AuditLog Json columns. */
const asJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

@Injectable()
export class VehiclesService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
  ) {}

  /**
   * AGENT: active vehicles, order-form fields only (no financials).
   * ADMIN/ACCOUNTANT: full rows + ledger balance (<0 ⇒ dealer owes the driver).
   */
  async findAll(user: RequestUser, q: PageQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const search: Prisma.VehicleWhereInput = q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: Prisma.QueryMode.insensitive } },
            { plate: { contains: q.search, mode: Prisma.QueryMode.insensitive } },
            { driver: { contains: q.search, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {};

    if (user.role === 'AGENT') {
      const where: Prisma.VehicleWhereInput = { active: true, ...search };
      const [rows, total] = await Promise.all([
        this.prisma.vehicle.findMany({
          where,
          orderBy: { name: 'asc' },
          skip,
          take,
          select: { id: true, name: true, plate: true, driver: true, capacityPallets: true },
        }),
        this.prisma.vehicle.count({ where }),
      ]);
      return paged(rows, total, page, pageSize);
    }

    const [rows, total, balances] = await Promise.all([
      this.prisma.vehicle.findMany({ where: search, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.vehicle.count({ where: search }),
      this.ledger.vehicleBalances(),
    ]);
    const items = rows.map((v) => ({ ...v, balance: balances.get(v.id) ?? ZERO }));
    return paged(items, total, page, pageSize);
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Moshina topilmadi');
    const [statement, orders, balance] = await Promise.all([
      this.ledger.statement(LedgerAccount.VEHICLE, id),
      this.prisma.order.findMany({
        where: { vehicleId: id },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          orderNo: true,
          date: true,
          status: true,
          transportMode: true,
          transportCost: true,
          transportCharge: true,
          transportPaidStatus: true,
          transportPaidAt: true,
          client: { select: { id: true, name: true } },
          factory: { select: { id: true, name: true } },
        },
      }),
      this.ledger.vehicleBalance(id),
    ]);
    return { ...vehicle, balance, statement, orders };
  }

  async create(dto: CreateVehicleDto, user: RequestUser) {
    let row;
    try {
      row = await this.prisma.vehicle.create({
        data: {
          name: dto.name.trim(),
          plate: dto.plate ?? null,
          driver: dto.driver ?? null,
          phone: dto.phone ?? null,
          ...(dto.capacityPallets !== undefined ? { capacityPallets: dto.capacityPallets } : {}),
        },
      });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.CREATE,
      entity: 'Vehicle',
      entityId: row.id,
      after: asJson(row),
    });
    return row;
  }

  async update(id: string, dto: UpdateVehicleDto, user: RequestUser) {
    const before = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Moshina topilmadi');
    const data: Prisma.VehicleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.plate !== undefined) data.plate = dto.plate;
    if (dto.driver !== undefined) data.driver = dto.driver;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.capacityPallets !== undefined) data.capacityPallets = dto.capacityPallets;
    if (dto.active !== undefined) data.active = dto.active;
    let row;
    try {
      row = await this.prisma.vehicle.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUnique(e);
    }
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.UPDATE,
      entity: 'Vehicle',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
    });
    return row;
  }

  /** Soft-delete: vehicles deactivate (active=false), never hard-delete. */
  async deactivate(id: string, user: RequestUser) {
    const before = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Moshina topilmadi');
    if (!before.active) return before;
    const row = await this.prisma.vehicle.update({ where: { id }, data: { active: false } });
    await this.audit.log({
      userId: user.userId,
      action: AuditAction.DELETE,
      entity: 'Vehicle',
      entityId: id,
      before: asJson(before),
      after: asJson(row),
      note: 'Soft-delete: moshina nofaol qilindi',
    });
    return row;
  }

  private rethrowUnique(e: unknown): never {
    if ((e as { code?: string })?.code === 'P2002') {
      throw new BadRequestException('Bu davlat raqamli moshina allaqachon mavjud');
    }
    throw e;
  }
}
