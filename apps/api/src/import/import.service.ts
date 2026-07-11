import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CashDirection,
  CashSource,
  LedgerAccount,
  LedgerSource,
  LegalEntityKind,
  OrderStatus,
  PalletTransactionType,
  PaymentKind,
  PaymentMethod,
  PriceKind,
  Prisma,
  TransportMode,
  TransportPaidStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { LedgerService } from '../common/ledger.service';
import { D, round2, round3, ZERO } from '../common/money';
import { RequestUser } from '../common/scoping';
import {
  normKey,
  parseWorkbook,
  ParsedWorkbook,
  SheetPayment,
} from './workbook-parser';

type Dec = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

const TX_OPTS = { maxWait: 20_000, timeout: 120_000 };

const FACTORY_NAME = '"CAOLS KS" MCHJ';

/** seeded cashbox names (prisma/seed.ts) */
const CASHBOX = {
  CASH: 'Naqd kassa',
  BANK: 'Bank (Септем Алока)',
  BANK_SEMENT: 'Bank (Септем семент)',
  CLICK: 'Click',
  TERMINAL: 'Terminal',
  CARD: 'Karta',
  USD: 'Valyuta (USD)',
} as const;

/** built-in alias seed — client-sheet spellings win as canonical (excel-spec §10.3) */
const ALIAS_SEED: Array<{ alias: string; canonical: string }> = [
  { alias: 'Жасур Версал', canonical: 'Жаср Версал' },
  { alias: 'Шиддат моналит', canonical: 'Шиддат маналит' },
  { alias: 'NORMAT UMIDBEK', canonical: 'Нормат Умидбек' },
  { alias: 'Гофур хазорасп', canonical: 'Гофур Хазорасп' },
];

/** sentinel used to roll the write transaction back on dryRun while keeping its stats */
class DryRunRollback extends Error {
  constructor(public readonly stats: Prisma.InputJsonValue) {
    super('dry-run rollback');
  }
}

/** Decimal/Date-safe plain JSON (Prisma.Decimal serializes to string) */
const plainJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));

const daysBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 86_400_000;

interface ClientRef {
  id: string;
  name: string;
  agentId: string | null;
}

interface OplataPoolRow {
  clientId: string;
  amount: Dec;
  date: Date;
  used: boolean;
}

interface DriverPoolRow extends SheetPayment {
  used: boolean;
}

@Injectable()
export class ImportService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
  ) {}

  // ─────────────────────────── POST /import/excel ───────────────────────────

  async importExcel(buffer: Buffer, filename: string, dryRun: boolean, user: RequestUser) {
    const parsed = parseWorkbook(buffer);
    if (!parsed.ok) {
      throw new BadRequestException({
        message: 'Excel файл ўз-ўзини текширувдан ўтмади',
        errors: parsed.errors,
        failedChecks: parsed.checks.filter((c) => !c.ok),
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { batchId, stats } = await this.writeAll(tx, parsed, filename, dryRun, user);
        if (dryRun) throw new DryRunRollback(stats);
        return { batchId, stats };
      }, TX_OPTS);
    } catch (e) {
      if (e instanceof DryRunRollback) return { stats: e.stats };
      throw e;
    }
  }

  // ─────────────────────────── the write pass ───────────────────────────

  private async writeAll(
    tx: Tx,
    parsed: ParsedWorkbook,
    filename: string,
    dryRun: boolean,
    user: RequestUser,
  ): Promise<{ batchId: string; stats: Prisma.InputJsonValue }> {
    // ── guards: import lands only in an empty base ──
    const manualOrders = await tx.order.count({ where: { importBatchId: null } });
    if (manualOrders > 0) {
      throw new BadRequestException('Импорт бўш базага киритилади — базада қўлда яратилган буюртмалар бор');
    }
    const priorBatches = await tx.importBatch.count();
    if (priorBatches > 0 && !dryRun) {
      throw new BadRequestException(
        'Аввалги импорт партияси мавжуд — олдин DELETE /import/batches/:id (body {"confirm":true}) билан бекор қилинг',
      );
    }

    const batch = await tx.importBatch.create({
      data: { filename, createdById: user.userId },
    });
    const batchId = batch.id;

    // ── fixed refs ──
    const factory = await tx.factory.findUnique({ where: { name: FACTORY_NAME } });
    if (!factory) throw new BadRequestException(`Завод топилмади: ${FACTORY_NAME} (seed ишга туширилганми?)`);

    const cashboxes = await tx.cashbox.findMany();
    const cashboxByName = new Map(cashboxes.map((c) => [c.name, c]));
    const cb = (name: string) => {
      const box = cashboxByName.get(name);
      if (!box) throw new BadRequestException(`Касса топилмади: ${name} (seed ишга туширилганми?)`);
      return box;
    };

    const agents = await tx.agent.findMany();
    const agentByKey = new Map(agents.map((a) => [normKey(a.name), a.id]));
    const resolveAgentId = (raw: string | null | undefined): string | null => {
      const key = normKey(raw);
      if (!key) return null;
      const exact = agentByKey.get(key);
      if (exact) return exact;
      for (const [k, id] of agentByKey) if (key.startsWith(k)) return id; // «Жамол 22-22» → Жамол
      return null;
    };

    // ── legal entities (find-or-create, cached) ──
    const entities = await tx.legalEntity.findMany();
    const entityByKey = new Map(entities.map((e) => [normKey(e.name), e.id]));
    let entitiesCreated = 0;
    const entityIdFor = async (name: string): Promise<string> => {
      const key = normKey(name);
      const hit = entityByKey.get(key);
      if (hit) return hit;
      const row = await tx.legalEntity.create({
        data: { name: name.replace(/\s+/g, ' ').trim(), kind: LegalEntityKind.THIRD_PARTY },
      });
      entityByKey.set(key, row.id);
      entitiesCreated++;
      return row.id;
    };

    // ── products by size ──
    const products = await tx.product.findMany({ where: { factoryId: factory.id } });
    const productBySize = new Map(products.filter((p) => p.size).map((p) => [normKey(p.size), p.id]));
    let productsCreated = 0;
    const productFor = async (size: string, m3: Dec, palletCount: number): Promise<string> => {
      const key = normKey(size);
      const hit = productBySize.get(key);
      if (hit) return hit;
      const m3PerPallet =
        palletCount > 0 ? m3.dividedBy(palletCount).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP) : D('1.728');
      const row = await tx.product.create({
        data: { factoryId: factory.id, name: `Газоблок ${size}`, size, m3PerPallet },
      });
      productBySize.set(key, row.id);
      productsCreated++;
      return row.id;
    };

    // ── vehicles by plate ──
    const vehicles = await tx.vehicle.findMany();
    const vehicleByPlate = new Map(vehicles.filter((v) => v.plate).map((v) => [normKey(v.plate), v.id]));
    let vehiclesCreated = 0;
    const vehicleFor = async (plate: string): Promise<string> => {
      const key = normKey(plate);
      const hit = vehicleByPlate.get(key);
      if (hit) return hit;
      const clean = plate.replace(/\s+/g, ' ').trim();
      const row = await tx.vehicle.create({ data: { name: clean, plate: clean } });
      vehicleByPlate.set(key, row.id);
      vehiclesCreated++;
      return row.id;
    };

    // ── client resolution: canonical = client-sheet name minus numeric prefix ──
    const aliasKeyMap = new Map<string, string>(); // normKey(alias) → normKey(canonical)
    for (const a of ALIAS_SEED) aliasKeyMap.set(normKey(a.alias), normKey(a.canonical));
    const resolveKey = (raw: string) => {
      const key = normKey(raw);
      return aliasKeyMap.get(key) ?? key;
    };

    const clientsByKey = new Map<string, ClientRef>();
    for (const c of await tx.client.findMany()) {
      clientsByKey.set(normKey(c.name), { id: c.id, name: c.name, agentId: c.agentId });
    }
    for (const al of await tx.clientAlias.findMany({ include: { client: true } })) {
      clientsByKey.set(normKey(al.name), {
        id: al.clientId,
        name: al.client.name,
        agentId: al.client.agentId,
      });
    }

    // agent attribution per client key: first Товар row wins, Оплата as fallback
    const agentRawByKey = new Map<string, string>();
    for (const t of parsed.tovar) {
      const key = resolveKey(t.clientRaw);
      if (!agentRawByKey.has(key)) agentRawByKey.set(key, t.agentRaw);
    }
    for (const o of parsed.oplata) {
      const key = resolveKey(o.clientRaw);
      if (o.agentRaw && !agentRawByKey.has(key)) agentRawByKey.set(key, o.agentRaw);
    }

    let clientsCreated = 0;
    const ensureClient = async (name: string): Promise<ClientRef> => {
      const key = resolveKey(name);
      const hit = clientsByKey.get(key);
      if (hit) return hit;
      const agentId = resolveAgentId(agentRawByKey.get(key));
      const row = await tx.client.create({
        data: { name: name.replace(/\s+/g, ' ').trim(), agentId },
      });
      const ref = { id: row.id, name: row.name, agentId: row.agentId };
      clientsByKey.set(key, ref);
      clientsCreated++;
      return ref;
    };

    // canonical (sheet) clients first so their spelling wins
    const sheetKeys = new Set<string>();
    for (const sheet of parsed.clientSheets) {
      sheetKeys.add(normKey(sheet.canonicalName));
      await ensureClient(sheet.canonicalName);
    }
    for (const t of parsed.tovar) await ensureClient(t.clientRaw);
    for (const o of parsed.oplata) await ensureClient(o.clientRaw);

    // alias rows for the built-in spelling drift
    let aliasesCreated = 0;
    for (const a of ALIAS_SEED) {
      const canonical = clientsByKey.get(normKey(a.canonical));
      if (!canonical) continue;
      const existing = await tx.clientAlias.findUnique({ where: { name: a.alias } });
      if (!existing) {
        await tx.clientAlias.create({ data: { clientId: canonical.id, name: a.alias } });
        aliasesCreated++;
      }
    }

    const clientFor = (raw: string): ClientRef => {
      const ref = clientsByKey.get(resolveKey(raw));
      if (!ref) throw new BadRequestException(`Мижоз аниқланмади: ${raw}`);
      return ref;
    };

    // ── driver-direct payment pool per client (matched to «клентдан» trucks in date order) ──
    const driverPool = new Map<string, DriverPoolRow[]>(); // clientId → sorted payments
    for (const sheet of parsed.clientSheets) {
      const client = clientFor(sheet.canonicalName);
      const rows: DriverPoolRow[] = sheet.payments
        .filter((p) => p.driverDirect)
        .map((p) => ({ ...p, used: false }))
        .sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
      if (rows.length) driverPool.set(client.id, rows);
    }
    const takeDriverPayment = (clientId: string): DriverPoolRow | null => {
      const rows = driverPool.get(clientId);
      const next = rows?.find((r) => !r.used);
      if (next) next.used = true;
      return next ?? null;
    };

    // ── stats accumulators ──
    const unmatchedClientDriverTrucks: Array<Record<string, unknown>> = [];
    const unmatchedDriverPayments: Array<Record<string, unknown>> = [];
    const unreconciledPayments: Array<Record<string, unknown>> = [];
    let unreconciledTotal = ZERO;
    const lastOrderByClient = new Map<string, { orderId: string; vehicleId: string; date: Date }>();
    interface TovarTruck {
      excelRow: number;
      date: Date;
      plate: string;
      amount: Dec; // saleTotal
      pallets: number;
      used: boolean;
    }
    const tovarAggByKey = new Map<string, { sale: Dec; pallets: number; trucks: TovarTruck[] }>();

    // ── shared payment writers (mirror payments.service postLedger + kassa rules) ──
    const createClientIn = async (args: {
      date: Date;
      client: ClientRef;
      method: PaymentMethod;
      amount: Dec;
      usdAmount?: Dec;
      rate?: Dec;
      cashboxName: string;
      payerEntityId?: string | null;
      payerName?: string | null;
      receiverEntityId?: string | null;
      receiverName?: string | null;
      note?: string | null;
      reconciled: boolean;
    }) => {
      const box = cb(args.cashboxName);
      const payment = await tx.payment.create({
        data: {
          date: args.date,
          kind: PaymentKind.CLIENT_IN,
          method: args.method,
          amount: args.amount,
          usdAmount: args.usdAmount ?? ZERO,
          rate: args.rate ?? ZERO,
          agentId: args.client.agentId,
          clientId: args.client.id,
          payerEntityId: args.payerEntityId ?? null,
          receiverEntityId: args.receiverEntityId ?? null,
          payerName: args.payerName ?? null,
          receiverName: args.receiverName ?? null,
          cashboxId: box.id,
          note: args.note ?? null,
          reconciled: args.reconciled,
          createdById: user.userId,
          importBatchId: batchId,
        },
      });
      await this.ledger.post(tx, {
        date: args.date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.PAYMENT,
        amount: args.amount.negated(),
        clientId: args.client.id,
        paymentId: payment.id,
        createdById: user.userId,
        importBatchId: batchId,
      });
      await tx.cashTransaction.create({
        data: {
          cashboxId: box.id,
          date: args.date,
          direction: CashDirection.IN,
          amount: box.currency === 'USD' ? (args.usdAmount ?? args.amount) : args.amount,
          rate: args.rate ?? ZERO,
          source: CashSource.PAYMENT,
          paymentId: payment.id,
          note: args.note ?? null,
          createdById: user.userId,
          importBatchId: batchId,
        },
      });
      return payment;
    };

    const createTransportDirect = async (args: {
      date: Date;
      client: ClientRef;
      vehicleId: string;
      amount: Dec;
      orderId?: string;
      note: string;
    }) => {
      const payment = await tx.payment.create({
        data: {
          date: args.date,
          kind: PaymentKind.TRANSPORT_DIRECT,
          method: PaymentMethod.CASH,
          amount: args.amount,
          agentId: args.client.agentId,
          clientId: args.client.id,
          vehicleId: args.vehicleId,
          note: args.note,
          reconciled: true, // by definition — never touches dealer cash
          createdById: user.userId,
          importBatchId: batchId,
        },
      });
      await this.ledger.post(tx, {
        date: args.date,
        account: LedgerAccount.CLIENT,
        source: LedgerSource.PAYMENT,
        amount: args.amount.negated(),
        clientId: args.client.id,
        paymentId: payment.id,
        createdById: user.userId,
        importBatchId: batchId,
      });
      await this.ledger.post(tx, {
        date: args.date,
        account: LedgerAccount.VEHICLE,
        source: LedgerSource.PAYMENT,
        amount: args.amount,
        vehicleId: args.vehicleId,
        paymentId: payment.id,
        createdById: user.userId,
        importBatchId: batchId,
      });
      if (args.orderId) {
        await tx.paymentAllocation.create({
          data: { paymentId: payment.id, orderId: args.orderId, amount: args.amount, createdById: user.userId },
        });
      }
      return payment;
    };

    // ─────────────── 1. Товар rows → COMPLETED orders ───────────────
    let ordersCreated = 0;
    for (const row of parsed.tovar) {
      const client = clientFor(row.clientRaw);
      const clientKey = resolveKey(row.clientRaw);
      const productId = await productFor(row.size, row.m3, row.palletCount);
      const vehicleId = await vehicleFor(row.plate);
      const agentId = resolveAgentId(row.agentRaw) ?? client.agentId;

      // transport resolution (excel-spec §8 + owner rules)
      let transportCost = ZERO;
      let transportPaidStatus: TransportPaidStatus = TransportPaidStatus.NOT_APPLICABLE;
      let transportPaidAt: Date | null = null;
      let driverPayment: DriverPoolRow | null = null;
      let payDealerTransport = false;

      if (row.transportKind === 'DEALER') {
        transportCost = row.transportAmount;
        if (row.transportPaid) {
          transportPaidStatus = TransportPaidStatus.PAID;
          transportPaidAt = row.transportPaidDate ?? row.date;
          payDealerTransport = true;
        } else {
          transportPaidStatus = TransportPaidStatus.UNKNOWN; // workbook blank — owner must resolve
        }
      } else if (row.transportKind === 'CLIENT_DIRECT') {
        driverPayment = takeDriverPayment(client.id);
        if (driverPayment) {
          transportCost = driverPayment.amount;
          transportPaidStatus = TransportPaidStatus.PAID_BY_CLIENT;
          transportPaidAt = driverPayment.date ?? row.date;
        } else {
          transportPaidStatus = TransportPaidStatus.UNKNOWN;
          unmatchedClientDriverTrucks.push({
            excelRow: row.excelRow,
            client: client.name,
            date: row.date.toISOString().slice(0, 10),
            plate: row.plate,
          });
        }
      }

      const [{ nextval }] = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('order_no_seq') AS nextval`;
      const orderNo = 'ORD-' + String(nextval).padStart(6, '0');

      const pricePending = row.salePricePerM3 === null;
      const order = await tx.order.create({
        data: {
          orderNo,
          date: row.date,
          status: OrderStatus.COMPLETED,
          completedAt: row.date,
          agentId,
          clientId: client.id,
          factoryId: factory.id,
          vehicleId,
          saleTotal: row.saleTotal,
          costTotal: row.costTotal,
          costStatus: 'PROVISIONAL',
          transportMode: TransportMode.DEALER_ABSORBED,
          transportCost,
          transportCharge: ZERO,
          transportPaidStatus,
          transportPaidAt,
          createdById: user.userId,
          importBatchId: batchId,
          items: {
            create: [
              {
                productId,
                quantityM3: round3(row.m3),
                palletCount: row.palletCount,
                palletPrice: row.palletPrice,
                salePricePerM3: row.salePricePerM3 ?? ZERO,
                saleTotal: row.saleTotal,
                pricePending,
                provisionalPriceKind: PriceKind.FACTORY_BANK,
                costPricePerM3: row.costPricePerM3,
                costTotal: row.costTotal,
              },
            ],
          },
        },
      });
      ordersCreated++;

      await tx.orderStatusHistory.create({
        data: { orderId: order.id, from: null, to: OrderStatus.COMPLETED, byId: user.userId, note: 'Import' },
      });

      // ledger postings — mirror orders.service postOrderLedger exactly
      if (row.saleTotal.gt(0)) {
        await this.ledger.post(tx, {
          date: row.date,
          account: LedgerAccount.CLIENT,
          source: LedgerSource.ORDER_SALE,
          amount: row.saleTotal,
          clientId: client.id,
          orderId: order.id,
          createdById: user.userId,
          importBatchId: batchId,
        });
      }
      if (row.costTotal.gt(0)) {
        await this.ledger.post(tx, {
          date: row.date,
          account: LedgerAccount.FACTORY,
          source: LedgerSource.ORDER_COST,
          amount: row.costTotal.negated(),
          factoryId: factory.id,
          orderId: order.id,
          createdById: user.userId,
          importBatchId: batchId,
        });
      }
      if (transportCost.gt(0)) {
        await this.ledger.post(tx, {
          date: row.date,
          account: LedgerAccount.VEHICLE,
          source: LedgerSource.TRANSPORT_COST,
          amount: transportCost.negated(),
          vehicleId,
          orderId: order.id,
          createdById: user.userId,
          importBatchId: batchId,
        });
      }

      // pallets: bought with the truck + delivered to the client
      if (row.palletCount > 0) {
        await tx.palletTransaction.create({
          data: {
            type: PalletTransactionType.RECEIVED_FROM_FACTORY,
            factoryId: factory.id,
            qty: row.palletCount,
            orderId: order.id,
            date: row.date,
            createdById: user.userId,
            importBatchId: batchId,
          },
        });
        await tx.palletTransaction.create({
          data: {
            type: PalletTransactionType.DELIVERED_TO_CLIENT,
            clientId: client.id,
            qty: row.palletCount,
            orderId: order.id,
            date: row.date,
            createdById: user.userId,
            importBatchId: batchId,
          },
        });
      }
      // NO bonus accrual: no BonusProgram rows exist at these dates (programInForce ⇒ null)

      // dealer-paid transport («Туланди»/date) → synthesized VEHICLE_OUT payment
      if (payDealerTransport && transportCost.gt(0)) {
        const payDate = transportPaidAt ?? row.date;
        const box = cb(CASHBOX.CASH);
        const payment = await tx.payment.create({
          data: {
            date: payDate,
            kind: PaymentKind.VEHICLE_OUT,
            method: PaymentMethod.CASH,
            amount: transportCost,
            vehicleId,
            cashboxId: box.id,
            note: 'Import: транспорт Туланди',
            createdById: user.userId,
            importBatchId: batchId,
          },
        });
        await this.ledger.post(tx, {
          date: payDate,
          account: LedgerAccount.VEHICLE,
          source: LedgerSource.PAYMENT,
          amount: transportCost,
          vehicleId,
          paymentId: payment.id,
          createdById: user.userId,
          importBatchId: batchId,
        });
        await tx.cashTransaction.create({
          data: {
            cashboxId: box.id,
            date: payDate,
            direction: CashDirection.OUT,
            amount: transportCost,
            source: CashSource.PAYMENT,
            paymentId: payment.id,
            note: 'Import: транспорт Туланди',
            createdById: user.userId,
            importBatchId: batchId,
          },
        });
        await tx.paymentAllocation.create({
          data: { paymentId: payment.id, orderId: order.id, amount: transportCost, createdById: user.userId },
        });
      }

      // client-paid transport («клентдан» matched to a «шопр учун барди» sheet payment)
      if (driverPayment) {
        await createTransportDirect({
          date: driverPayment.date ?? row.date,
          client,
          vehicleId,
          amount: driverPayment.amount,
          orderId: order.id,
          note: 'шопр учун барди',
        });
      }

      lastOrderByClient.set(client.id, { orderId: order.id, vehicleId, date: row.date });
      const agg = tovarAggByKey.get(clientKey) ?? { sale: ZERO, pallets: 0, trucks: [] };
      agg.sale = agg.sale.plus(row.saleTotal);
      agg.pallets += row.palletCount;
      agg.trucks.push({
        excelRow: row.excelRow,
        date: row.date,
        plate: row.plate,
        amount: row.saleTotal,
        pallets: row.palletCount,
        used: false,
      });
      tovarAggByKey.set(clientKey, agg);
    }

    // ─────────────── 2. Оплата rows → CLIENT_IN payments (split by channel) ───────────────
    const oplataPool: OplataPoolRow[] = [];
    for (const row of parsed.oplata) {
      const client = clientFor(row.clientRaw);
      const payerEntityId = row.payerRaw ? await entityIdFor(row.payerRaw) : null;
      let receiverEntityId: string | null = null;
      let receiverName: string | null = null;
      if (row.receiverRaw) {
        if (row.receiverIsNumeric || /^\d[\d\s]*$/.test(row.receiverRaw)) receiverName = row.receiverRaw;
        else receiverEntityId = await entityIdFor(row.receiverRaw);
      }
      const receiverIsSement = normKey(row.receiverRaw).includes('септем семент');
      for (const ch of row.channels) {
        const method =
          ch.method === 'BANK' ? PaymentMethod.BANK
          : ch.method === 'CASH' || ch.method === 'OTHER' ? PaymentMethod.CASH
          : ch.method === 'CLICK' ? PaymentMethod.CLICK
          : ch.method === 'TERMINAL' ? PaymentMethod.TERMINAL
          : PaymentMethod.USD;
        const cashboxName =
          ch.method === 'BANK' ? (receiverIsSement ? CASHBOX.BANK_SEMENT : CASHBOX.BANK)
          : ch.method === 'CASH' || ch.method === 'OTHER' ? CASHBOX.CASH
          : ch.method === 'CLICK' ? CASHBOX.CLICK
          : ch.method === 'TERMINAL' ? CASHBOX.TERMINAL
          : CASHBOX.USD;
        await createClientIn({
          date: row.date,
          client,
          method,
          amount: ch.amount,
          usdAmount: ch.usdAmount,
          rate: ch.rate,
          cashboxName,
          payerEntityId,
          payerName: row.payerRaw,
          receiverEntityId,
          receiverName,
          note: [row.note, ch.method === 'OTHER' ? 'Прочие' : null].filter(Boolean).join(' | ') || null,
          reconciled: true,
        });
      }
      oplataPool.push({ clientId: client.id, amount: row.total, date: row.date, used: false });
    }

    // ─────────────── 3. client-sheet non-driver payments: match against Оплата ───────────────
    // pass 1: same client, amount ±1, date within ±3 days;
    // pass 2 (null dates + the known 06-06 typo row): same client, amount ±1 only.
    interface PendingSheetPayment {
      client: ClientRef;
      p: SheetPayment;
      matched: boolean;
    }
    const pending: PendingSheetPayment[] = [];
    for (const sheet of parsed.clientSheets) {
      const client = clientFor(sheet.canonicalName);
      for (const p of sheet.payments) {
        if (!p.driverDirect) pending.push({ client, p, matched: false });
      }
    }
    const takeFromPool = (clientId: string, amount: Dec, date: Date | null, checkDate: boolean): boolean => {
      const hit = oplataPool.find(
        (row) =>
          !row.used &&
          row.clientId === clientId &&
          row.amount.minus(amount).abs().lte(1) &&
          (!checkDate || (date !== null && daysBetween(row.date, date) <= 3)),
      );
      if (hit) hit.used = true;
      return Boolean(hit);
    };
    for (const item of pending) {
      if (item.p.date && takeFromPool(item.client.id, item.p.amount, item.p.date, true)) item.matched = true;
    }
    for (const item of pending) {
      if (!item.matched && takeFromPool(item.client.id, item.p.amount, item.p.date, false)) item.matched = true;
    }
    for (const item of pending) {
      if (item.matched) continue; // already imported through the Оплата ledger
      const date = item.p.date ?? new Date();
      await createClientIn({
        date,
        client: item.client,
        method: PaymentMethod.BANK,
        amount: item.p.amount,
        cashboxName: CASHBOX.BANK,
        payerName: item.p.noteRaw,
        note: 'Импорт: мижоз варағидан (Оплата даптарида йўқ)',
        reconciled: false,
      });
      unreconciledTotal = unreconciledTotal.plus(item.p.amount);
      unreconciledPayments.push({
        client: item.client.name,
        amount: item.p.amount.toFixed(2),
        date: item.p.date ? item.p.date.toISOString().slice(0, 10) : null,
        payer: item.p.noteRaw,
      });
    }

    // ─────────────── 4. leftover driver-direct payments (no «клентдан» truck) ───────────────
    // The workbook credits them to the client (they are inside C5), so they must
    // post CLIENT −amount; the vehicle side goes to the client's latest truck.
    for (const [clientId, rows] of driverPool) {
      for (const row of rows) {
        if (row.used) continue;
        const last = lastOrderByClient.get(clientId);
        const client = [...clientsByKey.values()].find((c) => c.id === clientId)!;
        if (!last) {
          unmatchedDriverPayments.push({
            client: client.name,
            amount: row.amount.toFixed(2),
            date: row.date ? row.date.toISOString().slice(0, 10) : null,
            imported: false,
            reason: 'мижозда буюртма йўқ — киритилмади',
          });
          continue;
        }
        await createTransportDirect({
          date: row.date ?? last.date,
          client,
          vehicleId: last.vehicleId,
          amount: row.amount,
          note: 'шопр учун барди (импорт: «клентдан» юк топилмади)',
        });
        unmatchedDriverPayments.push({
          client: client.name,
          amount: row.amount.toFixed(2),
          date: row.date ? row.date.toISOString().slice(0, 10) : null,
          imported: true,
          reason: 'мос «клентдан» юк йўқ — охирги юк машинасига ёзилди',
        });
      }
    }

    // ─────────────── 5. client-sheet pallet returns ───────────────
    for (const sheet of parsed.clientSheets) {
      const client = clientFor(sheet.canonicalName);
      for (const ret of sheet.palletReturns) {
        await tx.palletTransaction.create({
          data: {
            type: PalletTransactionType.RETURNED_BY_CLIENT,
            clientId: client.id,
            qty: ret.qty,
            date: ret.date ?? new Date(),
            note: 'Import: возврат паддон',
            createdById: user.userId,
            importBatchId: batchId,
          },
        });
      }
    }

    // ─────────────── 6. Оплата Завод → FACTORY_OUT payments ───────────────
    for (const row of parsed.factoryPayments) {
      const payerKey = normKey(row.payerRaw);
      const method = payerKey.includes('пластика')
        ? PaymentMethod.CARD
        : payerKey.includes('нахт')
          ? PaymentMethod.CASH
          : PaymentMethod.BANK;
      const cashboxName =
        method === PaymentMethod.CARD ? CASHBOX.CARD : method === PaymentMethod.CASH ? CASHBOX.CASH : CASHBOX.BANK;
      const box = cb(cashboxName);
      const payerEntityId = method === PaymentMethod.BANK && row.payerRaw ? await entityIdFor(row.payerRaw) : null;
      let receiverEntityId: string | null = null;
      let receiverName: string | null = null;
      if (row.receiverRaw) {
        if (row.receiverIsNumeric || /^\d[\d\s]*$/.test(row.receiverRaw)) receiverName = row.receiverRaw;
        else receiverEntityId = await entityIdFor(row.receiverRaw);
      }
      const payment = await tx.payment.create({
        data: {
          date: row.date,
          kind: PaymentKind.FACTORY_OUT,
          method,
          amount: row.amount,
          factoryId: factory.id,
          payerEntityId,
          payerName: row.payerRaw,
          receiverEntityId,
          receiverName,
          cashboxId: box.id,
          createdById: user.userId,
          importBatchId: batchId,
        },
      });
      await this.ledger.post(tx, {
        date: row.date,
        account: LedgerAccount.FACTORY,
        source: LedgerSource.PAYMENT,
        amount: row.amount,
        factoryId: factory.id,
        paymentId: payment.id,
        createdById: user.userId,
        importBatchId: batchId,
      });
      // NOTE: no balance guard — imported history may legitimately drive a box negative
      // (the dealer funded factory payments from outside money); see stats.cashboxBalances.
      await tx.cashTransaction.create({
        data: {
          cashboxId: box.id,
          date: row.date,
          direction: CashDirection.OUT,
          amount: row.amount,
          source: CashSource.PAYMENT,
          paymentId: payment.id,
          createdById: user.userId,
          importBatchId: batchId,
        },
      });
    }

    // ─────────────── 7. expected balances (recomputed INDEPENDENTLY from the sheets) ───────────────
    // The sheets are stale in places (excel-spec §6 фарк(goods) = +95 104 800:
    // un-copied trucks on Фидато/Версал/Уткир, unpriced Шиддат pallets, the
    // 1 964 800/1 964 000 Уткир payment drift). We KEEP expected = −F2 recomputed
    // (honest reconciliation) but also detect the Товар↔sheet truck gaps so the
    // reconciliation can tell a workbook defect from an import error.
    const expectedClients: Array<Record<string, unknown>> = [];
    for (const sheet of parsed.clientSheets) {
      const client = clientFor(sheet.canonicalName);
      const clientKey = resolveKey(sheet.canonicalName);
      const trucks = tovarAggByKey.get(clientKey)?.trucks ?? [];

      // match Товар trucks to sheet right-half rows by sale amount (±1), consume once
      const goodsPool = sheet.goods.map((g) => ({ ...g, used: false }));
      const missingFromSheet: TovarTruck[] = [];
      for (const truck of trucks) {
        const hit = goodsPool.find((g) => !g.used && g.total.minus(truck.amount).abs().lte(1));
        if (hit) hit.used = true;
        else missingFromSheet.push(truck);
      }
      const extraOnSheet = goodsPool.filter((g) => !g.used);
      // Оплата ledger rows of this client that no sheet payment matched
      const oplataNotOnSheet = oplataPool.filter((p) => !p.used && p.clientId === client.id);

      const missingTotal = missingFromSheet.reduce((a, t) => a.plus(t.amount), ZERO);
      const extraTotal = extraOnSheet.reduce((a, g) => a.plus(g.total), ZERO);
      const oplataGapTotal = oplataNotOnSheet.reduce((a, p) => a.plus(p.amount), ZERO);
      const missingPallets = missingFromSheet.reduce((a, t) => a + t.pallets, 0);
      const extraPallets = extraOnSheet.reduce((a, g) => a + g.palletCount, 0);

      // what the CURRENT ledger should show once the sheet's staleness is accounted for
      const adjustedBalance = sheet.expectedBalance.plus(missingTotal).minus(extraTotal).minus(oplataGapTotal);
      const hasGaps = missingFromSheet.length > 0 || extraOnSheet.length > 0 || oplataNotOnSheet.length > 0;

      expectedClients.push({
        clientId: client.id,
        name: client.name,
        expectedBalance: sheet.expectedBalance.toFixed(2),
        expectedPallets: sheet.expectedPallets,
        sheetless: false,
        ...(hasGaps
          ? {
              sheetGaps: {
                missingFromSheet: missingFromSheet.map((t) => ({
                  excelRow: t.excelRow,
                  date: t.date.toISOString().slice(0, 10),
                  plate: t.plate,
                  amount: t.amount.toFixed(2),
                  pallets: t.pallets,
                })),
                extraOnSheet: extraOnSheet.map((g) => ({
                  excelRow: g.excelRow,
                  date: g.date ? g.date.toISOString().slice(0, 10) : null,
                  plate: g.plate,
                  amount: g.total.toFixed(2),
                  pallets: g.palletCount,
                })),
                oplataNotOnSheet: oplataNotOnSheet.map((p) => ({
                  date: p.date.toISOString().slice(0, 10),
                  amount: p.amount.toFixed(2),
                })),
                adjustedExpectedBalance: adjustedBalance.toFixed(2),
                adjustedExpectedPallets: sheet.expectedPallets + missingPallets - extraPallets,
              },
            }
          : {}),
      });
    }
    for (const [key, agg] of tovarAggByKey) {
      if (sheetKeys.has(key)) continue;
      const client = clientsByKey.get(key)!;
      expectedClients.push({
        clientId: client.id,
        name: client.name,
        expectedBalance: agg.sale.toFixed(2), // no sheet ⇒ no payments known
        expectedPallets: agg.pallets,
        sheetless: true,
      });
    }
    const factoryPaid = parsed.factoryPayments.reduce((a, f) => a.plus(f.amount), ZERO);
    const factoryCost = parsed.tovar.reduce((a, t) => a.plus(t.costTotal), ZERO);
    const factoryExpected = factoryPaid.minus(factoryCost); // 2101088520 − 1127469250 = 973619270

    // ─────────────── 8. cashbox balances (owner decides opening entries) ───────────────
    const cashSums = await tx.cashTransaction.groupBy({
      by: ['cashboxId', 'direction'],
      _sum: { amount: true },
    });
    const cashboxBalances: Array<Record<string, unknown>> = [];
    for (const box of cashboxes) {
      const inSum = D(cashSums.find((s) => s.cashboxId === box.id && s.direction === 'IN')?._sum.amount ?? 0);
      const outSum = D(cashSums.find((s) => s.cashboxId === box.id && s.direction === 'OUT')?._sum.amount ?? 0);
      if (inSum.isZero() && outSum.isZero()) continue;
      cashboxBalances.push({
        cashboxId: box.id,
        name: box.name,
        currency: box.currency,
        in: inSum.toFixed(2),
        out: outSum.toFixed(2),
        balance: inSum.minus(outSum).toFixed(2),
      });
    }

    // ─────────────── 9. stats + audit ───────────────
    const counts = {
      orders: ordersCreated,
      payments: await tx.payment.count({ where: { importBatchId: batchId } }),
      paymentsByKind: Object.fromEntries(
        (
          await tx.payment.groupBy({ by: ['kind'], where: { importBatchId: batchId }, _count: { _all: true } })
        ).map((g) => [g.kind, g._count._all]),
      ),
      ledgerEntries: await tx.ledgerEntry.count({ where: { importBatchId: batchId } }),
      palletTransactions: await tx.palletTransaction.count({ where: { importBatchId: batchId } }),
      cashTransactions: await tx.cashTransaction.count({ where: { importBatchId: batchId } }),
      allocations: await tx.paymentAllocation.count({
        where: { payment: { importBatchId: batchId } },
      }),
      clientsCreated,
      vehiclesCreated,
      productsCreated,
      entitiesCreated,
      aliasesCreated,
    };

    const stats = plainJson({
      filename,
      dryRun,
      checks: parsed.checks,
      counts,
      unmatchedClientDriverTrucks,
      unmatchedDriverPayments,
      unreconciled: {
        total: unreconciledTotal.toFixed(2),
        payments: unreconciledPayments,
      },
      expected: {
        factoryId: factory.id,
        factoryExpected: factoryExpected.toFixed(2),
        clients: expectedClients,
      },
      cashboxBalances,
    });

    await tx.importBatch.update({ where: { id: batchId }, data: { stats } });

    await this.audit.log({
      tx,
      userId: user.userId,
      action: AuditAction.IMPORT,
      entity: 'ImportBatch',
      entityId: batchId,
      after: plainJson({ filename, dryRun, counts }),
      note: `Excel import: ${filename}${dryRun ? ' (dry run)' : ''}`,
    });

    return { batchId, stats };
  }

  // ─────────────────────────── GET /import/batches ───────────────────────────

  async listBatches() {
    return this.prisma.importBatch.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, username: true } },
        _count: {
          select: {
            orders: true,
            payments: true,
            ledgerEntries: true,
            palletTransactions: true,
            cashTransactions: true,
            expenses: true,
          },
        },
      },
    });
  }

  // ──────────────── GET /import/batches/:id/reconciliation ────────────────

  async reconciliation(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Импорт партияси топилмади');
    const stats = batch.stats as {
      expected?: {
        factoryId: string;
        factoryExpected: string;
        clients: Array<{
          clientId: string;
          name: string;
          expectedBalance: string;
          expectedPallets: number;
          sheetless: boolean;
          sheetGaps?: {
            missingFromSheet: unknown[];
            extraOnSheet: unknown[];
            oplataNotOnSheet: unknown[];
            adjustedExpectedBalance: string;
            adjustedExpectedPallets: number;
          };
        }>;
      };
    } | null;
    if (!stats?.expected) {
      throw new BadRequestException('Партияда кутилган қолдиқлар сақланмаган (dry-run бўлиши мумкин)');
    }

    // actual client balances = CURRENT ledger truth
    const balances = await this.ledger.clientBalances();

    // actual pallet balances (same formula as PalletService.combineClientSums)
    const palletRows = await this.prisma.palletTransaction.groupBy({
      by: ['clientId', 'type'],
      where: { clientId: { not: null } },
      _sum: { qty: true },
    });
    const palletByClient = new Map<string, number>();
    for (const r of palletRows) {
      if (!r.clientId) continue;
      const qty = r._sum.qty ?? 0;
      const sign =
        r.type === PalletTransactionType.DELIVERED_TO_CLIENT
          ? 1
          : r.type === PalletTransactionType.RETURNED_BY_CLIENT || r.type === PalletTransactionType.CHARGED_LOST
            ? -1
            : r.type === PalletTransactionType.ADJUSTMENT || r.type === PalletTransactionType.REVERSAL
              ? 1
              : 0;
      palletByClient.set(r.clientId, (palletByClient.get(r.clientId) ?? 0) + sign * qty);
    }

    const clients = stats.expected.clients.map((c) => {
      const expected = D(c.expectedBalance);
      const actual = balances.get(c.clientId) ?? ZERO;
      const diff = actual.minus(expected);
      const ok = diff.abs().lt(1);
      const actualPallets = palletByClient.get(c.clientId) ?? 0;
      const palletsOk = actualPallets === c.expectedPallets;
      // a strict mismatch may be fully explained by the workbook's own staleness
      // (trucks present in Товар but never copied to the client sheet, and vice
      // versa — excel-spec §6 фарк(goods); §10.4 Уткир мини)
      const adjusted = c.sheetGaps ? D(c.sheetGaps.adjustedExpectedBalance) : null;
      const explained = !ok && adjusted !== null && actual.minus(adjusted).abs().lt(1);
      const palletsExplained =
        !palletsOk && c.sheetGaps !== undefined && actualPallets === c.sheetGaps.adjustedExpectedPallets;
      return {
        name: c.name,
        clientId: c.clientId,
        sheetless: c.sheetless,
        expectedBalance: expected.toFixed(2),
        actualBalance: actual.toFixed(2),
        diff: diff.toFixed(2),
        ok,
        expectedPallets: c.expectedPallets,
        actualPallets,
        palletsOk,
        ...(c.sheetGaps
          ? { sheetGaps: c.sheetGaps, explainedByWorkbookDefect: explained, palletsExplainedByWorkbookDefect: palletsExplained }
          : {}),
      };
    });

    const factoryExpected = D(stats.expected.factoryExpected);
    const factoryActual = await this.ledger.factoryBalance(stats.expected.factoryId);
    const factory = {
      factoryId: stats.expected.factoryId,
      expected: factoryExpected.toFixed(2),
      actual: factoryActual.toFixed(2),
      diff: factoryActual.minus(factoryExpected).toFixed(2),
      ok: factoryActual.minus(factoryExpected).abs().lt(1),
    };

    const flaggedPayments = (
      await this.prisma.payment.findMany({
        where: { importBatchId: batchId, reconciled: false, voidedAt: null },
        include: { client: { select: { id: true, name: true } } },
        orderBy: { date: 'asc' },
      })
    ).map((p) => ({
      id: p.id,
      date: p.date,
      client: p.client?.name ?? null,
      amount: D(p.amount).toFixed(2),
      method: p.method,
      payerName: p.payerName,
      note: p.note,
    }));

    const mismatched = clients.filter((c) => !c.ok).map((c) => c.name);
    const palletsMismatched = clients.filter((c) => !c.palletsOk).map((c) => c.name);
    const unexplained = clients
      .filter((c) => !c.ok && !(c as { explainedByWorkbookDefect?: boolean }).explainedByWorkbookDefect)
      .map((c) => c.name);
    const palletsUnexplained = clients
      .filter((c) => !c.palletsOk && !(c as { palletsExplainedByWorkbookDefect?: boolean }).palletsExplainedByWorkbookDefect)
      .map((c) => c.name);
    return {
      clients,
      factory,
      flaggedPayments,
      summary: {
        clientsTotal: clients.length,
        clientsOk: clients.filter((c) => c.ok).length,
        mismatched,
        palletsMismatched,
        // mismatches NOT accounted for by the workbook's own sheet staleness —
        // anything here means the IMPORT itself is wrong
        unexplained,
        palletsUnexplained,
        factoryOk: factory.ok,
        flaggedCount: flaggedPayments.length,
        flaggedTotal: flaggedPayments.reduce((a, p) => a.plus(D(p.amount)), ZERO).toFixed(2),
      },
    };
  }

  // ─────────────────────────── DELETE /import/batches/:id ───────────────────────────

  /** Pre-go-live rollback: hard-deletes every row carrying this importBatchId (FK-safe order). */
  async rollback(batchId: string, confirm: boolean, user: RequestUser) {
    if (confirm !== true) {
      throw new BadRequestException('Тасдиқлаш учун body да {"confirm": true} юборинг');
    }
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Импорт партияси топилмади');

      const orderIds = (
        await tx.order.findMany({ where: { importBatchId: batchId }, select: { id: true } })
      ).map((o) => o.id);
      const paymentIds = (
        await tx.payment.findMany({ where: { importBatchId: batchId }, select: { id: true } })
      ).map((p) => p.id);

      const deleted: Record<string, number> = {};
      deleted.cashTransactions = (
        await tx.cashTransaction.deleteMany({
          where: { OR: [{ importBatchId: batchId }, { paymentId: { in: paymentIds } }] },
        })
      ).count;
      deleted.ledgerEntries = (
        await tx.ledgerEntry.deleteMany({
          where: {
            OR: [
              { importBatchId: batchId },
              { orderId: { in: orderIds } },
              { paymentId: { in: paymentIds } },
            ],
          },
        })
      ).count;
      deleted.palletTransactions = (
        await tx.palletTransaction.deleteMany({
          where: { OR: [{ importBatchId: batchId }, { orderId: { in: orderIds } }] },
        })
      ).count;
      deleted.bonusTransactions = (
        await tx.bonusTransaction.deleteMany({
          where: { OR: [{ orderId: { in: orderIds } }, { paymentId: { in: paymentIds } }] },
        })
      ).count;
      deleted.paymentAllocations = (
        await tx.paymentAllocation.deleteMany({
          where: { OR: [{ paymentId: { in: paymentIds } }, { orderId: { in: orderIds } }] },
        })
      ).count;
      deleted.payments = (await tx.payment.deleteMany({ where: { importBatchId: batchId } })).count;
      // order children (items, status history, comments) cascade on order delete
      deleted.orders = (await tx.order.deleteMany({ where: { importBatchId: batchId } })).count;
      deleted.expenses = (await tx.expense.deleteMany({ where: { importBatchId: batchId } })).count;
      await tx.importBatch.delete({ where: { id: batchId } });

      await this.audit.log({
        tx,
        userId: user.userId,
        action: AuditAction.DELETE,
        entity: 'ImportBatch',
        entityId: batchId,
        before: plainJson({ filename: batch.filename, createdAt: batch.createdAt }),
        after: plainJson({ deleted }),
        note: `Import rollback: ${batch.filename}`,
      });

      return { batchId, deleted };
    }, TX_OPTS);
  }
}
