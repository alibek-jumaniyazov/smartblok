import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// method -> cashbox name (seeded)
const CASHBOX_BY_METHOD: Record<string, string> = {
  CASH: 'Naqt kassa (UZS)',
  USD: 'Naqt kassa (USD)',
  CLICK: 'Click kassa',
  TERMINAL: 'Click kassa',
  BANK: 'Bank kassa',
  TRANSFER: 'Bank kassa',
};

const TYPES = ['CLIENT', 'FACTORY', 'VEHICLE'];
const METHODS = Object.keys(CASHBOX_BY_METHOD);
// which FK a payment type must reference
const PARTY_KEY: Record<string, 'clientId' | 'factoryId' | 'vehicleId'> = {
  CLIENT: 'clientId', FACTORY: 'factoryId', VEHICLE: 'vehicleId',
};

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  findAll(user: any, q: any = {}) {
    const where: any = { ...this.scope(user) };
    if (q.type) where.type = q.type;
    if (q.clientId) where.clientId = q.clientId;
    if (q.factoryId) where.factoryId = q.factoryId;
    if (q.vehicleId) where.vehicleId = q.vehicleId;
    return this.prisma.payment.findMany({
      where, orderBy: { date: 'desc' },
      include: { agent: true, client: true, factory: true, vehicle: true, order: true, cashbox: true },
    });
  }

  private normalize(dto: any) {
    const method = dto.method || 'CASH';
    let amount = Number(dto.amount) || 0;
    const usdAmount = Number(dto.usdAmount) || 0;
    const rate = Number(dto.rate) || 0;
    if (method === 'USD') amount = usdAmount * rate;
    return { method, amount, usdAmount, rate };
  }

  // Resolve the cashbox for a method — throws so money never silently vanishes.
  private async resolveCashbox(method: string) {
    const boxName = CASHBOX_BY_METHOD[method];
    if (!boxName) throw new BadRequestException(`Notogri tolov usuli: ${method}`);
    const box = await this.prisma.cashbox.findFirst({ where: { name: boxName } });
    if (!box) throw new BadRequestException(`Kassa topilmadi: ${boxName}`);
    return box;
  }

  async create(dto: any, user?: any) {
    const type = dto.type || 'CLIENT';
    if (!TYPES.includes(type)) throw new BadRequestException(`Notogri tolov turi: ${type}`);
    const n = this.normalize(dto);
    if (!METHODS.includes(n.method)) throw new BadRequestException(`Notogri tolov usuli: ${n.method}`);
    if (!n.amount || n.amount <= 0) throw new BadRequestException("Tolov summasi 0 dan katta bolishi kerak");

    // the payment type must carry its matching party id
    const partyKey = PARTY_KEY[type];
    const partyId = dto[partyKey];
    if (!partyId) throw new BadRequestException(`${type} tolovi uchun ${partyKey} majburiy`);

    // AGENT users may only take CLIENT payments, and only from their own clients — a money-OUT
    // (FACTORY/VEHICLE) payment or a foreign client would silently move someone else's balance.
    if (user?.role === 'AGENT') {
      if (type !== 'CLIENT') throw new ForbiddenException('Agent faqat mijozdan tolov qabul qila oladi');
      const client = await this.prisma.client.findUnique({ where: { id: partyId } });
      if (!client) throw new BadRequestException('Mijoz topilmadi');
      if (client.agentId !== user.agentId) throw new ForbiddenException('Bu mijoz sizga biriktirilmagan');
    }

    const box = await this.resolveCashbox(n.method);
    const date = dto.date ? new Date(dto.date) : new Date();
    // AGENT users can only book payments under their own agent id
    const agentId = user?.role === 'AGENT' && user?.agentId ? user.agentId : (dto.agentId || null);
    const direction = type === 'CLIENT' ? 'IN' : 'OUT'; // client pays us = IN; we pay factory/vehicle = OUT
    const boxAmount = box.currency === 'USD' ? n.usdAmount : n.amount;

    // payment + kassa entry are written together so the ledger can never drift
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          date, type,
          agentId,
          clientId: type === 'CLIENT' ? partyId : null,
          factoryId: type === 'FACTORY' ? partyId : null,
          vehicleId: type === 'VEHICLE' ? partyId : null,
          orderId: dto.orderId || null,
          payerName: dto.payerName ?? null,
          note: dto.note ?? null,
          cashboxId: box.id,
          ...n,
        },
        include: { client: true, factory: true, vehicle: true, agent: true, cashbox: true },
      });
      if (boxAmount) {
        await tx.cashTransaction.create({
          data: {
            cashboxId: box.id, direction, amount: boxAmount, rate: n.rate,
            source: 'PAYMENT', date, note: dto.note || `Tolov: ${type}`, paymentId: payment.id,
          },
        });
      }
      return payment;
    });
  }

  // deleting a payment also reverses its kassa entry (drift-free)
  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.cashTransaction.deleteMany({ where: { paymentId: id } });
      return tx.payment.delete({ where: { id } });
    });
  }
}
