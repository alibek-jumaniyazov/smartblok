import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function computeTotals(d: any) {
  const cubes = Number(d.cubes) || 0;
  const costPricePerM3 = Number(d.costPricePerM3) || 0;
  const palletQty = Number(d.palletQty) || 0;
  const palletPrice = Number(d.palletPrice) || 0;
  const salePricePerM3 = Number(d.salePricePerM3) || 0;
  const transportCost = Number(d.transportCost) || 0;

  const costTotal = cubes * costPricePerM3;
  const palletTotal = palletQty * palletPrice;
  const saleTotal = cubes * salePricePerM3;
  const profit = saleTotal - costTotal - palletTotal - transportCost;
  return { cubes, costPricePerM3, palletQty, palletPrice, salePricePerM3, transportCost, costTotal, palletTotal, saleTotal, profit };
}

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  private scope(user: any) {
    return user?.role === 'AGENT' && user?.agentId ? { agentId: user.agentId } : {};
  }

  findAll(user: any, q: any = {}) {
    const where: any = { ...this.scope(user) };
    if (q.clientId) where.clientId = Number(q.clientId);
    if (q.agentId) where.agentId = Number(q.agentId);
    if (q.from || q.to) {
      where.date = {};
      if (q.from) where.date.gte = new Date(q.from);
      if (q.to) where.date.lte = new Date(q.to);
    }
    return this.prisma.sale.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { agent: true, client: true, factory: true, region: true, blockSize: true },
    });
  }

  async findOne(id: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { agent: true, client: true, factory: true, region: true, blockSize: true },
    });
    if (!sale) throw new NotFoundException('Sotuv topilmadi');
    return sale;
  }

  async create(dto: any) {
    const t = computeTotals(dto);
    const sale = await this.prisma.sale.create({
      data: {
        date: new Date(dto.date),
        agentId: dto.agentId ? Number(dto.agentId) : null,
        clientId: Number(dto.clientId),
        factoryId: dto.factoryId ? Number(dto.factoryId) : null,
        regionId: dto.regionId ? Number(dto.regionId) : null,
        plate: dto.plate ?? null,
        blockSizeId: dto.blockSizeId ? Number(dto.blockSizeId) : null,
        transportPaid: !!dto.transportPaid,
        note: dto.note ?? null,
        ...t,
      },
    });
    if (t.palletQty > 0) {
      await this.prisma.palletMovement.create({
        data: { clientId: sale.clientId, saleId: sale.id, issuedQty: t.palletQty, date: sale.date, note: 'Sotuv bilan berildi' },
      });
    }
    return sale;
  }

  async update(id: number, dto: any) {
    const existing = await this.prisma.sale.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sotuv topilmadi');
    const t = computeTotals({ ...existing, ...dto });
    const sale = await this.prisma.sale.update({
      where: { id },
      data: {
        date: dto.date ? new Date(dto.date) : existing.date,
        agentId: dto.agentId !== undefined ? (dto.agentId ? Number(dto.agentId) : null) : existing.agentId,
        clientId: dto.clientId !== undefined ? Number(dto.clientId) : existing.clientId,
        factoryId: dto.factoryId !== undefined ? (dto.factoryId ? Number(dto.factoryId) : null) : existing.factoryId,
        regionId: dto.regionId !== undefined ? (dto.regionId ? Number(dto.regionId) : null) : existing.regionId,
        plate: dto.plate !== undefined ? dto.plate : existing.plate,
        blockSizeId: dto.blockSizeId !== undefined ? (dto.blockSizeId ? Number(dto.blockSizeId) : null) : existing.blockSizeId,
        transportPaid: dto.transportPaid !== undefined ? !!dto.transportPaid : existing.transportPaid,
        note: dto.note !== undefined ? dto.note : existing.note,
        ...t,
      },
    });
    // keep linked pallet movement in sync
    const pm = await this.prisma.palletMovement.findFirst({ where: { saleId: id } });
    if (pm) await this.prisma.palletMovement.update({ where: { id: pm.id }, data: { issuedQty: t.palletQty, clientId: sale.clientId } });
    else if (t.palletQty > 0) await this.prisma.palletMovement.create({ data: { clientId: sale.clientId, saleId: id, issuedQty: t.palletQty, date: sale.date } });
    return sale;
  }

  async remove(id: number) {
    await this.prisma.palletMovement.deleteMany({ where: { saleId: id } });
    return this.prisma.sale.delete({ where: { id } });
  }
}
