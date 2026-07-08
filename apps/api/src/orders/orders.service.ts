import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const ORDER_FLOW = ['NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED'];

function totals(d: any) {
  const quantity = Number(d.quantity) || 0;
  const cost = Number(d.costPricePerUnit) || 0;
  const sale = Number(d.salePricePerUnit) || 0;
  const transport = Number(d.transportFee) || 0;
  const costTotal = quantity * cost;
  const saleTotal = quantity * sale;
  return { quantity, costPricePerUnit: cost, salePricePerUnit: sale, transportFee: transport, costTotal, saleTotal, profit: saleTotal - costTotal - transport };
}

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  findAll(user: any, q: any = {}) {
    const where: any = { ...this.scope(user) };
    if (q.status) where.status = q.status;
    if (q.agentId) where.agentId = q.agentId;
    if (q.clientId) where.clientId = q.clientId;
    if (q.factoryId) where.factoryId = q.factoryId;
    if (q.vehicleId) where.vehicleId = q.vehicleId;
    return this.prisma.order.findMany({
      where, orderBy: { date: 'desc' },
      include: { agent: true, client: true, factory: true, product: true, vehicle: true },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { agent: true, client: true, factory: true, product: true, vehicle: true, payments: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    return order;
  }

  private async nextOrderNo() {
    const count = await this.prisma.order.count();
    return 'B-' + String(count + 1).padStart(4, '0');
  }

  async create(dto: any) {
    const t = totals(dto);
    return this.prisma.order.create({
      data: {
        orderNo: await this.nextOrderNo(),
        date: dto.date ? new Date(dto.date) : new Date(),
        agentId: dto.agentId || null,
        clientId: dto.clientId,
        factoryId: dto.factoryId,
        productId: dto.productId,
        vehicleId: dto.vehicleId || null,
        status: dto.status || 'NEW',
        note: dto.note ?? null,
        ...t,
      },
      include: { client: true, product: true, factory: true, vehicle: true },
    });
  }

  async update(id: string, dto: any) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Buyurtma topilmadi');
    const t = totals({ ...existing, ...dto });
    return this.prisma.order.update({
      where: { id },
      data: {
        ...(dto.date ? { date: new Date(dto.date) } : {}),
        ...(dto.agentId !== undefined ? { agentId: dto.agentId || null } : {}),
        ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
        ...(dto.factoryId !== undefined ? { factoryId: dto.factoryId } : {}),
        ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
        ...(dto.vehicleId !== undefined ? { vehicleId: dto.vehicleId || null } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...t,
      },
    });
  }

  async setStatus(id: string, status: string) {
    if (![...ORDER_FLOW, 'CANCELLED'].includes(status)) throw new BadRequestException('Notogri status');
    return this.prisma.order.update({ where: { id }, data: { status } });
  }

  // advance to the next lifecycle stage
  async advance(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const idx = ORDER_FLOW.indexOf(order.status);
    if (idx < 0 || idx >= ORDER_FLOW.length - 1) throw new BadRequestException('Bu buyurtmani yana oldinga surib bolmaydi');
    return this.prisma.order.update({ where: { id }, data: { status: ORDER_FLOW[idx + 1] } });
  }

  async remove(id: string) {
    await this.prisma.payment.updateMany({ where: { orderId: id }, data: { orderId: null } });
    return this.prisma.order.delete({ where: { id } });
  }
}
