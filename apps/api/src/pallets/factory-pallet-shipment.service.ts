import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, FactoryPalletShipmentStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PALLET_STOCK_LOCK, assertFactoryDefectsSupported } from '../common/pallet-defects';
import { outstandingFactoryShipments } from '../common/pallet-shipments';
import { pageArgs, paged } from '../common/pagination';
import { RequestUser } from '../common/scoping';
import { parseTashkentFrom, tashkentDateStr } from '../common/tashkent-time';
import { PalletService } from './pallets.service';
import { DispatchFactoryPalletDto, FactoryPalletArrivalDto, FactoryPalletShipmentQueryDto, InspectFactoryPalletDto, ReturnRejectedPalletDto } from './factory-pallet-shipment.dto';

const include = {
  factory: { select: { id: true, name: true } },
  inspections: { include: { lines: true }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
  warehouseReturns: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.FactoryPalletShipmentInclude;
type Shipment = Prisma.FactoryPalletShipmentGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
const MAX_AMOUNT = new Prisma.Decimal('9999999999999999.99');

/** Physical custody and factory acceptance are separate events. Acceptance prices
 * are documented valuations; they do not post a second credit to goods or cash. */
@Injectable()
export class FactoryPalletShipmentService {
  constructor(private readonly prisma: PrismaService, private readonly pallets: PalletService, private readonly audit: AuditService) {}

  private authorize(user: RequestUser) {
    if (!user || !['ADMIN', 'ACCOUNTANT'].includes(user.role)) throw new ForbiddenException('Poddon reyslarini faqat administrator va buxgalter boshqaradi');
  }
  private text(value: unknown, label: string, max: number, required = false): string | null {
    if (value === undefined || value === null) {
      if (required) throw new BadRequestException(`${label} kiritilishi kerak`);
      return null;
    }
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new BadRequestException(`${label} noto‘g‘ri kiritilgan`);
    return value.trim() || null;
  }
  private qty(value: number, zero = false) {
    if (!Number.isInteger(value) || value < (zero ? 0 : 1) || value > 2147483647) throw new BadRequestException('Poddon soni butun va ruxsat etilgan miqdorda bo‘lishi kerak');
    return value;
  }
  private date(value: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$)/.test(value)) {
      throw new BadRequestException('Sana YYYY-MM-DD yoki vaqt mintaqasi aniq ko‘rsatilgan ISO shaklida bo‘lishi kerak');
    }
    const prefix = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value) : null;
    const calendar = prefix && new Date(`${prefix[1]}T00:00:00Z`);
    const date = prefix ? parseTashkentFrom(value) : undefined;
    if (!date || !calendar || Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== prefix![1] || Number.isNaN(date.getTime())) throw new BadRequestException('Sana noto‘g‘ri');
    if (tashkentDateStr(date) > tashkentDateStr(new Date())) throw new BadRequestException('Kelajak sanasiga poddon harakatini yozib bo‘lmaydi');
    return date;
  }
  private key(value: string) {
    if (!isUUID(value ?? '')) throw new BadRequestException('Takroriy amalni himoyalovchi requestKey noto‘g‘ri');
    return value;
  }
  private hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private retry(row: { requestHash: string; createdById: string }, hash: string, user: RequestUser) {
    if (row.requestHash !== hash || row.createdById !== user.userId) throw new ConflictException('Bu so‘rov kaliti boshqa ma’lumot uchun ishlatilgan. Yangi amalni qaytadan oching');
  }
  private async lock(tx: Tx, id?: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PALLET_STOCK_LOCK})`;
    if (id) await tx.$executeRaw`SELECT id FROM "FactoryPalletShipment" WHERE id = ${id} FOR UPDATE`;
  }
  private async read(tx: Tx, id: string): Promise<Shipment> {
    const row = await tx.factoryPalletShipment.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException('Poddon reysi topilmadi');
    return row;
  }
  private totals(row: Shipment) {
    const live = row.inspections.filter(i => !i.voidedAt);
    const acceptedQty = live.reduce((n, i) => n + i.lines.reduce((a, l) => a + l.qty, 0), 0);
    const rejectedQty = live.reduce((n, i) => n + i.rejectedQty, 0);
    const returnedQty = row.warehouseReturns.filter(r => !r.voidedAt).reduce((n, r) => n + r.qty, 0);
    const acceptanceTotal = live.reduce((n, i) => i.lines.reduce((a, l) => a.add(l.amount), n), new Prisma.Decimal(0)).toFixed(2);
    return { acceptedQty, rejectedQty, returnedQty, acceptanceTotal,
      uninspectedQty: row.cancelledAt ? 0 : row.qty - acceptedQty - rejectedQty,
      rejectedOutstandingQty: row.cancelledAt ? 0 : rejectedQty - returnedQty,
      outstandingQty: row.cancelledAt ? 0 : row.qty - acceptedQty - returnedQty };
  }
  private result(row: Shipment) {
    const { requestHash: _hash, requestKey: _key, ...safe } = row;
    return { ...safe, ...this.totals(row), inspections: row.inspections.map(({ requestHash: _h, requestKey: _k, ...i }) => ({ ...i,
      lines: i.lines.map(l => ({ ...l, unitPrice: l.unitPrice.toFixed(2), amount: l.amount.toFixed(2) })) })),
      warehouseReturns: row.warehouseReturns.map(({ requestHash: _h, requestKey: _k, ...r }) => r) };
  }
  private assertActive(row: Shipment) {
    if (row.cancelledAt) throw new BadRequestException('Bekor qilingan reysda amal bajarib bo‘lmaydi');
  }
  private assertChronology(row: Shipment, date: Date) {
    const last = Math.max(row.dispatchedAt.getTime(), row.arrivedAt?.getTime() ?? 0,
      ...row.inspections.filter(i => !i.voidedAt).map(i => i.date.getTime()), ...row.warehouseReturns.filter(r => !r.voidedAt).map(r => r.date.getTime()));
    if (date.getTime() < last) throw new BadRequestException('Sana reysning oldingi harakatidan avval bo‘lishi mumkin emas');
  }
  private async finish(tx: Tx, id: string) {
    const row = await this.read(tx, id), totals = this.totals(row);
    const status: FactoryPalletShipmentStatus = row.cancelledAt ? 'CANCELLED' : !row.arrivedAt ? 'IN_TRANSIT'
      : totals.uninspectedQty > 0 ? 'INSPECTING' : totals.rejectedOutstandingQty > 0 ? 'AWAITING_RETURN' : 'COMPLETED';
    if (row.status !== status) { await tx.factoryPalletShipment.update({ where: { id }, data: { status } }); row.status = status; }
    await assertFactoryDefectsSupported(tx);
    return this.result(row);
  }
  private transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(run, { maxWait: 15000, timeout: 30000 });
  }

  async list(query: FactoryPalletShipmentQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(query);
    const where: Prisma.FactoryPalletShipmentWhereInput = { factoryId: query.factoryId, status: query.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.factoryPalletShipment.findMany({ where, include, skip, take, orderBy: { returnNo: 'desc' } }),
      this.prisma.factoryPalletShipment.count({ where }),
    ]);
    return paged(rows.map(r => this.result(r)), total, page, pageSize);
  }
  async detail(id: string) { return this.result(await this.read(this.prisma, id)); }

  async dispatch(dto: DispatchFactoryPalletDto, user: RequestUser) {
    this.authorize(user);
    if (!isUUID(dto.factoryId ?? '')) throw new BadRequestException('Zavod tanlanishi kerak');
    const requestKey = this.key(dto.requestKey);
    const data = { factoryId: dto.factoryId, qty: this.qty(dto.qty), dispatchedAt: this.date(dto.date),
      vehiclePlate: this.text(dto.vehiclePlate, 'Mashina raqami', 40, true)!, driverName: this.text(dto.driverName, 'Haydovchi', 150, true)!,
      note: this.text(dto.note, 'Izoh', 1000) };
    const requestHash = this.hash(data);
    return this.transaction(async tx => {
      await this.lock(tx);
      const previous = await tx.factoryPalletShipment.findUnique({ where: { requestKey } });
      if (previous) { this.retry(previous, requestHash, user); return this.result(await this.read(tx, previous.id)); }
      await tx.$executeRaw`SELECT id FROM "Factory" WHERE id = ${dto.factoryId} FOR UPDATE`;
      const factory = await tx.factory.findUnique({ where: { id: dto.factoryId } });
      if (!factory) throw new NotFoundException('Zavod topilmadi');
      if (!factory.active) throw new BadRequestException('Nofaol zavodga yangi reys ochib bo‘lmaydi');
      const stock = await this.pallets.dealerInHandOn(tx), owed = await this.pallets.factoryBalanceOn(tx, dto.factoryId);
      const reserved = (await outstandingFactoryShipments(tx, dto.factoryId)).get(dto.factoryId) ?? 0;
      const cap = Math.max(0, Math.min(stock, owed - reserved));
      if (data.qty > cap) throw new BadRequestException(`Jo‘natish uchun eng ko‘pi ${cap} dona: omborda ${stock}, zavodga majburiyat ${owed}, boshqa reyslarda ${reserved} dona`);
      const row = await tx.factoryPalletShipment.create({ data: { ...data, requestKey, requestHash, createdById: user.userId } });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.CREATE, entity: 'FactoryPalletShipment', entityId: row.id, after: row });
      return this.finish(tx, row.id);
    });
  }

  async arrive(id: string, dto: FactoryPalletArrivalDto, user: RequestUser) {
    this.authorize(user);
    const date = this.date(dto.date), note = this.text(dto.note, 'Yetib kelish izohi', 1000);
    return this.transaction(async tx => {
      await this.lock(tx, id);
      const row = await this.read(tx, id); this.assertActive(row);
      if (row.arrivedAt) {
        if (row.arrivedAt.getTime() === date.getTime() && row.arrivalNote === note) return this.result(row);
        throw new BadRequestException('Reysning zavodga yetib kelishi oldin tasdiqlangan');
      }
      this.assertChronology(row, date);
      await tx.factoryPalletShipment.update({ where: { id }, data: { arrivedAt: date, arrivalNote: note, status: 'INSPECTING' } });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.UPDATE, entity: 'FactoryPalletShipment', entityId: id,
        before: { arrivedAt: null }, after: { arrivedAt: date, arrivalNote: note }, note: 'Zavodga yetib keldi; qabul hali tasdiqlanmagan' });
      return this.finish(tx, id);
    });
  }

  async inspect(id: string, dto: InspectFactoryPalletDto, user: RequestUser) {
    this.authorize(user);
    const requestKey = this.key(dto.requestKey);
    if (!Array.isArray(dto.lines) || dto.lines.length > 100) throw new BadRequestException('Qabul qismlari ro‘yxati noto‘g‘ri');
    const lines = dto.lines.map(l => {
      if (typeof l.unitPrice !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(l.unitPrice)) throw new BadRequestException('Qabul narxi 0 yoki musbat son va ko‘pi bilan 2 kasr xonasi bo‘lishi kerak');
      const qty = this.qty(l.qty), unitPrice = new Prisma.Decimal(l.unitPrice), amount = unitPrice.mul(qty);
      if (amount.gt(MAX_AMOUNT)) throw new BadRequestException('Qabul summasi ruxsat etilgan chegaradan katta');
      return { condition: this.text(l.condition, 'Poddon holati', 200, true)!, qty, unitPrice: unitPrice.toFixed(2), amount: amount.toFixed(2) };
    });
    const rejectedQty = this.qty(dto.rejectedQty, true);
    const acceptedQty = lines.reduce((sum, l) => sum + l.qty, 0);
    if (acceptedQty + rejectedQty < 1 || acceptedQty + rejectedQty > 2147483647) throw new BadRequestException('Kamida bitta poddon bo‘yicha qaror kiriting; son chegaradan oshmasin');
    const total = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
    if (total.gt(MAX_AMOUNT)) throw new BadRequestException('Qabulning jami summasi ruxsat etilgan chegaradan katta');
    const data = { shipmentId: id, date: this.date(dto.date), receiverName: this.text(dto.receiverName, 'Zavod qabulchisi', 150, true)!,
      documentRef: this.text(dto.documentRef, 'Dalolatnoma raqami', 150), rejectedQty,
      rejectionReason: this.text(dto.rejectionReason, 'Rad etish sababi', 1000, rejectedQty > 0), note: this.text(dto.note, 'Izoh', 1000) };
    const requestHash = this.hash({ ...data, lines });
    return this.transaction(async tx => {
      await this.lock(tx, id);
      const previous = await tx.factoryPalletInspection.findUnique({ where: { requestKey } });
      if (previous) { this.retry(previous, requestHash, user); return this.result(await this.read(tx, previous.shipmentId)); }
      const row = await this.read(tx, id); this.assertActive(row);
      if (!row.arrivedAt) throw new BadRequestException('Avval reysning zavodga yetib kelishini tasdiqlang');
      this.assertChronology(row, data.date);
      const available = this.totals(row).uninspectedQty;
      if (acceptedQty + rejectedQty > available) throw new BadRequestException(`Tekshiruvda ${available} dona qoldi; bundan ortiq qabul yoki rad etib bo‘lmaydi`);
      const inspection = await tx.factoryPalletInspection.create({ data: { ...data, requestKey, requestHash, createdById: user.userId } });
      for (const line of lines) {
        const movement = await tx.palletTransaction.create({ data: {
          type: 'RETURNED_TO_FACTORY', qty: line.qty, factoryId: row.factoryId, unitPrice: null, date: data.date,
          note: `Poddon reysi №${row.returnNo}: ${line.condition}`, createdById: user.userId,
        } });
        await tx.factoryPalletAcceptanceLine.create({ data: { ...line, inspectionId: inspection.id, palletTransactionId: movement.id } });
      }
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.CREATE, entity: 'FactoryPalletInspection', entityId: inspection.id,
        after: { ...data, lines }, note: `Reys №${row.returnNo}; qabul bahosi pul qarziga yozilmaydi` });
      return this.finish(tx, id);
    });
  }

  async reverseArrival(id: string, dto: { reason: string }, user: RequestUser) {
    this.authorize(user);
    const reason = this.text(dto.reason, 'Bekor qilish sababi', 1000, true)!;
    return this.transaction(async tx => {
      await this.lock(tx, id);
      const row = await this.read(tx, id); this.assertActive(row);
      if (!row.arrivedAt) throw new BadRequestException('Reysning yetib kelishi hali tasdiqlanmagan');
      if (row.inspections.some(i => !i.voidedAt) || row.warehouseReturns.some(r => !r.voidedAt)) {
        throw new BadRequestException('Yetib kelishni tuzatishdan oldin unga bog‘liq tekshiruv va omborga qaytish yozuvlarini bekor qiling');
      }
      await tx.factoryPalletShipment.update({ where: { id }, data: { arrivedAt: null, arrivalNote: null, status: 'IN_TRANSIT' } });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.UPDATE, entity: 'FactoryPalletShipment', entityId: id,
        before: { arrivedAt: row.arrivedAt, arrivalNote: row.arrivalNote }, after: { arrivedAt: null, arrivalNote: null }, note: reason });
      return this.finish(tx, id);
    });
  }

  async returnRejected(id: string, dto: ReturnRejectedPalletDto, user: RequestUser) {
    this.authorize(user);
    const requestKey = this.key(dto.requestKey);
    const data = { shipmentId: id, qty: this.qty(dto.qty), date: this.date(dto.date), note: this.text(dto.note, 'Omborga qaytish izohi', 1000, true)! };
    const requestHash = this.hash(data);
    return this.transaction(async tx => {
      await this.lock(tx, id);
      const previous = await tx.factoryPalletWarehouseReturn.findUnique({ where: { requestKey } });
      if (previous) { this.retry(previous, requestHash, user); return this.result(await this.read(tx, previous.shipmentId)); }
      const row = await this.read(tx, id); this.assertActive(row); this.assertChronology(row, data.date);
      const available = this.totals(row).rejectedOutstandingQty;
      if (data.qty > available) throw new BadRequestException(`Omborga qaytishi kutilayotgan rad etilgan poddon: ${available} dona`);
      const returned = await tx.factoryPalletWarehouseReturn.create({ data: { ...data, requestKey, requestHash, createdById: user.userId } });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.CREATE, entity: 'FactoryPalletWarehouseReturn', entityId: returned.id, after: returned });
      return this.finish(tx, id);
    });
  }

  async cancel(id: string, dto: { reason: string }, user: RequestUser) {
    this.authorize(user);
    const reason = this.text(dto.reason, 'Bekor qilish sababi', 1000, true)!;
    return this.transaction(async tx => {
      await this.lock(tx, id);
      const row = await this.read(tx, id); this.assertActive(row);
      if (row.arrivedAt || row.inspections.some(i => !i.voidedAt) || row.warehouseReturns.some(r => !r.voidedAt)) throw new BadRequestException('Faqat zavodga yetib kelishi tasdiqlanmagan xato jo‘natmani bekor qilish mumkin');
      await tx.factoryPalletShipment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.VOID, entity: 'FactoryPalletShipment', entityId: id,
        before: { status: row.status, qty: row.qty }, after: { status: 'CANCELLED' }, note: reason });
      return this.finish(tx, id);
    });
  }

  async reverseInspection(inspectionId: string, dto: { reason: string }, user: RequestUser) {
    this.authorize(user);
    const reason = this.text(dto.reason, 'Bekor qilish sababi', 1000, true)!;
    return this.transaction(async tx => {
      await this.lock(tx);
      const inspection = await tx.factoryPalletInspection.findUnique({ where: { id: inspectionId }, include: { lines: true } });
      if (!inspection) throw new NotFoundException('Tekshiruv topilmadi');
      await tx.$executeRaw`SELECT id FROM "FactoryPalletShipment" WHERE id = ${inspection.shipmentId} FOR UPDATE`;
      const row = await this.read(tx, inspection.shipmentId); this.assertActive(row);
      if (inspection.voidedAt) throw new BadRequestException('Bu tekshiruv oldin bekor qilingan');
      // A later rejection cannot fund a warehouse receipt that happened earlier.
      const events = new Map<number, number>();
      for (const i of row.inspections) if (!i.voidedAt && i.id !== inspectionId) events.set(i.date.getTime(), (events.get(i.date.getTime()) ?? 0) + i.rejectedQty);
      for (const r of row.warehouseReturns) if (!r.voidedAt) events.set(r.date.getTime(), (events.get(r.date.getTime()) ?? 0) - r.qty);
      let rejected = 0;
      for (const [, delta] of [...events].sort((a, b) => a[0] - b[0])) {
        rejected += delta;
        if (rejected < 0) throw new BadRequestException('Bu tekshiruvga bog‘liq rad etilgan poddon omborga qaytgan; tekshiruvni bekor qilib bo‘lmaydi');
      }
      for (const line of inspection.lines) {
        const existing = await tx.palletTransaction.count({ where: { reversalOfId: line.palletTransactionId } });
        if (existing) throw new ConflictException('Qabul harakati allaqachon stornolangan; hisobni tekshiring');
        await tx.palletTransaction.create({ data: { type: 'REVERSAL', qty: line.qty, factoryId: row.factoryId,
          date: new Date(), unitPrice: null, reversalOfId: line.palletTransactionId, reversalOfType: 'RETURNED_TO_FACTORY',
          note: reason, createdById: user.userId } });
      }
      await tx.factoryPalletInspection.update({ where: { id: inspectionId }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.VOID, entity: 'FactoryPalletInspection', entityId: inspectionId,
        before: { shipmentId: row.id, acceptedQty: inspection.lines.reduce((sum, l) => sum + l.qty, 0), rejectedQty: inspection.rejectedQty }, note: reason });
      return this.finish(tx, row.id);
    });
  }

  async reverseWarehouseReturn(returnId: string, dto: { reason: string }, user: RequestUser) {
    this.authorize(user);
    const reason = this.text(dto.reason, 'Bekor qilish sababi', 1000, true)!;
    return this.transaction(async tx => {
      await this.lock(tx);
      const receipt = await tx.factoryPalletWarehouseReturn.findUnique({ where: { id: returnId } });
      if (!receipt) throw new NotFoundException('Omborga qaytish qaydi topilmadi');
      await tx.$executeRaw`SELECT id FROM "FactoryPalletShipment" WHERE id = ${receipt.shipmentId} FOR UPDATE`;
      const row = await this.read(tx, receipt.shipmentId); this.assertActive(row);
      if (receipt.voidedAt) throw new BadRequestException('Bu qaytish oldin bekor qilingan');
      if (receipt.qty > await this.pallets.dealerInHandOn(tx)) throw new BadRequestException('Bu poddonlar ombordan ishlatilgan; qaytishni bekor qilishdan oldin bog‘liq harakatlarni tuzating');
      await tx.factoryPalletWarehouseReturn.update({ where: { id: returnId }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.VOID, entity: 'FactoryPalletWarehouseReturn', entityId: returnId,
        before: { shipmentId: row.id, qty: receipt.qty, date: receipt.date }, note: reason });
      // Removing a historical receipt must leave every later stock/capacity balance valid.
      return this.finish(tx, row.id);
    });
  }
}
