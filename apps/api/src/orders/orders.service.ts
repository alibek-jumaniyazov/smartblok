import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RECOGNIZED_ORDER, recognizedPaymentWhere } from '../common/recognition';

export const ORDER_FLOW = ['NEW', 'CONFIRMED', 'LOADING', 'DELIVERING', 'DELIVERED', 'COMPLETED'];
export const VALID_STATUS = [...ORDER_FLOW, 'CANCELLED'];
// from this stage on the order is physically moving, so a vehicle must be attached
const VEHICLE_REQUIRED_IDX = ORDER_FLOW.indexOf('LOADING');

function totals(d: any) {
  const quantity = Number(d.quantity) || 0;
  const cost = Number(d.costPricePerUnit) || 0;
  const sale = Number(d.salePricePerUnit) || 0;
  const transport = Number(d.transportFee) || 0;
  const costTotal = quantity * cost;
  const saleTotal = quantity * sale;
  return { quantity, costPricePerUnit: cost, salePricePerUnit: sale, transportFee: transport, costTotal, saleTotal, profit: saleTotal - costTotal - transport };
}

// use the given value if the caller sent a real number, otherwise fall back to the product default
function numOr(v: any, fallback: number) {
  return v === undefined || v === null || v === '' ? fallback : Number(v);
}

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  // an AGENT may only read/mutate their own orders
  private assertOwnership(user: any, order: { agentId: string | null }) {
    if (user?.role === 'AGENT' && user?.agentId && order.agentId !== user.agentId) {
      throw new ForbiddenException('Bu buyurtma sizga tegishli emas');
    }
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

  async findOne(id: string, user?: any) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { agent: true, client: true, factory: true, product: true, vehicle: true, payments: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    this.assertOwnership(user, order);
    return order;
  }

  // Next order number from the highest existing numeric suffix (NOT count() — that collided
  // with an existing orderNo after any deletion and threw a 500 on the @unique constraint).
  private async nextOrderNo() {
    const orders = await this.prisma.order.findMany({ select: { orderNo: true } });
    const max = orders.reduce((m, o) => {
      const n = parseInt(String(o.orderNo).replace(/\D/g, ''), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return 'B-' + String(max + 1).padStart(4, '0');
  }

  // current outstanding balance the client owes us (recognized orders minus recognized payments)
  private async clientBalance(clientId: string) {
    const payWhere = await recognizedPaymentWhere(this.prisma, { clientId, type: 'CLIENT' });
    const [ordAgg, payAgg] = await Promise.all([
      this.prisma.order.aggregate({ where: { clientId, ...RECOGNIZED_ORDER }, _sum: { saleTotal: true } }),
      this.prisma.payment.aggregate({ where: payWhere, _sum: { amount: true } }),
    ]);
    return (ordAgg._sum.saleTotal ?? 0) - (payAgg._sum.amount ?? 0);
  }

  // once an order starts moving (LOADING+) it must have a vehicle assigned
  private assertVehicleFor(status: string, vehicleId: string | null) {
    const idx = ORDER_FLOW.indexOf(status);
    if (idx >= VEHICLE_REQUIRED_IDX && !vehicleId) {
      throw new BadRequestException('Avval moshina biriktiring — moshinasiz yuklashga otib bolmaydi');
    }
  }

  async create(dto: any, user?: any) {
    if (!dto.clientId) throw new BadRequestException('Mijoz majburiy');
    if (!dto.productId) throw new BadRequestException('Mahsulot majburiy');

    const [client, product] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: dto.clientId } }),
      this.prisma.product.findUnique({ where: { id: dto.productId } }),
    ]);
    if (!client) throw new BadRequestException('Mijoz topilmadi');
    if (!product) throw new BadRequestException('Mahsulot topilmadi');

    // the product always comes from its own factory — keep the denormalized factoryId honest
    const factoryId = dto.factoryId || product.factoryId;
    if (product.factoryId !== factoryId) throw new BadRequestException('Mahsulot tanlangan zavodga tegishli emas');

    // an order is always credited to an agent; default to the client's own agent.
    // An AGENT can only book under their own id and for their own clients (no mass-assignment).
    let agentId = dto.agentId || client.agentId;
    if (user?.role === 'AGENT' && user?.agentId) {
      agentId = user.agentId;
      if (client.agentId && client.agentId !== user.agentId) {
        throw new ForbiddenException('Bu mijoz sizga biriktirilmagan');
      }
    }
    if (!agentId) throw new BadRequestException('Agent majburiy — mijozga agent biriktirilmagan');

    // status must be a known value; a moving status needs a vehicle just like setStatus()
    const status = dto.status || 'NEW';
    if (!VALID_STATUS.includes(status)) throw new BadRequestException('Notogri status');
    this.assertVehicleFor(status, dto.vehicleId || null);

    // prices default to the product's configured cost/sale price
    const t = totals({
      ...dto,
      costPricePerUnit: numOr(dto.costPricePerUnit, product.costPrice),
      salePricePerUnit: numOr(dto.salePricePerUnit, product.salePrice),
    });

    // credit limit (creditLimit 0 = unlimited): reject if this order would blow past the cap
    if (client.creditLimit && client.creditLimit > 0 && status !== 'CANCELLED') {
      const current = await this.clientBalance(dto.clientId);
      if (current + t.saleTotal > client.creditLimit) {
        throw new BadRequestException(
          `Kredit limiti oshib ketdi: joriy qarz ${Math.round(current).toLocaleString('ru-RU')} + yangi buyurtma ${Math.round(t.saleTotal).toLocaleString('ru-RU')} > limit ${client.creditLimit.toLocaleString('ru-RU')}`,
        );
      }
    }

    const data = {
      date: dto.date ? new Date(dto.date) : new Date(),
      agentId,
      clientId: dto.clientId,
      factoryId,
      productId: dto.productId,
      vehicleId: dto.vehicleId || null,
      status,
      note: dto.note ?? null,
      ...t,
    };

    // retry on the (rare) concurrent-create orderNo collision
    let lastErr: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.order.create({
          data: { orderNo: await this.nextOrderNo(), ...data },
          include: { client: true, product: true, factory: true, vehicle: true },
        });
      } catch (e: any) {
        lastErr = e;
        if (e?.code === 'P2002') continue;
        throw e;
      }
    }
    throw lastErr;
  }

  async update(id: string, dto: any, user?: any) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Buyurtma topilmadi');
    this.assertOwnership(user, existing);
    // an AGENT may not reassign an order to another agent
    if (user?.role === 'AGENT') dto = { ...dto, agentId: undefined };

    // when product/factory changes, keep them consistent and refresh prices like create() does
    let priceDefaults: any = {};
    if (dto.productId !== undefined && dto.productId !== existing.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new BadRequestException('Mahsulot topilmadi');
      const factoryId = dto.factoryId || product.factoryId;
      if (product.factoryId !== factoryId) throw new BadRequestException('Mahsulot tanlangan zavodga tegishli emas');
      dto = { ...dto, factoryId };
      priceDefaults = {
        costPricePerUnit: numOr(dto.costPricePerUnit, product.costPrice),
        salePricePerUnit: numOr(dto.salePricePerUnit, product.salePrice),
      };
    } else if (dto.factoryId !== undefined && dto.factoryId !== existing.factoryId) {
      const product = await this.prisma.product.findUnique({ where: { id: existing.productId } });
      if (product && product.factoryId !== dto.factoryId) throw new BadRequestException('Mahsulot tanlangan zavodga tegishli emas');
    }

    const t = totals({ ...existing, ...dto, ...priceDefaults });
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

  async setStatus(id: string, status: string, user?: any) {
    if (!VALID_STATUS.includes(status)) throw new BadRequestException('Notogri status');
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    this.assertOwnership(user, order);
    this.assertVehicleFor(status, order.vehicleId);
    return this.prisma.order.update({ where: { id }, data: { status } });
  }

  // advance to the next lifecycle stage
  async advance(id: string, user?: any) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    this.assertOwnership(user, order);
    const idx = ORDER_FLOW.indexOf(order.status);
    if (idx < 0 || idx >= ORDER_FLOW.length - 1) throw new BadRequestException('Bu buyurtmani yana oldinga surib bolmaydi');
    const next = ORDER_FLOW[idx + 1];
    this.assertVehicleFor(next, order.vehicleId);
    return this.prisma.order.update({ where: { id }, data: { status: next } });
  }

  // Deleting an order soft-cancels it (status=CANCELLED): the row and its linked payments are
  // preserved for history, but a cancelled order and its payments drop out of every balance/kassa
  // calculation. This replaces the old hard-delete that orphaned payments into phantom advances.
  async remove(id: string, user?: any) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    this.assertOwnership(user, order);
    if (order.status === 'CANCELLED') return order;
    return this.prisma.order.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
