import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';

// method -> cashbox name (matches seed + PaymentsService)
const CASHBOX_BY_METHOD: Record<string, string> = {
  CASH: 'Naqt kassa (UZS)', USD: 'Naqt kassa (USD)', CLICK: 'Click kassa', TERMINAL: 'Click kassa', BANK: 'Bank kassa', TRANSFER: 'Bank kassa',
};

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

    // The whole import runs in ONE transaction: a destructive replace only commits if every insert
    // succeeds, so a mid-run crash can never leave the DB wiped or half-imported.
    return this.prisma.$transaction(async (tx) => {
      if (replace) {
        // FK-safe order, and also drop the PAYMENT/EXPENSE cash mirrors + expenses so no orphaned
        // kassa rows survive to poison the derived cash balance.
        await tx.cashTransaction.deleteMany({ where: { source: { in: ['PAYMENT', 'EXPENSE'] } } });
        await tx.expense.deleteMany();
        await tx.payment.deleteMany();
        await tx.order.deleteMany();
        await tx.product.deleteMany();
        await tx.client.deleteMany();
      }

      const region = await tx.region.upsert({ where: { name: 'Xorazm Beruniy' }, update: {}, create: { name: 'Xorazm Beruniy' } });
      const existingFactory = await tx.factory.findFirst({ where: { name: 'CAOLS KS' } });
      const factory = existingFactory ?? (await tx.factory.create({ data: { name: 'CAOLS KS' } }));

      const boxes = await tx.cashbox.findMany();
      const boxByName = new Map(boxes.map((b) => [b.name, b]));
      const resolveBox = (method: string) => boxByName.get(CASHBOX_BY_METHOD[method] ?? '') ?? null;

      const agentCache = new Map<string, string>();
      const clientCache = new Map<string, string>();
      const productCache = new Map<string, string>();
      const vehicleCache = new Map<string, string>();

      const getAgent = async (name: string) => {
        if (!name) return null;
        const k = name.toLowerCase();
        if (agentCache.has(k)) return agentCache.get(k)!;
        const ex = await tx.agent.findFirst({ where: { name } });
        const a = ex ?? (await tx.agent.create({ data: { name } }));
        agentCache.set(k, a.id); return a.id;
      };
      const getClient = async (name: string, agentId: string | null) => {
        if (!name) return null;
        const k = name.toLowerCase();
        if (clientCache.has(k)) return clientCache.get(k)!;
        const ex = await tx.client.findFirst({ where: { name } });
        const c = ex ?? (await tx.client.create({ data: { name, agentId, regionId: region.id } }));
        clientCache.set(k, c.id); return c.id;
      };
      const getProduct = async (size: string, costPrice: number, salePrice: number) => {
        const key = (size || 'gazoblok').toLowerCase();
        if (productCache.has(key)) return productCache.get(key)!;
        const name = 'Gazoblok ' + (size || '');
        const ex = await tx.product.findFirst({ where: { factoryId: factory.id, size: size || null } });
        const p = ex ?? (await tx.product.create({ data: { factoryId: factory.id, name: name.trim(), size: size || null, unit: 'm3', costPrice, salePrice } }));
        productCache.set(key, p.id); return p.id;
      };
      const getVehicle = async (plate: string) => {
        if (!plate) return null;
        const k = plate.toLowerCase();
        if (vehicleCache.has(k)) return vehicleCache.get(k)!;
        const ex = await tx.vehicle.findFirst({ where: { plate } });
        const v = ex ?? (await tx.vehicle.create({ data: { name: plate, plate } }));
        vehicleCache.set(k, v.id); return v.id;
      };

      const result = { orders: 0, payments: 0, factoryPayments: 0, skipped: 0 };

      // next order number from the highest existing numeric suffix (survives gaps)
      const existingOrders = await tx.order.findMany({ select: { orderNo: true } });
      let orderNo = existingOrders.reduce((m, o) => {
        const n = parseInt(String(o.orderNo).replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);

      // create a payment + its mirror kassa row together (so kassa always reflects imported money)
      const makePayment = async (data: any, method: string, direction: 'IN' | 'OUT', usdAmount: number) => {
        const box = resolveBox(method);
        const payment = await tx.payment.create({ data: { ...data, cashboxId: box?.id ?? null } });
        if (box) {
          const boxAmount = box.currency === 'USD' ? usdAmount : data.amount;
          if (boxAmount) {
            await tx.cashTransaction.create({
              data: { cashboxId: box.id, direction, amount: boxAmount, rate: data.rate ?? 0, source: 'PAYMENT', date: data.date, note: 'Import to‘lov', paymentId: payment.id },
            });
          }
        }
        return payment;
      };

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
            await tx.order.create({
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

      // Oplata -> client payments (+ kassa IN mirror)
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
            await makePayment(
              { date: toDate(r[0]), type: 'CLIENT', agentId, clientId, payerName: str(r[4]) || null, method, usdAmount: usd, rate: num(r[14]), amount, note: str(r[19]) || null },
              method, 'IN', usd,
            );
            result.payments++;
          } catch { result.skipped++; }
        }
      }

      // Oplata Zavod -> factory payments (+ kassa OUT mirror)
      const zavod = this.findSheet(wb, 'оплата завод', 'oplata zavod');
      if (zavod) {
        for (let i = 2; i < zavod.length; i++) {
          const r = zavod[i] || [];
          const amount = num(r[1]);
          if (!amount) continue;
          try {
            await makePayment(
              { date: toDate(r[0]), type: 'FACTORY', factoryId: factory.id, method: 'BANK', amount, rate: 0, payerName: str(r[2]) || null, note: str(r[3]) || null },
              'BANK', 'OUT', 0,
            );
            result.factoryPayments++;
          } catch { result.skipped++; }
        }
      }

      return { ok: true, replaced: replace, sheets: wb.SheetNames, imported: result };
    }, { timeout: 120000, maxWait: 120000 });
  }
}
