import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';

function toDate(v: any): Date {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
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
    // exact (normalized) match first, then substring fallback
    let name = wb.SheetNames.find((n) => nns.includes(norm(n)));
    if (!name) name = wb.SheetNames.find((n) => nns.some((nn) => norm(n).includes(nn)));
    return name ? XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: null, raw: true }) : null;
  }

  async importWorkbook(buffer: Buffer, replace: boolean) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { cellDates: true });
    } catch {
      throw new BadRequestException('Excel faylni o\'qib bo\'lmadi');
    }

    if (replace) {
      await this.prisma.palletMovement.deleteMany();
      await this.prisma.payment.deleteMany();
      await this.prisma.sale.deleteMany();
      await this.prisma.factoryPayment.deleteMany();
      await this.prisma.client.deleteMany();
      // keep users, agents, factories, regions, block sizes, cashboxes, prices, routes
    }

    // ---- caches / getOrCreate ----
    const agentCache = new Map<string, number>();
    const clientCache = new Map<string, number>();
    const factoryCache = new Map<string, number>();
    const sizeCache = new Map<string, number>();

    const region = await this.prisma.region.upsert({
      where: { name: 'Xorazm Beruniy' }, update: {}, create: { name: 'Xorazm Beruniy' },
    });

    const getAgent = async (name: string) => {
      const key = name.toLowerCase();
      if (!name) return null;
      if (agentCache.has(key)) return agentCache.get(key)!;
      const existing = await this.prisma.agent.findFirst({ where: { name } });
      const a = existing ?? (await this.prisma.agent.create({ data: { name } }));
      agentCache.set(key, a.id);
      return a.id;
    };
    const getClient = async (name: string, agentId: number | null) => {
      const key = name.toLowerCase();
      if (!name) return null;
      if (clientCache.has(key)) return clientCache.get(key)!;
      const existing = await this.prisma.client.findFirst({ where: { name } });
      const c = existing ?? (await this.prisma.client.create({ data: { name, agentId, regionId: region.id } }));
      clientCache.set(key, c.id);
      return c.id;
    };
    const getFactory = async (name: string) => {
      const clean = name || 'Zavod';
      const key = clean.toLowerCase();
      if (factoryCache.has(key)) return factoryCache.get(key)!;
      const existing = await this.prisma.factory.findFirst({ where: { name: clean } });
      const f = existing ?? (await this.prisma.factory.create({ data: { name: clean } }));
      factoryCache.set(key, f.id);
      return f.id;
    };
    const getSize = async (name: string) => {
      if (!name) return null;
      const key = name.toLowerCase();
      if (sizeCache.has(key)) return sizeCache.get(key)!;
      const existing = await this.prisma.blockSize.findFirst({ where: { name } });
      const s = existing ?? (await this.prisma.blockSize.create({ data: { name } }));
      sizeCache.set(key, s.id);
      return s.id;
    };

    const result = { sales: 0, payments: 0, factoryPayments: 0, skipped: 0 };

    // ---- Товар (sales), header at row 3 (index 2), data from index 3 ----
    const tovar = this.findSheet(wb, 'товар', 'tovar');
    if (tovar) {
      for (let i = 3; i < tovar.length; i++) {
        const r = tovar[i] || [];
        const agentName = str(r[2]), clientName = str(r[3]);
        if (!clientName && !agentName) continue;
        try {
          const agentId = await getAgent(agentName);
          const clientId = await getClient(clientName, agentId);
          if (!clientId) { result.skipped++; continue; }
          const cubes = num(r[7]);
          const cost = num(r[8]);
          const palletQty = Math.round(num(r[10]));
          const palletPrice = num(r[11]) || 130000;
          const sale = num(r[14]);
          const transport = num(r[18]);
          if (!cubes && !sale) { result.skipped++; continue; }
          const costTotal = cubes * cost;
          const palletTotal = palletQty * palletPrice;
          const saleTotal = cubes * sale;
          const created = await this.prisma.sale.create({
            data: {
              date: toDate(r[4]), agentId, clientId, regionId: region.id,
              plate: str(r[5]) || null, blockSizeId: await getSize(str(r[6])),
              cubes, costPricePerM3: cost, palletQty, palletPrice, salePricePerM3: sale,
              transportCost: transport, transportPaid: true,
              costTotal, palletTotal, saleTotal, profit: saleTotal - costTotal - palletTotal - transport,
            },
          });
          if (palletQty > 0) {
            await this.prisma.palletMovement.create({ data: { clientId, saleId: created.id, issuedQty: palletQty, date: created.date, note: 'Import' } });
          }
          result.sales++;
        } catch { result.skipped++; }
      }
    }

    // ---- Оплата (payments), header at row 4 (index 3), data from index 4 ----
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
          let method = 'TRANSFER';
          if (usd > 0) method = 'USD';
          else if (num(r[11]) > 0) method = 'CLICK';
          else if (num(r[12]) > 0) method = 'TERMINAL';
          else if (num(r[5]) > 0) method = 'CASH';
          const amount = num(r[17]) || num(r[3]);
          if (!amount) { result.skipped++; continue; }
          await this.prisma.payment.create({
            data: {
              date: toDate(r[0]), agentId, clientId, payerName: str(r[4]) || null,
              method, usdAmount: usd, rate: num(r[14]), amount, note: str(r[19]) || null,
            },
          });
          result.payments++;
        } catch { result.skipped++; }
      }
    }

    // ---- Оплата Завод (factory payments), header at index 1, data from index 2 ----
    const zavod = this.findSheet(wb, 'оплата завод', 'oplata zavod');
    if (zavod) {
      for (let i = 2; i < zavod.length; i++) {
        const r = zavod[i] || [];
        const amount = num(r[1]);
        if (!amount) continue;
        try {
          const recipient = str(r[3]);
          let factoryId: number | null = null;
          if (recipient) factoryId = await getFactory(recipient.replace(/["']/g, '').split(' ')[0] || recipient);
          await this.prisma.factoryPayment.create({
            data: { date: toDate(r[0]), amount, payer: str(r[2]) || null, recipient: recipient || null, factoryId },
          });
          result.factoryPayments++;
        } catch { result.skipped++; }
      }
    }

    return {
      ok: true,
      replaced: replace,
      sheets: wb.SheetNames,
      imported: result,
    };
  }
}
