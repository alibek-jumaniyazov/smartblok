import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LedgerAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { ZERO } from '../common/money';
import { pageArgs, paged } from '../common/pagination';
import { cleanPlate, cleanText, findFleetVehicleByPlate, type FleetVehicleRef } from '../common/plate';
import { RequestUser } from '../common/scoping';
import { CreateVehicleDto, UpdateVehicleDto, VehicleQueryDto } from './dto';

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
  async findAll(user: RequestUser, q: VehicleQueryDto) {
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

    // one-time / ad-hoc trucks are hidden from every list and picker (they exist only
    // to carry a single order's transport ledger); the real fleet has oneTime=false.
    if (user.role === 'AGENT') {
      const where: Prisma.VehicleWhereInput = { active: true, oneTime: false, ...search };
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

    // ?active=true|false narrows the fleet; omitted ⇒ both, so archived trucks stay
    // findable (they still hold their plate in the unique index).
    const activeWhere: Prisma.VehicleWhereInput = q.active === undefined ? {} : { active: q.active };
    const listWhere: Prisma.VehicleWhereInput = { oneTime: false, ...activeWhere, ...search };
    const [rows, total, balances] = await Promise.all([
      this.prisma.vehicle.findMany({ where: listWhere, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.vehicle.count({ where: listWhere }),
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
    const plate = cleanPlate(dto.plate); // '' / '   ' / null → NULL (never a colliding '')
    if (plate) {
      const clash = await findFleetVehicleByPlate(this.prisma, plate);
      if (clash) throw this.plateConflict(clash, plate);
    }
    let row;
    try {
      row = await this.prisma.vehicle.create({
        data: {
          name: dto.name.trim(),
          plate,
          driver: cleanText(dto.driver),
          phone: cleanText(dto.phone),
          ...(dto.capacityPallets !== undefined ? { capacityPallets: dto.capacityPallets } : {}),
        },
      });
    } catch (e) {
      throw await this.uniqueError(e, plate);
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
    if (dto.plate !== undefined) {
      const plate = cleanPlate(dto.plate);
      if (plate) {
        const clash = await findFleetVehicleByPlate(this.prisma, plate, id); // excludes self
        if (clash) throw this.plateConflict(clash, plate);
      }
      data.plate = plate;
    }
    if (dto.driver !== undefined) data.driver = cleanText(dto.driver);
    if (dto.phone !== undefined) data.phone = cleanText(dto.phone);
    if (dto.capacityPallets !== undefined) data.capacityPallets = dto.capacityPallets;
    if (dto.active !== undefined) data.active = dto.active;
    let row;
    try {
      row = await this.prisma.vehicle.update({ where: { id }, data });
    } catch (e) {
      throw await this.uniqueError(e, cleanPlate(dto.plate));
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

  /**
   * Names the blocking vehicle and its state so «moshina bor deydi» is never a dead end.
   * The old message was a bare string: it named no vehicle, did not say the holder was
   * NOFAOL, and offered no way forward — and it fired even when no plate was typed.
   * The structured body lets the web offer «ochish» / «qayta faollashtirish» directly.
   */
  private plateConflict(v: FleetVehicleRef, typed: string): ConflictException {
    const shown = v.plate ?? typed;
    // Importdan kelgan moshinalarning nomi = raqami, shuning uchun «X raqami X
    // moshinasiga biriktirilgan» degan bema'ni matn chiqmasligi kerak.
    const named = v.name === shown ? '' : ` («${v.name}»)`;
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'VEHICLE_PLATE_TAKEN',
      vehicleId: v.id,
      vehicleName: v.name,
      vehiclePlate: shown,
      vehicleActive: v.active,
      message: v.active
        ? `«${shown}» davlat raqamli moshina${named} roʼyxatda allaqachon bor. Uni tahrirlang yoki boshqa raqam kiriting.`
        : `«${shown}» davlat raqamli moshina${named} roʼyxatda bor, lekin NOFAOL. Uni qayta faollashtiring yoki boshqa raqam kiriting.`,
    });
  }

  /** P2002 is now only reachable as a race (create/update pre-check first) — still name the row. */
  private async uniqueError(e: unknown, plate: string | null): Promise<unknown> {
    if ((e as { code?: string })?.code !== 'P2002' || !plate) return e;
    const clash = await findFleetVehicleByPlate(this.prisma, plate);
    return clash
      ? this.plateConflict(clash, plate)
      : new ConflictException(`«${plate}» davlat raqami boshqa moshinada band.`);
  }
}
