import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';

function toDate(v: any): Date {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  if (typeof v === 'string' && v.trim()) { const d = new Date(v); if (!isNaN(d.getTime())) return d; }
  return new Date();
}
const num = (v: any) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
const str = (v: any) => (v == null ? '' : String(v).trim());

@Injectable()
export class ImportService {
  constructor(private prisma: PrismaService) {}

  private findSheet(wb: XLSX.WorkBook, ...needles: string[]) {
    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '');
    const nns = needles.map(norm);
    let name = wb.SheetNames.find((n) => nns.includes(norm(n)));
    if (!name) name = wb.SheetNames.find((n) => nns.some((nn) => norm(n).includes(nn)));
    return name ? XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: null, raw: true }) : null;
  }

  async importWorkbook(buffer: Buffer, replace: boolean) {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.read(buffer, { cellDates: true }); }
    catch { throw new BadRequestException('Excel faylni oqib bolmadi'); }

    if (replace) {
      await this.prisma.payment.deleteMany();
      await this.prisma.order.deleteMany();
      await this.prisma.product.deleteMany();
      await this.prisma.client.deleteMany();
    }

    const region = await this.prisma.region.upsert({ where: { name: 'Xorazm Beruniy' }, update: {}, create: { name: 'Xorazm Beruniy' } });
    const factory = await (async () => {
      const f = await this.prisma.factory.findFirst({ where: { name: 'CAOLS KS' } });
      return f ?? this.prisma.factory.create({ data: { name: 'CAOLS KS' } });
    })();

    const agentCache = new Map<string, string>();
    const clientCache = new Map<string, string>();
    const productCache = new Map<string, string>();
    const vehicleCache = new Map<string, string>();

    const getAgent = async (name: string) => {
      if (!name) return null;
      const k = name.toLowerCase();
      if (agentCache.has(k)) return agentCache.get(k)!;
      const ex = await this.prisma.agent.findFirst({ where: { name } });
      const a = ex ?? (await this.prisma.agent.create({ data: { name } }));
      agentCache.set(k, a.id); return a.id;
    };
    const getClient = async (name: string, agentId: string | null) => {
      if (!name) return null;
      const k = name.toLowerCase();
      if (clientCache.has(k)) return clientCache.get(k)!;
      const ex = await this.prisma.client.findFirst({ where: { name } });
      const c = ex ?? (await this.prisma.client.create({ data: { name, agentId, regionId: region.id } }));
      clientCache.set(k, c.id); return c.id;
    };
    const getProduct = async (size: string, costPrice: number, salePrice: number) => {
      const key = (size || 'gazoblok').toLowerCase();
      if (productCache.has(key)) return productCache.get(key)!;
      const name = 'Gazoblok ' + (size || '');
      const ex = await this.prisma.product.findFirst({ where: { factoryId: factory.id, size: size || null } });
      const p = ex ?? (await this.prisma.product.create({ data: { factoryId: factory.id, name: name.trim(), size: size || null, unit: 'm3', costPrice, salePrice } }));
      productCache.set(key, p.id); return p.id;
    };
    const getVehicle = async (plate: string) => {
      if (!plate) return null;
      const k = plate.toLowerCase();
      if (vehicleCache.has(k)) return vehicleCache.get(k)!;
      const ex = await this.prisma.vehicle.findFirst({ where: { plate } });
      const v = ex ?? (await this.prisma.vehicle.create({ data: { name: plate, plate } }));
      vehicleCache.set(k, v.id); return v.id;
    };

    const result = { orders: 0, payments: 0, factoryPayments: 0, skipped: 0 };
    let orderNo = (await this.prisma.order.count());

    // Tovar -> orders
    const tovar = this.findSheet(wb, 'tovar', 'товар');
    if (tovar) {
      for (let i = 3; i < tovar.length; i++) {
        const r = tovar[i] || [];
        const agentName = str(r[2]), clientName = str(r[3]);
        if (!clientName && !agentName) continue;
        try {
          const agentId = await getAgent(agentName);
          const clientId = await getClient(clientName, agentId);
          if (!clientId) { result.skipped++; continue; }
          const quantity = num(r[7]);
          const cost = num(r[8]);
          const sale = num(r[14]);
          const transport = num(r[18]);
          if (!quantity && !sale) { result.skipped++; continue; }
          const size = str(r[6]);
          const productId = await getProduct(size, cost, sale);
          const vehicleId = await getVehicle(str(r[5]));
          orderNo++;
          const costTotal = quantity * cost, saleTotal = quantity * sale;
          await this.prisma.order.create({
            data: {
              orderNo: 'B-' + String(orderNo).padStart(4, '0'),
              date: toDate(r[4]), agentId, clientId, factoryId: factory.id, productId, vehicleId,
              quantity, costPricePerUnit: cost, salePricePerUnit: sale, transportFee: transport,
              costTotal, saleTotal, profit: saleTotal - costTotal - transport,
              status: 'COMPLETED', note: 'Import',
            },
          });
          result.orders++;
        } catch { result.skipped++; }
      }
    }

    // Oplata -> client payments
    const oplata = this.findSheet(wb, 'оплата', 'oplata');
    if (oplata) {
      for (let i = 1; i < oplata.length; i++) {
        const r = oplata[i] || [];
        const clientName = str(r[2]);
        if (!clientName) continue;
        try {
          const agentId = await getAgent(str(r[1]));
          const clientId = await getClient(clientName, agentId);
          if (!clientId) { result.skipped++; continue; }
          const usd = num(r[13]);
          let method = 'BANK';
          if (usd > 0) method = 'USD';
          else if (num(r[11]) > 0) method = 'CLICK';
          else if (num(r[12]) > 0) method = 'TERMINAL';
          else if (num(r[5]) > 0) method = 'CASH';
          const amount = num(r[17]) || num(r[3]);
          if (!amount) { result.skipped++; continue; }
          await this.prisma.payment.create({
            data: { date: toDate(r[0]), type: 'CLIENT', agentId, clientId, payerName: str(r[4]) || null, method, usdAmount: usd, rate: num(r[14]), amount, note: str(r[19]) || null },
          });
          result.payments++;
        } catch { result.skipped++; }
      }
    }

    // Oplata Zavod -> factory payments
    const zavod = this.findSheet(wb, 'оплата завод', 'oplata zavod');
    if (zavod) {
      for (let i = 2; i < zavod.length; i++) {
        const r = zavod[i] || [];
        const amount = num(r[1]);
        if (!amount) continue;
        try {
          await this.prisma.payment.create({
            data: { date: toDate(r[0]), type: 'FACTORY', factoryId: factory.id, method: 'BANK', amount, payerName: str(r[2]) || null, note: str(r[3]) || null },
          });
          result.factoryPayments++;
        } catch { result.skipped++; }
      }
    }

    return { ok: true, replaced: replace, sheets: wb.SheetNames, imported: result };
  }
}
