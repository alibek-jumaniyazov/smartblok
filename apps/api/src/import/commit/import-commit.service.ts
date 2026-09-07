import {
  Prisma, PrismaClient, BonusProgramKind, BonusTransactionType, FactoryBucket, FactoryPayIntent,
  LedgerAccount, LedgerSource, OrderStatus, CostStatus, PriceKind,
  TransportMode, TransportPaidStatus, PaymentKind, PaymentMethod, PalletTransactionType,
  CashboxType, CashDirection, CashSource,
} from '@prisma/client';
import type {
  ClientPaymentRow, FactoryPalletReturnRow, FactoryPaymentRow, PalletReturnRow, RowOrigin,
  ShipmentRow,
} from '../parse/types';
import { normalizePlate, normalizeSize } from '../resolve/entity-resolver';
import { findFleetVehicleByPlate, plateKey } from '../../common/plate';

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

/**
 * ══════════════ COMMIT — SHABLON v5 ══════════════
 *
 * Bu yagona joy: staging’dan tirik jadvallarga BITTA tranzaksiyada ko'chiriladi.
 *
 * ┌ SHABLON v5 NIMANI O'ZGARTIRDI ┐
 * 1. ZAVOD BITTA EMAS. Eski faylda bitta «Газоблок» bor edi; yangisida «Коалс» va «Ментора»
 *    — har biri O'Z hisobi, o'z qarzi, o'z paddon qoldig'i bilan. Shuning uchun zavod endi
 *    qatordan olinadi, kirishdagi bitta nomdan emas.
 * 2. TRANSPORTNI KIM TO'LAGANI ENDI AYTILGAN. «Расход Авто» ustuni «Клиент» yoki «Сотувчи»
 *    deydi, «Мижозга» ustuni esa natijani ko'rsatadi: T = Сумма Продажа − (Клиент ? Авто : 0).
 *    Bu loyihadagi `clientChargeable` formulasining AYNAN o'zi — ya'ni taxmin qiladigan narsa
 *    qolmadi (eski import hammasini DEALER_ABSORBED deb yozishga majbur edi).
 * 3. TO'LOV USULI ENDI TAXMIN QILINMAYDI. «Оплата» varag'ida har kanal o'z ustunida
 *    (ПР-Сумма · Накд · Клик · Терминал), erkin matndan kanal chamalash yo'q.
 * 4. PADDON PULI ALOHIDA. To'lovning bir qismi paddon uchun bo'lishi mumkin («Поддон» dona ×
 *    «Поддон нархи»), qolgani mol uchun («Товарга»). Faqat MOL qismi buyurtmalarni yopadi.
 * 5. PADDON HARAKATLARI O'Z VARAG'IDA: mijozdan qaytgani va zavodga qaytarilgani.
 *
 * ┌ ZAVOD PADDONI — PULSIZ (egasining qarori, 2026-09-04) ┐
 * Yangi Excel zavod paddonini PUL deb hisoblaydi («ЖАМИ ОЛИНГАН» ichida 960 960 000 bor) va
 * qaytarilganini 130 000 dan qaytaradi. Egasi buni SO'RALGANDA rad etdi va 2026-07-23 dagi
 * qoidani saqlab qoldi: zavod tomonida paddon faqat DONA bo'lib yuradi, hech qachon pulga
 * aylanmaydi (bazadagi `pallet_factory_return_moneyless` CHECK shuni ushlab turadi).
 *
 * Demak zavod QARZI = faqat BLOK puli. Excel’ning zavod qoldig'i (−629 881 630) bilan
 * saytniki (−129 249 630) farq qiladi va bu farq TASODIF EMAS, u aniq izohlanadi:
 *     paddon puli 960 960 000 − qaytarilgani 440 960 000 − qaytarish harajati 19 368 000
 *     = 500 632 000
 * Shu sabab preview `palletMoneyGap` ni ALOHIDA chiqaradi: egasi ikkita raqamni yonma-yon
 * ko'rib, farq qayerdan kelganini bir qarashda biladi.
 */

/**
 * Poddon hajmi normallashtirilgan «600x300x250» o'lchamidan. Standart poddon ×250 blokda
 * 1.8 m³, ×200 da 1.728 m³. Import paytida yoziladi — buyurtma formasidagi poddon↔m³
 * o'girishi birinchi qatordan to'g'ri ishlashi uchun.
 */
function m3PerPalletForSize(size: string): Prisma.Decimal {
  const thickness = /x(\d{2,3})$/.exec(size)?.[1];
  return new D(thickness === '250' ? '1.8' : '1.728');
}

// ─────────── kanal so'zlari → PaymentMethod ───────────
//
// Yangi shablonda kanal ERKIN MATN emas: «Тўлов тури» справочниги atigi ikki qiymatni
// biladi («Касса», «Перечисления»), «Оплата» varag'ida esa har kanal O'Z USTUNIDA turadi.
// Shuning uchun bu yerda klassifikator emas, oddiy lug'at bor — va tanilmagan so'z JIMGINA
// «bank» bo'lib ketmaydi, `null` qaytadi va qoidalar qatlami uni to'siq qilib ko'rsatadi.

const CHANNEL_WORDS: Array<{ test: RegExp; method: PaymentMethod }> = [
  { test: /^(касса|kassa|нахт|naxt|naqd|нақд)$/i, method: PaymentMethod.CASH },
  { test: /^(перечисления|перечисление|переч|bank|банк|o.?tkazma|ўтказма|утказма)$/i, method: PaymentMethod.BANK },
  { test: /^(клик|click)$/i, method: PaymentMethod.CLICK },
  { test: /^(терминал|terminal)$/i, method: PaymentMethod.TERMINAL },
];

/** «Касса» / «Перечисления» → usul. Tanilmasa `null` (qoidalar qatlami to'sadi). */
export function classifyChannel(word: string): PaymentMethod | null {
  const w = (word ?? '').trim();
  if (!w) return null;
  return CHANNEL_WORDS.find((c) => c.test.test(w))?.method ?? null;
}

/** To'lov usuli → zavod oldidagi niyat (naqd mol arzon — tannarx kitobi ham shundan). */
export function payIntentFor(method: PaymentMethod): FactoryPayIntent {
  return method === PaymentMethod.CASH || method === PaymentMethod.CLICK
    ? FactoryPayIntent.CASH
    : FactoryPayIntent.BANK;
}

/** To'lov usuli → zavoddagi avans cho'ntagi. */
function advanceBucketFor(method: PaymentMethod): FactoryBucket {
  return method === PaymentMethod.CASH || method === PaymentMethod.CLICK
    ? FactoryBucket.ADVANCE_CASH
    : FactoryBucket.ADVANCE_BANK;
}

const CASH_TYPE_FOR_METHOD: Partial<Record<PaymentMethod, CashboxType>> = {
  [PaymentMethod.CASH]: CashboxType.CASH,
  [PaymentMethod.BANK]: CashboxType.BANK,
  [PaymentMethod.CLICK]: CashboxType.CLICK,
  [PaymentMethod.TERMINAL]: CashboxType.TERMINAL,
  [PaymentMethod.CARD]: CashboxType.CARD,
};
const CASHBOX_DEFAULT_NAME: Record<CashboxType, string> = {
  [CashboxType.CASH]: 'Naqd kassa',
  [CashboxType.BANK]: 'Bank hisobi',
  [CashboxType.CLICK]: 'Click',
  [CashboxType.TERMINAL]: 'Terminal',
  [CashboxType.CARD]: 'Karta',
};

const PALLET_RETURN_EXPENSE = 'Paddon qaytarish harajati';

// ─────────────────────────── natija ───────────────────────────

export interface PreviewResult {
  orders: number;

  // ── zavodlar (har biri alohida — yangi shablonda ikkitasi bor) ──
  factories: Array<{
    name: string;
    /** Σ ORDER_COST — olingan BLOK puli (paddon naturada, izohga qarang) */
    goodsTaken: string;
    /** Σ FACTORY_OUT — zavodga to'langan */
    paid: string;
    /** to'langan − olingan (>0 zavodda pulimiz turibdi · <0 qarzdormiz) */
    balance: string;
    /** olingan paddon − qaytarilgan paddon (DONA) */
    palletsOwed: number;
    palletsReceived: number;
    palletsReturned: number;
  }>;
  factoryBalance: string; // hamma zavod bo'yicha yig'indi
  factoryGoodsTaken: string;
  factoryTransferred: string;
  factorySettled: string;
  factoryOrdersSettled: number;
  factoryOrdersPartial: number;
  factoryOrdersUnpaid: number;
  factoryPayable: string;
  factoryAdvanceBank: string;
  factoryAdvanceCash: string;
  factoryByChannel: Array<{ channel: 'naqd' | "o'tkazma"; orders: number; goods: string; paid: string; debt: string }>;

  /**
   * EXCEL BILAN FARQ — zavod paddoni puli. Excel uni zavod qarziga qo'shadi, sayt esa
   * naturada sanaydi (egasining qarori). Farq shu yerda ATAYLAB ochiq turadi:
   *   paddon puli − qaytarilgani × narx − qaytarish harajati
   * Yashirilsa, egasi ikki raqamni solishtirib «sayt yolg'on gapiryapti» degan bo'lardi.
   */
  palletMoneyGap: {
    takenMoney: string; // Σ (paddon dona × narx) — Excel «Сумма Поддон»
    returnedMoney: string; // Σ (zavodga qaytarilgan × narx)
    returnExpense: string; // Σ «Қайтариш харажати жами»
    gap: string; // Excel qoldig'i − sayt qoldig'i
  };

  // ── mijozlar ──
  clientDebtTotal: string; // Σ CLIENT ledger — >0 mijozlar qarzdor
  saleTotal: string; // Σ ORDER_SALE
  clientDirectTransport: string; // Σ TRANSPORT_CLIENT_DIRECT (mijoz shofyorga bergani)
  clientChargeable: string; // sotuv − shofyor ulushi = Excel «Мижозга»
  clientPaidTotal: string; // Σ CLIENT_IN (paddon puli bilan birga)
  clientPaidGoods: string; // shundan MOL uchun (Excel «Товарга»)
  clientPaidPallets: string; // shundan PADDON uchun (Excel «Поддон пули»)
  allocatedToOrders: string;
  ordersFullyPaid: number;
  clientAdvanceLeft: string;

  // ── paddon (DONA) ──
  pallets: {
    delivered: number; // mijozlarga berilgan
    returnedByClients: number; // mijozlardan qaytgan
    paidByClients: number; // mijoz puli bilan yopilgan (dona)
    clientDebt: number; // mijozlarda qolgan = berilgan − qaytgan − to'langan
    returnedToFactory: number; // zavodga qaytarilgan
    dealerInHand: number; // bizning omborda
  };

  costTotal: string;
  vehicleBalance: string;
  transportSettled: string;

  // ── kassa ──
  cashIn: string;
  cashOut: string;
  cashCapital: string;
  cashboxes: Array<{ name: string; type: CashboxType; in: string; out: string; capital: string; balance: string }>;

  /** import qilinmagan, lekin sanab berilgan qatorlar */
  skipped: Array<{ sheet: string; row: number; why: string }>;
}

export class DryRunRollback extends Error {
  constructor(public readonly result: PreviewResult) {
    super('dry-run');
  }
}

export interface CommitInput {
  batchId: string;
  filename?: string;
  shipments: ShipmentRow[];
  clientPayments: ClientPaymentRow[];
  factoryPayments: FactoryPaymentRow[];
  palletReturns: PalletReturnRow[];
  factoryPalletReturns: FactoryPalletReturnRow[];
  /** справочник: mijozning RASMIY nomi (owner tuzatishlari qo'llanган) */
  resolveClient: (rawName: string, origin: RowOrigin) => string;
  /** справочник: mijozga biriktirilgan agent */
  agentForClient: (clientName: string) => string | null;
  /** справочник: zavod nomi («Коалс»/«Ментора») */
  resolveFactory: (rawName: string) => string;
  /** справочник: agent nomi */
  resolveAgent: (rawName: string) => string | null;
  /** «Поддон базавий нархи» — to'lovda paddon narxi yozilmagan bo'lsa shu ishlatiladi */
  palletBasePrice: Prisma.Decimal;
  createdById?: string | null;
  wipeFirst?: boolean;
}

const TX_OPTS = { maxWait: 15_000, timeout: 180_000 } as const;

/**
 * Bitta buyurtma uchun bonus. Tirik yo'l (`BonusService.accrueForOrder`) bilan bir xil qoida:
 * buyurtma COMPLETED bo'lib tug'iladi, bonus o'shanda yoziladi. Nest provideri emas, oddiy
 * funksiya — `runCommit` ham shunday.
 *
 * PERCENT bazasi faqat BLOK puli (paddon puli hech qachon kirmaydi) — bonus.service bilan bir xil.
 */
async function accrueBonus(
  tx: Tx,
  p: { orderId: string; factoryId: string; at: Date; m3: Prisma.Decimal; costTotal: Prisma.Decimal; by: string | null },
): Promise<void> {
  const program = await tx.bonusProgram.findFirst({
    where: { factoryId: p.factoryId, effectiveFrom: { lte: p.at } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!program || program.kind === BonusProgramKind.NONE) return;

  let amount: Prisma.Decimal;
  let baseAmount: Prisma.Decimal | null = null;
  let baseM3: Prisma.Decimal | null = null;
  if (program.kind === BonusProgramKind.PER_M3) {
    baseM3 = p.m3.toDP(3);
    amount = baseM3.mul(program.ratePerM3 ?? 0).toDP(2);
  } else {
    baseAmount = p.costTotal; // BLOK puli — paddon puli hech qachon bazaga kirmaydi
    amount = baseAmount.mul(program.percent ?? 0).div(100).toDP(2);
  }
  if (amount.lte(0)) return;

  await tx.bonusTransaction.create({
    data: {
      factoryId: p.factoryId, orderId: p.orderId, programId: program.id,
      type: BonusTransactionType.ACCRUAL, amount, baseAmount, baseM3, createdById: p.by,
    },
  });
}

async function nextOrderSeq(tx: Tx): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('order_no_seq')`;
  return Number(row.nextval);
}

export async function runCommit(
  prisma: PrismaClient,
  input: CommitInput,
  opts: { dryRun: boolean },
): Promise<PreviewResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const result = await commitInner(tx, input, opts.dryRun);
      if (opts.dryRun) throw new DryRunRollback(result);
      return result;
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof DryRunRollback) return e.result;
    throw e;
  }
}

async function commitInner(tx: Tx, input: CommitInput, dryRun: boolean): Promise<PreviewResult> {
  const { batchId, shipments, clientPayments, factoryPayments, palletReturns, factoryPalletReturns } = input;
  const by = input.createdById ?? null;
  const skipped: PreviewResult['skipped'] = [];
  const skip = (o: RowOrigin, why: string) => skipped.push({ sheet: o.sheetName, row: o.excelRow, why });

  await tx.importBatch.upsert({
    where: { id: batchId },
    update: {},
    create: { id: batchId, filename: input.filename ?? 'import', status: 'COMMITTING' },
  });

  // REPLACE: butun tirik ma'lumot AVVAL o'chiriladi — qayta yozish bilan BIR tranzaksiyada,
  // ya'ni yarim yo'lda yiqilsa o'chirish ham qaytariladi. AGENT foydalanuvchilarining agent
  // NOMI o'chirishdan oldin olinadi va keyin xuddi shu nomli yangi agentga qayta ulanadi
  // (aks holda AGENT foydalanuvchisi hamma agentning ma'lumotini ko'rib qolardi).
  const userAgentLinks = input.wipeFirst
    ? await tx.$queryRaw<Array<{ userId: string; agentName: string }>>`
        SELECT u.id AS "userId", a.name AS "agentName" FROM "User" u JOIN "Agent" a ON a.id = u."agentId"`
    : [];
  if (input.wipeFirst) await wipeAllBusinessData(tx, batchId);

  // ─────────────────────── Pass A: katalog ───────────────────────

  const factoryIdByName = new Map<string, string>();
  const ensureFactory = async (name: string): Promise<string> => {
    const n = name.trim() || 'Nomaʼlum zavod';
    const cached = factoryIdByName.get(n);
    if (cached) return cached;
    const f = await tx.factory.upsert({ where: { name: n }, update: {}, create: { name: n } });
    factoryIdByName.set(n, f.id);
    return f.id;
  };

  const agentIdByName = new Map<string, string>();
  const ensureAgent = async (name: string): Promise<string> => {
    const cached = agentIdByName.get(name);
    if (cached) return cached;
    const a = await tx.agent.upsert({ where: { name }, update: {}, create: { name } });
    agentIdByName.set(name, a.id);
    return a.id;
  };

  const clientIdByName = new Map<string, string>();
  const clientAgentId = new Map<string, string | null>();
  const ensureClient = async (name: string): Promise<string> => {
    const cached = clientIdByName.get(name);
    if (cached) return cached;
    const agentName = input.agentForClient(name);
    const agentId = agentName ? await ensureAgent(agentName) : null;
    const c = await tx.client.upsert({ where: { name }, update: {}, create: { name, agentId } });
    // mavjud mijozda agent bo'sh bo'lsa to'ldiramiz, lekin qo'lda qo'yilganini BOSMAYMIZ
    if (agentId && !c.agentId) await tx.client.update({ where: { id: c.id }, data: { agentId } });
    clientIdByName.set(name, c.id);
    clientAgentId.set(name, c.agentId ?? agentId);
    return c.id;
  };

  // Mahsulot ZAVODGA tegishli (Product.factoryId), shuning uchun kalit «zavod + o'lcham».
  // Ikki zavodda bir xil o'lcham bo'lsa, ular IKKI mahsulot — narx kitobi ham alohida.
  const productIdByKey = new Map<string, string>();
  const ensureProduct = async (factoryId: string, size: string): Promise<string> => {
    const name = normalizeSize(size) || 'noma’lum';
    const key = `${factoryId}|${name}`;
    const cached = productIdByKey.get(key);
    if (cached) return cached;
    const p = await tx.product.upsert({
      where: { factoryId_name: { factoryId, name } },
      update: {},
      create: { factoryId, name, size: name, m3PerPallet: m3PerPalletForSize(name) },
    });
    productIdByKey.set(key, p.id);
    return p.id;
  };

  /**
   * Narx kitobi yuk qatorlaridan tiklanadi. Usiz katalogda kuchdagi narx bo'lmaydi va
   * importdan keyin qo'lda kiritilgan HAR BIR buyurtma «narxi kiritilmagan» deb yiqiladi.
   * Bir kunda bitta mahsulot bir necha narxda kelishi mumkin, shuning uchun kunning
   * G'OLIB narxi — eng ko'p uchragani (teng bo'lsa QIMMATROG'I: zavod qarzini kam
   * ko'rsatmaslik tomonga og'ish).
   */
  const priceVotes = new Map<string, { productId: string; kind: PriceKind; at: Date; counts: Map<string, number> }>();
  const observePrice = (pid: string, kind: PriceKind, price: Prisma.Decimal | null | undefined, at: Date) => {
    if (!price || !price.isFinite() || price.lte(0)) return;
    const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    const key = `${pid}|${kind}|${day.toISOString()}`;
    const slot = priceVotes.get(key) ?? { productId: pid, kind, at: day, counts: new Map<string, number>() };
    const v = price.toDP(6).toString();
    slot.counts.set(v, (slot.counts.get(v) ?? 0) + 1);
    priceVotes.set(key, slot);
  };
  const winningPrice = (counts: Map<string, number>): Prisma.Decimal =>
    new D([...counts].sort((a, b) => b[1] - a[1] || new D(b[0]).comparedTo(new D(a[0])))[0][0]);

  const vehicleIdByKey = new Map<string, string>();
  const ensureVehicle = async (plateRaw: string): Promise<string | null> => {
    const plate = normalizePlate(plateRaw);
    if (!plate) return null;
    const key = plateKey(plate);
    const cached = vehicleIdByKey.get(key);
    if (cached) return cached;
    const found = await findFleetVehicleByPlate(tx, plate);
    const id = found?.id ?? (await tx.vehicle.create({ data: { name: plate, plate } })).id;
    vehicleIdByKey.set(key, id);
    return id;
  };

  const postLedger = (
    account: LedgerAccount,
    source: LedgerSource,
    amount: Prisma.Decimal,
    party: { clientId?: string; factoryId?: string; vehicleId?: string },
    opts: {
      orderId?: string; paymentId?: string; date?: Date;
      factoryBucket?: FactoryBucket; allocationId?: string; palletTransactionId?: string; note?: string;
    } = {},
  ) =>
    tx.ledgerEntry.create({
      data: {
        date: opts.date ?? new Date(0),
        account, source, amount,
        factoryBucket: account === LedgerAccount.FACTORY ? (opts.factoryBucket ?? FactoryBucket.PAYABLE) : null,
        clientId: party.clientId ?? null,
        factoryId: party.factoryId ?? null,
        vehicleId: party.vehicleId ?? null,
        orderId: opts.orderId ?? null,
        paymentId: opts.paymentId ?? null,
        allocationId: opts.allocationId ?? null,
        palletTransactionId: opts.palletTransactionId ?? null,
        note: opts.note ?? null,
        importBatchId: batchId,
        createdById: by,
      },
    });

  const cashboxByType = new Map<CashboxType, string>();
  const ensureCashbox = async (method: PaymentMethod): Promise<string> => {
    const type = CASH_TYPE_FOR_METHOD[method] ?? CashboxType.CASH;
    const cached = cashboxByType.get(type);
    if (cached) return cached;
    const existing = await tx.cashbox.findFirst({
      where: { type, currency: 'UZS', active: true },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
    });
    const box = existing ?? (await tx.cashbox.create({ data: { name: CASHBOX_DEFAULT_NAME[type], type, currency: 'UZS' } }));
    cashboxByType.set(type, box.id);
    return box.id;
  };
  const writeCash = (
    cashboxId: string, direction: CashDirection, amount: Prisma.Decimal, date: Date,
    link: { paymentId?: string; expenseId?: string }, note?: string,
  ) =>
    tx.cashTransaction.create({
      data: {
        cashboxId, date, direction, amount: amount.toDP(2),
        source: link.expenseId ? CashSource.EXPENSE : CashSource.PAYMENT,
        paymentId: link.paymentId ?? null, expenseId: link.expenseId ?? null,
        importBatchId: batchId,
        note: [note?.trim(), 'Excel import'].filter(Boolean).join(' · '),
        createdById: by,
      },
    });

  // ─────────────── Pass B: «Товар» → buyurtma ───────────────

  let n = 0;
  /** mijoz nomi → shu importda unga berilgan paddon (qaytarish chegarasi uchun) */
  const palletsDeliveredTo = new Map<string, number>();
  /** mijoz nomi → buyurtmalari (Pass C2 FIFO shular bo'ylab yuradi) */
  const ordersOf = new Map<string, Array<{ id: string; date: Date; seq: number; chargeable: Prisma.Decimal; settled: Prisma.Decimal }>>();
  /** har buyurtmaning zavod oldidagi qarzi — Pass C3 shularni yopadi */
  const supply: Array<{
    id: string; itemId: string; factoryId: string; date: Date;
    cost: Prisma.Decimal; costPerM3: Prisma.Decimal; bucket: FactoryBucket; priceKind: PriceKind;
  }> = [];
  let clientDirectTransportTotal = new D(0);
  let transportSettledTotal = new D(0);

  for (const r of shipments) {
    const cName = input.resolveClient(r.clientRaw, r.origin);
    const cid = await ensureClient(cName);
    const factoryId = await ensureFactory(input.resolveFactory(r.factoryRaw));
    const pid = await ensureProduct(factoryId, r.size);
    const vid = r.truck ? await ensureVehicle(r.truck) : null;
    const date = r.date ?? new Date(0);

    const m3 = new D(String(r.cube ?? 0));
    const costPrice = r.costPrice ?? new D(0);
    const palletCount = r.palletQty ?? 0;
    const salePrice = r.salePrice ?? new D(0);

    // Faylning O'Z formulalari takrorlanadi, keshlangan natija ko'chirilmaydi: keshi
    // eskirgan katak (Excel qayta hisoblamagan) jimgina yolg'on raqam olib kirardi.
    const saleTotal = m3.mul(salePrice).toDP(2);
    const costTotal = m3.mul(costPrice).toDP(2); // BLOK puli — paddon naturada (izohga qarang)
    const transportCost = (r.transportCost ?? new D(0)).toDP(2);

    /**
     * «Расход Авто» → transport rejimi. Bu loyihadagi `clientChargeable` ni AYNAN Excel
     * «Мижозга» ustuniga tenglashtiradi:
     *   «Клиент»  → CLIENT_PAYS_DRIVER → mijozdan so'raladigan summa = sotuv − transport
     *   «Сотувчи» → DEALER_ABSORBED    → mijozdan so'raladigan summa = sotuv
     */
    const clientPaysDriver = /^клиент$/i.test(r.transportPayerRaw.trim());
    const transportMode = clientPaysDriver ? TransportMode.CLIENT_PAYS_DRIVER : TransportMode.DEALER_ABSORBED;
    const directTransport = clientPaysDriver ? D.min(transportCost, saleTotal) : new D(0);

    const payMethod = classifyChannel(r.factoryPayChannel) ?? PaymentMethod.BANK;
    const payIntent = payIntentFor(payMethod);
    const costKind = payIntent === FactoryPayIntent.CASH ? PriceKind.FACTORY_CASH : PriceKind.FACTORY_BANK;

    observePrice(pid, PriceKind.DEALER_SALE, salePrice, date);
    observePrice(pid, costKind, costPrice, date);

    const order = await tx.order.create({
      data: {
        orderNo: dryRun ? `DRY-${String(++n).padStart(6, '0')}` : `ORD-${String(await nextOrderSeq(tx)).padStart(6, '0')}`,
        date, status: OrderStatus.COMPLETED, completedAt: date,
        clientId: cid, factoryId, vehicleId: vid,
        agentId: clientAgentId.get(cName) ?? null,
        saleTotal, costTotal, costStatus: CostStatus.PROVISIONAL,
        factoryPayIntent: payIntent,
        transportMode,
        transportCost, transportCharge: new D(0),
        // Yangi shablon shofyorga to'lov qatorlarini YURITMAYDI — u faqat xarajat sonini
        // beradi. Shuning uchun transport HAR IKKALA rejimda ham yopilgan deb yoziladi
        // (pastda to'lov qatori bilan), aks holda daftar ko'rmagan «shofyorlarga qarz»
        // ekranda o'zidan paydo bo'lardi.
        transportPaidStatus: transportCost.gt(0)
          ? (clientPaysDriver ? TransportPaidStatus.PAID_BY_CLIENT : TransportPaidStatus.PAID)
          : TransportPaidStatus.NOT_APPLICABLE,
        note: `Excel «${r.origin.sheetName}» r${r.origin.excelRow}`,
        importBatchId: batchId, createdById: by,
        items: {
          create: [{
            // palletPrice 0 — paddon zavod tomonida NATURADA (egasining qarori, 2026-09-04):
            // narx qo'yilsa `recomputeOrderCost` uni tannarxga qayta qo'shib yuborardi.
            productId: pid, quantityM3: m3.toDP(3), palletCount, palletPrice: new D(0),
            salePricePerM3: salePrice.toDP(6), saleTotal,
            provisionalPriceKind: costKind,
            costPricePerM3: costPrice.toDP(6), costTotal,
          }],
        },
      },
      include: { items: { select: { id: true } } },
    });

    if (costTotal.gt(0)) {
      supply.push({
        id: order.id, itemId: order.items[0].id, factoryId, date,
        cost: costTotal, costPerM3: costPrice.toDP(6),
        bucket: advanceBucketFor(payMethod), priceKind: costKind,
      });
    }

    await tx.orderStatusHistory.create({
      data: { orderId: order.id, from: null, to: OrderStatus.COMPLETED, byId: by, note: 'Excel import' },
    });

    // ── MIJOZ: to'liq sotuv + (kerak bo'lsa) shofyor ulushi ──
    // Ikki qator ataylab: buyurtma «Savdo 22 000 000» bo'lib o'qilishi kerak, mijoz
    // hisobvarag'i esa NEGA 20 000 000 qolganini ko'rsatishi shart. Tirik yo'l
    // (`postOrderClientLedger`) aynan shunday yozadi.
    if (saleTotal.gt(0)) {
      await postLedger(LedgerAccount.CLIENT, LedgerSource.ORDER_SALE, saleTotal, { clientId: cid }, { orderId: order.id, date });
    }
    if (directTransport.gt(0)) {
      await postLedger(
        LedgerAccount.CLIENT, LedgerSource.TRANSPORT_CLIENT_DIRECT, directTransport.negated(),
        { clientId: cid }, { orderId: order.id, date, note: "Shofyorga mijoz to'laydi (summa ichidan)" },
      );
      clientDirectTransportTotal = clientDirectTransportTotal.plus(directTransport);
    }

    // ── ZAVOD: olingan BLOK puli qarzga ──
    if (costTotal.gt(0)) {
      await postLedger(
        LedgerAccount.FACTORY, LedgerSource.ORDER_COST, costTotal.negated(),
        { factoryId }, { orderId: order.id, date, factoryBucket: FactoryBucket.PAYABLE },
      );
    }

    // ── MASHINA: xarajat va uning yopilishi ──
    if (transportCost.gt(0) && vid) {
      await postLedger(LedgerAccount.VEHICLE, LedgerSource.TRANSPORT_COST, transportCost.negated(), { vehicleId: vid }, { orderId: order.id, date });
      // KASSAGA TEGMAYDI (egasining qoidasi, 2026-07-23): «mijoz transportni o'zi to'lagan
      // deb hisoblaymiz» — pul kassadan o'tmaydi. Lekin TO'LOV qatori yoziladi, chunki
      // `recomputeTransportStatus` holatni FAOL taqsimotlardan hisoblaydi: usiz egasi
      // buyurtmani birinchi marta tahrirlashi bilan «to'lanmagan» ga qaytib qolardi.
      const pay = await tx.payment.create({
        data: {
          date, kind: clientPaysDriver ? PaymentKind.TRANSPORT_DIRECT : PaymentKind.VEHICLE_OUT,
          method: PaymentMethod.CASH, amount: transportCost, vehicleId: vid,
          ...(clientPaysDriver ? { clientId: cid } : {}),
          note: clientPaysDriver ? 'Shofyorga mijoz toʼladi (Excel import)' : 'Shofyorga diller toʼladi (Excel import)',
          importBatchId: batchId, createdById: by,
        },
      });
      await tx.paymentAllocation.create({ data: { paymentId: pay.id, orderId: order.id, amount: transportCost, createdById: by } });
      await postLedger(LedgerAccount.VEHICLE, LedgerSource.PAYMENT, transportCost, { vehicleId: vid }, { orderId: order.id, paymentId: pay.id, date });
      transportSettledTotal = transportSettledTotal.plus(transportCost);
    }

    // ── PADDON: zavoddan olindi va mijozga berildi (DONA) ──
    if (palletCount > 0) {
      await tx.palletTransaction.create({ data: { type: PalletTransactionType.RECEIVED_FROM_FACTORY, factoryId, qty: palletCount, orderId: order.id, date, importBatchId: batchId, createdById: by } });
      await tx.palletTransaction.create({ data: { type: PalletTransactionType.DELIVERED_TO_CLIENT, clientId: cid, qty: palletCount, orderId: order.id, date, importBatchId: batchId, createdById: by } });
      palletsDeliveredTo.set(cName, (palletsDeliveredTo.get(cName) ?? 0) + palletCount);
    }

    await accrueBonus(tx, { orderId: order.id, factoryId, at: date, m3, costTotal, by });

    const chargeable = saleTotal.minus(directTransport);
    const list = ordersOf.get(cName) ?? [];
    list.push({ id: order.id, date, seq: list.length, chargeable, settled: new D(0) });
    ordersOf.set(cName, list);
  }

  // ── Pass B2: narx kitobini yozish ──
  if (priceVotes.size) {
    await tx.productPrice.createMany({
      data: [...priceVotes.values()].map((v) => ({
        productId: v.productId, kind: v.kind, pricePerM3: winningPrice(v.counts), effectiveFrom: v.at,
      })),
      skipDuplicates: true,
    });
  }

  // ─────────── Pass C1: mijozdan qaytgan paddon («Поддон қайтариш») ───────────
  //
  // ALOHIDA VA YUKLARDAN KEYIN: qaytarish mijoz qo'lidagi songa qarab cheklanadi, ya'ni
  // barcha yuklar yozilgan bo'lishi SHART. Aks holda iyul oyidagi qaytarish avgustdagi
  // yukdan oldin ko'rilib, chegaraga urilib qisqarardi.
  /**
   * ┌ IMPORT QISQARTIRMAYDI ┐
   * Tirik amallarda qaytarish/undirish mijoz qo'lidagi songa CHEKLANADI — foydalanuvchi
   * xatosi qoldiqni fizik jihatdan mumkin bo'lmagan holatga tushirmasin deb. IMPORTDA bu
   * chegara QO'YILMAYDI va bu ataylab: importning vazifasi daftarni AYNAN ko'chirish.
   *
   * Etalon faylning O'Z «Текширув» varag'i 7 ta mijozda «ошиқча поддон» borligini aytadi
   * (masalan «Мята Газаблок»: olgani 171, puli to'langani 228). Bu xato emas, DAVR
   * chegarasi: mijoz paddonni fayl boshlanishidan OLDIN olgan, faylda esa boshlang'ich
   * qoldiq ustuni yo'q. Qisqartirilsa, 57 donaning PULI (7 410 000) jimgina yo'qolar va
   * mijozning pul qoldig'i Excel bilan teng chiqmasdi.
   *
   * Shuning uchun qator qanday bo'lsa shunday yoziladi, mijozning DONA qoldig'i esa
   * manfiyga tushishi mumkin — va u PADDON_ORTIQCHA qoidasi bilan nomma-nom ko'rsatiladi.
   * Umumiy yig'indi baribir yopiladi: 7392 − 4036 − 2853 = 503 (faylning o'z raqami).
   */
  const palletsReturnedBy = new Map<string, number>();
  const palletsChargedTo = new Map<string, number>();

  /**
   * ┌ MANFIY QATOR = TUZATISH, «ADJUSTMENT» EMAS ┐
   * Daftarda manfiy son uchraydi: «Поддон қайтариш» da −19 (qaytarish ortiqcha yozilgan),
   * «Оплата» da −71 (paddon puli ortiqcha hisoblangan), «Поддон қайтариш заводга» da −113
   * («БРАК кабул ыилмадилар»). Baza manfiy `qty` ni faqat ADJUSTMENT/REVERSAL turlarida
   * qabul qiladi (`pallet_qty_positive_directional`).
   *
   * ADJUSTMENT bo'lib yozish JIM XATO berardi: u «manbasi ko'rsatilmagan qo'l tuzatishi»
   * degan chelak va uni HECH BIR o'quvchi qaytarishga bog'lay olmaydi — `dealerInHand`
   * (Σ mijoz qaytardi − Σ zavodga qaytardik) uni umuman ko'rmaydi, natijada ombor qoldig'i
   * va konservatsiya tenglamasi (`drift`) shu songa siljib qolardi.
   *
   * Shuning uchun tuzatish AYNAN o'zi tuzatayotgan qatorning STORNOSI bo'lib yoziladi.
   * Storno butun tizimda allaqachon to'g'ri o'qiladi: qoldiq, statistika, ombor zaxirasi va
   * «qaysi buyurtmadan» paneli — hammasi uni asl qatordan ayiradi. Nomzod qatorlar
   * ENG YANGISIDAN boshlab tanlanadi (tuzatish odatda oxirgi yozuvga tegishli).
   */
  const reversedRows = new Set<string>();
  /** tuzatishni yopish uchun nomzodlar (eng yangisidan) — `party` mijoz yoki zavod id'si */
  const candidates = new Map<string, Array<{ id: string; qty: number }>>();
  /** undirish qatori id → uning PUL qatori id'si (storno 1:1 bog'lanishi uchun) */
  const palletChargeLedger = new Map<string, string>();
  const candKey = (type: PalletTransactionType, party: string) => `${type}|${party}`;
  const remember = (type: PalletTransactionType, party: string, id: string, qty: number) => {
    const k = candKey(type, party);
    const list = candidates.get(k) ?? [];
    list.push({ id, qty });
    candidates.set(k, list);
  };

  /**
   * Manfiy tuzatishni yopadi: BUTUN qator stornolanadi, qolgani esa DARHOL qayta yoziladi.
   *
   * ┌ NEGA QISMAN STORNO EMAS ┐
   * «128 ta qaytarishdan 19 tasini olib tashlash» ni qisman storno bilan yozish jozibali
   * ko'rinadi, lekin ikki joyda buziladi:
   *   · bazada «Mijoz qaytardi»/«Undirish» qatori BITTA storno uyasiga ega
   *     (`PalletTransaction_whole_row_reversal_once`), va uni qisman storno band qilib
   *     qo'ysa, importni ORQAGA QAYTARISH ikkinchi storno yoza olmay yiqilardi;
   *   · undirishning PUL tomoni `LedgerEntry.reversalOfId` bilan 1:1 — qisman pul
   *     stornosi umuman ifodalab bo'lmaydigan holat.
   *
   * Butun qatorni stornolab, qoldig'ini yangi qator qilib yozish esa har ikkalasini ham
   * hal qiladi va tizimning HAMMA o'quvchisi (qoldiq, statistika, ombor zaxirasi,
   * «qaysi buyurtmadan» paneli) uni allaqachon to'g'ri o'qiydi — hech qayerda yangi
   * mantiq kerak emas. Ayni shu naqsh buyurtma bekor qilinganda ham ishlatiladi.
   */
  const applyCorrection = async (
    type: PalletTransactionType, party: { clientId?: string; factoryId?: string }, partyId: string,
    amount: number, date: Date, note: string, origin: RowOrigin,
    money?: {
      unitPrice: Prisma.Decimal;
      /** asl qatorning PUL qatori id'si — storno unga bog'lanadi (1:1) */
      ledgerIdOf: (palletRowId: string) => string | undefined;
    },
  ) => {
    let left = amount; // musbat son — qancha «yo'qqa chiqarish» kerak
    const list = candidates.get(candKey(type, partyId)) ?? [];
    for (let i = list.length - 1; i >= 0 && left > 0; i--) {
      const c = list[i];
      if (reversedRows.has(c.id)) continue;

      // 1) BUTUN qatorni stornolash
      const rev = await tx.palletTransaction.create({
        data: {
          // Minus tomondagi turlarni (qaytarish, undirish, zavodga qaytarish) yo'qqa
          // chiqarish balansga MUSBAT ta'sir qiladi — storno qty'si balans deltasi.
          type: PalletTransactionType.REVERSAL, qty: c.qty,
          clientId: party.clientId ?? null, factoryId: party.factoryId ?? null,
          unitPrice: null, reversalOfId: c.id, reversalOfType: type,
          date, note, importBatchId: batchId, createdById: by,
        },
      });
      reversedRows.add(c.id);
      if (money) {
        const src = money.ledgerIdOf(c.id);
        if (src) {
          // PUL tomoni ASL qatorning stornosi bo'lib yoziladi (`reversalOfId`), ya'ni
          // orqaga qaytarishda u ikkinchi marta stornolanmaydi.
          await tx.ledgerEntry.create({
            data: {
              date, account: LedgerAccount.CLIENT, source: LedgerSource.PALLET_CHARGE,
              amount: money.unitPrice.mul(c.qty).toDP(2).negated(),
              clientId: party.clientId ?? null, palletTransactionId: rev.id,
              reversalOfId: src, note: 'Paddon puli qaytarildi', importBatchId: batchId, createdById: by,
            },
          });
        }
      }

      // 2) qoldiqni QAYTA yozish
      const keep = c.qty - Math.min(c.qty, left);
      left -= Math.min(c.qty, left);
      if (keep > 0) {
        const back = await tx.palletTransaction.create({
          data: {
            type, qty: keep,
            clientId: party.clientId ?? null, factoryId: party.factoryId ?? null,
            unitPrice: money ? money.unitPrice.toDP(2) : null,
            date, note: `${note} (qoldig‘i qayta yozildi)`, importBatchId: batchId, createdById: by,
          },
        });
        remember(type, partyId, back.id, keep);
        if (money) {
          const entry = await tx.ledgerEntry.create({
            data: {
              date, account: LedgerAccount.CLIENT, source: LedgerSource.PALLET_CHARGE,
              amount: money.unitPrice.mul(keep).toDP(2),
              clientId: party.clientId ?? null, palletTransactionId: back.id,
              note: 'Paddon puli (qoldig‘i)', importBatchId: batchId, createdById: by,
            },
          });
          palletChargeLedger.set(back.id, entry.id);
        }
      }
    }
    if (left > 0) {
      skip(origin, `${left} dona tuzatish uchun mos qator topilmadi — qo‘lda tuzatish (ADJUSTMENT) bo‘lib yozildi`);
      await tx.palletTransaction.create({
        data: {
          type: PalletTransactionType.ADJUSTMENT, qty: left,
          clientId: party.clientId ?? null, factoryId: party.factoryId ?? null,
          date, note, importBatchId: batchId, createdById: by,
        },
      });
    }
  };

  let palletsReturnedTotal = 0;
  for (const p of palletReturns) {
    const qty = p.qty ?? 0;
    if (qty === 0) continue;
    const cName = input.resolveClient(p.clientRaw, p.origin);
    const cid = await ensureClient(cName);
    const date = p.date ?? new Date(0);
    const note = [p.note, `Excel «${p.origin.sheetName}» r${p.origin.excelRow}`].filter(Boolean).join(' · ');

    if (qty < 0) {
      await applyCorrection(
        PalletTransactionType.RETURNED_BY_CLIENT, { clientId: cid }, cid,
        -qty, date, `Qaytarish tuzatildi · ${note}`, p.origin,
      );
    } else {
      const row = await tx.palletTransaction.create({
        data: { type: PalletTransactionType.RETURNED_BY_CLIENT, clientId: cid, qty, date, note, importBatchId: batchId, createdById: by },
      });
      remember(PalletTransactionType.RETURNED_BY_CLIENT, cid, row.id, qty);
    }
    palletsReturnedBy.set(cName, (palletsReturnedBy.get(cName) ?? 0) + qty);
    palletsReturnedTotal += qty;
  }

  // ─────────── Pass C2: mijoz to'lovlari («Оплата») ───────────

  /** mijoz nomi → buyurtmalarni yopadigan MOL puli (paddon puli bunga kirmaydi) */
  const clientCash = new Map<string, Array<{ id: string; date: Date; seq: number; amount: Prisma.Decimal }>>();
  let clientPaidGoods = new D(0);
  let clientPaidPallets = new D(0);
  let palletsPaidQty = 0;

  for (const p of clientPayments) {
    const cName = input.resolveClient(p.clientRaw, p.origin);
    const cid = await ensureClient(cName);
    const date = p.date ?? new Date(0);
    const agentName = input.resolveAgent(p.agentRaw);
    const agentId = agentName ? await ensureAgent(agentName) : clientAgentId.get(cName) ?? null;

    // ── KANAL: taxmin yo'q, qaysi ustunda pul bo'lsa o'sha ──
    const channels: Array<[PaymentMethod, Prisma.Decimal | null]> = [
      [PaymentMethod.BANK, p.bank],
      [PaymentMethod.CASH, p.cash],
      [PaymentMethod.CLICK, p.click],
      [PaymentMethod.TERMINAL, p.terminal],
    ];
    const used = channels.filter(([, v]) => v && !v.isZero());
    const total = used.reduce((a, [, v]) => a.plus(v as Prisma.Decimal), new D(0)).toDP(2);

    // ── PADDON PULI: mijoz paddonni qaytarmay, PULINI to'ladi ──
    // Loyiha modelida bu AYNAN «yo'qotilganini undirish» (CHARGED_LOST): paddon mijozning
    // dona hisobidan chiqadi va pulga aylanadi. Ikki qator yoziladi — qarz (PALLET_CHARGE)
    // va uni yopadigan to'lov — shuning uchun mijozning PUL balansi o'zgarmaydi, faqat
    // paddon DONASI kamayadi. Excel ham shunday sanaydi: 7392 − 4036 − 2853 = 503.
    const palletQty = p.palletQty ?? 0;
    const palletPrice = p.palletPrice ?? input.palletBasePrice;
    if (palletQty !== 0 && palletPrice.gt(0)) {
      const money = palletPrice.mul(Math.abs(palletQty)).toDP(2);
      if (palletQty > 0) {
        const row = await tx.palletTransaction.create({
          data: {
            type: PalletTransactionType.CHARGED_LOST, clientId: cid, qty: palletQty, date,
            unitPrice: palletPrice.toDP(2),
            note: `Paddon puli toʼlandi · Excel «${p.origin.sheetName}» r${p.origin.excelRow}`,
            importBatchId: batchId, createdById: by,
          },
        });
        const entry = await postLedger(
          LedgerAccount.CLIENT, LedgerSource.PALLET_CHARGE, money,
          { clientId: cid }, { date, palletTransactionId: row.id, note: 'Paddon puli' },
        );
        palletChargeLedger.set(row.id, entry.id);
        remember(PalletTransactionType.CHARGED_LOST, cid, row.id, palletQty);
        palletsChargedTo.set(cName, (palletsChargedTo.get(cName) ?? 0) + palletQty);
        palletsPaidQty += palletQty;
        clientPaidPallets = clientPaidPallets.plus(money);
      } else {
        // MANFIY paddon = undirilgan paddon puli ortiqcha hisoblangan (etalon faylda
        // «Шиддат маналит» r190: −71, izohi «paddon puli astatkasina qoshiladi»).
        // Tuzatish undirishning STORNOSI bo'lib yoziladi va PUL ham o'sha zahoti qaytadi.
        const note = `Paddon puli qaytarildi · Excel «${p.origin.sheetName}» r${p.origin.excelRow}`;
        await applyCorrection(
          PalletTransactionType.CHARGED_LOST, { clientId: cid }, cid,
          -palletQty, date, note, p.origin,
          { unitPrice: palletPrice, ledgerIdOf: (id) => palletChargeLedger.get(id) },
        );
        palletsChargedTo.set(cName, (palletsChargedTo.get(cName) ?? 0) + palletQty);
        palletsPaidQty += palletQty;
        clientPaidPallets = clientPaidPallets.minus(money);
      }
    }

    // «Товарга» = «Жами сумма» − «Поддон пули» — daftarning O'Z formulasi, va u pul
    // BO'LMAGAN qatorda ham ishlaydi: r190 da Жами bo'sh, Поддон пули −9 230 000, demak
    // Товарга +9 230 000. Shu sabab hisoblagich pul yo'qligini tekshirishdan OLDIN
    // yangilanadi — aks holda egasining «Товарга» yig'indisi shu songa kam chiqardi.
    const goodsMoneyRow = total.minus(clientPalletMoneyOf(p, palletPrice)).toDP(2);
    clientPaidGoods = clientPaidGoods.plus(goodsMoneyRow);

    if (total.isZero()) continue;

    // Bir qatorda bir nechta kanal bo'lsa, HAR BIRI o'z to'lovi bo'lib yoziladi: aks holda
    // 18 mln naqd va 24 mln Click bitta «bank» qatoriga qo'shilib, kassa yolg'on ko'rsatardi.
    let goodsLeft = goodsMoneyRow;

    for (const [method, raw] of used) {
      const signed = (raw as Prisma.Decimal).toDP(2);
      const amount = signed.abs();
      const isRefund = signed.isNegative();
      const cashboxId = await ensureCashbox(method);
      const pay = await tx.payment.create({
        data: {
          date, kind: isRefund ? PaymentKind.CLIENT_REFUND : PaymentKind.CLIENT_IN,
          method, amount, clientId: cid, agentId,
          ...(isRefund ? {} : { payerName: p.payer || null }),
          note: [p.payer, p.note, p.receiver].map((s) => s?.trim()).filter(Boolean).join(' · ') || null,
          cashboxId, importBatchId: batchId, createdById: by,
        },
      });
      // imzosi bilan: to'lov mijoz qarzini kamaytiradi, qaytarish esa oshiradi
      await postLedger(LedgerAccount.CLIENT, LedgerSource.PAYMENT, signed.negated(), { clientId: cid }, { paymentId: pay.id, date });
      await writeCash(cashboxId, isRefund ? CashDirection.OUT : CashDirection.IN, amount, date, { paymentId: pay.id }, p.receiver || p.payer);

      // Buyurtmalarni faqat MOL puli yopadi. Paddon puli o'z qarzini (PALLET_CHARGE)
      // yopadi va u buyurtma emas — uni FIFO ga qo'shish buyurtmalarni ortiqcha yopardi.
      if (!isRefund && goodsLeft.gt(0)) {
        const share = D.min(goodsLeft, amount).toDP(2);
        if (share.gt(0)) {
          const q = clientCash.get(cName) ?? [];
          q.push({ id: pay.id, date, seq: q.length, amount: share });
          clientCash.set(cName, q);
          goodsLeft = goodsLeft.minus(share);
        }
      }
    }
  }

  // ─────────── Pass C3: zavodga to'lovlar («Оплата поставшику») ───────────

  /** zavod id → to'lovlar (sarflanmagan qoldig'i bilan) — Pass C4 shulardan yechadi */
  const factoryCash = new Map<string, Array<{ id: string; date: Date; seq: number; free: Prisma.Decimal; bucket: FactoryBucket }>>();
  for (const f of factoryPayments) {
    if (!f.amount || f.amount.isZero()) continue;
    const factoryId = await ensureFactory(input.resolveFactory(f.factoryRaw));
    const method = classifyChannel(f.channel);
    if (method === null) {
      skip(f.origin, `«${f.channel}» toʼlov turi tanilmadi — import qilinmadi`);
      continue;
    }
    const bucket = advanceBucketFor(method);
    const cashboxId = await ensureCashbox(method);
    const refund = f.amount.isNegative();
    const amount = f.amount.abs().toDP(2);
    const date = f.date ?? new Date(0);
    const channelWord = method === PaymentMethod.CASH ? 'naqd' : method === PaymentMethod.CLICK ? 'Click' : 'oʼtkazma';

    const pay = await tx.payment.create({
      data: {
        date, kind: refund ? PaymentKind.FACTORY_REFUND : PaymentKind.FACTORY_OUT,
        method, amount, factoryId,
        receiverName: f.factoryRaw || null,
        note: [`Zavodga ${channelWord}`, f.payer].filter(Boolean).join(' · '),
        cashboxId, importBatchId: batchId, createdById: by,
      },
    });
    // Zavodga berilgan pul AVANS cho'ntagiga tushadi, PAYABLE ga emas: egasi «Олинган» va
    // «Берилган» ustunlarini alohida o'qiydi va avansni sarflash uning ATAYLAB qiladigan
    // ishi (tirik yo'lda ham shunday).
    await postLedger(LedgerAccount.FACTORY, LedgerSource.PAYMENT, f.amount.toDP(2), { factoryId }, { paymentId: pay.id, date, factoryBucket: bucket });
    await writeCash(cashboxId, refund ? CashDirection.IN : CashDirection.OUT, amount, date, { paymentId: pay.id }, `Zavodga ${channelWord}`);
    if (!refund) {
      const q = factoryCash.get(factoryId) ?? [];
      q.push({ id: pay.id, date, seq: q.length, free: amount, bucket });
      factoryCash.set(factoryId, q);
    }
  }

  // ─────────── Pass C4: avans olingan molni yopadi (zavod bo'yicha, FIFO) ───────────
  //
  // Yangi shablonda «Завотга толов» ustuni YO'Q — zavodga to'lov yalpi summa bo'lib
  // yoziladi. Shuning uchun qaysi mashina qaysi pul bilan olingani FIFO bilan taqsimlanadi:
  // eng eski buyurtma eng eski to'lovdan yopiladi. Taqsimot ZAVOD ICHIDA qoladi (Коалс puli
  // Ментора molini yopmaydi) va KANAL izolyatsiyasi saqlanadi (egasining qoidasi,
  // 2026-07-26): naqd buyurtma o'tkazma avansidan yopilmaydi. Aks holda «naqd qarz»
  // degan raqam ekrandan yo'qolardi.
  const settlement = {
    drawn: new D(0), ordersSettled: 0, ordersPartial: 0, ordersUnpaid: 0,
    naqd: { orders: 0, goods: new D(0), paid: new D(0) },
    otkazma: { orders: 0, goods: new D(0), paid: new D(0) },
  };
  {
    const bySupplyOrder = [...supply].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const o of bySupplyOrder) {
      const stat = o.bucket === FactoryBucket.ADVANCE_CASH ? settlement.naqd : settlement.otkazma;
      stat.orders++;
      stat.goods = stat.goods.plus(o.cost);

      const pool = factoryCash.get(o.factoryId) ?? [];
      let left = o.cost;
      let took = new D(0);
      for (const pay of pool) {
        if (left.lte(0)) break;
        if (pay.free.lte(0)) continue;
        if (pay.bucket !== o.bucket) continue; // kanal izolyatsiyasi
        const take = D.min(pay.free, left).toDP(2);
        if (take.lte(0)) continue;
        const alloc = await tx.paymentAllocation.create({
          data: { paymentId: pay.id, orderId: o.id, amount: take, priceKind: o.priceKind, fromAdvance: true, createdById: by },
        });
        // nol yig'indili juftlik: avans cho'ntagidan chiqdi … va shu buyurtmaning qarziga tushdi
        await postLedger(LedgerAccount.FACTORY, LedgerSource.ADVANCE_DRAW, take.negated(), { factoryId: o.factoryId }, { orderId: o.id, paymentId: pay.id, date: o.date, factoryBucket: pay.bucket, allocationId: alloc.id });
        await postLedger(LedgerAccount.FACTORY, LedgerSource.ADVANCE_DRAW, take, { factoryId: o.factoryId }, { orderId: o.id, paymentId: pay.id, date: o.date, factoryBucket: FactoryBucket.PAYABLE, allocationId: alloc.id });
        pay.free = pay.free.minus(take);
        left = left.minus(take);
        took = took.plus(take);
        settlement.drawn = settlement.drawn.plus(take);
      }
      stat.paid = stat.paid.plus(took);
      if (took.lte(0)) { settlement.ordersUnpaid++; continue; }
      if (o.cost.minus(took).lte(new D('0.5'))) {
        settlement.ordersSettled++;
        await tx.orderItem.update({ where: { id: o.itemId }, data: { finalCostPricePerM3: o.costPerM3 } });
        await tx.order.update({ where: { id: o.id }, data: { costStatus: CostStatus.FINAL, costFinalizedAt: o.date } });
      } else {
        settlement.ordersPartial++;
        await tx.order.update({ where: { id: o.id }, data: { costStatus: CostStatus.PARTIAL } });
      }
    }
  }

  // ─────────── Pass C5: zavodga paddon qaytarish + qaytarish harajati ───────────
  let palletsToFactory = 0;
  let returnExpenseTotal = new D(0);
  let expenseCategoryId: string | null = null;
  for (const p of factoryPalletReturns) {
    const qty = p.qty ?? 0;
    const factoryId = await ensureFactory(input.resolveFactory(p.factoryRaw));
    const date = p.date ?? new Date(0);
    const note = [p.note, `Excel «${p.origin.sheetName}» r${p.origin.excelRow}`].filter(Boolean).join(' · ');

    if (qty > 0) {
      // NARXSIZ — `pallet_factory_return_moneyless` CHECK narx qo'yishni RAD etadi va bu
      // egasining qoidasi (2026-07-23, 2026-09-04 da qayta tasdiqlandi): zavod tomonida
      // paddon faqat dona.
      const row = await tx.palletTransaction.create({
        data: { type: PalletTransactionType.RETURNED_TO_FACTORY, factoryId, qty, date, note, importBatchId: batchId, createdById: by },
      });
      remember(PalletTransactionType.RETURNED_TO_FACTORY, factoryId, row.id, qty);
      palletsToFactory += qty;
    } else if (qty < 0) {
      // MANFIY = zavod qabul qilmadi («БРАК кабул ыилмадилар») ⇒ o'sha paddon bizga
      // qaytdi: zavod oldidagi qarz ham, ombor zaxirasi ham shu songa ko'tariladi.
      // Storno bo'lib yoziladi — ADJUSTMENT bo'lsa `dealerInHand` uni ko'rmasdi.
      await applyCorrection(
        PalletTransactionType.RETURNED_TO_FACTORY, { factoryId }, factoryId,
        -qty, date, `Zavod qabul qilmadi · ${note}`, p.origin,
      );
      palletsToFactory += qty;
    }

    // Qaytarish HARAJATI — paddonning narxi emas, uni olib borish puli. Zavod hisobiga
    // tegmaydi (paddon naturada), lekin kassadan HAQIQATAN chiqadi, shuning uchun xarajat
    // bo'lib yoziladi. Yozilmasa, kassa qoldig'i shu summaga yolg'on chiqardi.
    const expense = p.totalCostDeclared ?? (p.unitCost && qty ? p.unitCost.mul(qty) : null);
    if (expense && !expense.isZero()) {
      const method = classifyChannel(p.channel) ?? PaymentMethod.BANK;
      const cashboxId = await ensureCashbox(method);
      if (!expenseCategoryId) {
        const cat = await tx.expenseCategory.upsert({ where: { name: PALLET_RETURN_EXPENSE }, update: {}, create: { name: PALLET_RETURN_EXPENSE } });
        expenseCategoryId = cat.id;
      }
      const amount = expense.abs().toDP(2);
      const row = await tx.expense.create({
        data: { date, categoryId: expenseCategoryId, amount, cashboxId, note, importBatchId: batchId, createdById: by },
      });
      await writeCash(cashboxId, expense.isNegative() ? CashDirection.IN : CashDirection.OUT, amount, date, { expenseId: row.id }, PALLET_RETURN_EXPENSE);
      returnExpenseTotal = returnExpenseTotal.plus(expense);
    }
  }

  // ─────────── Pass D: mijoz puli buyurtmalarni FIFO yopadi ───────────
  const allocation = { placed: new D(0), advanceLeft: new D(0), fullyPaid: 0 };
  for (const [cName, cash] of clientCash) {
    const orders = (ordersOf.get(cName) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);
    const queue = [...cash].sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);
    let cursor = 0;
    for (const pay of queue) {
      let left = pay.amount;
      while (left.gt(0) && cursor < orders.length) {
        const o = orders[cursor];
        const open = o.chargeable.minus(o.settled);
        if (open.lte(0)) { cursor++; continue; }
        const take = (open.lt(left) ? open : left).toDP(2);
        if (take.lte(0)) { cursor++; continue; }
        await tx.paymentAllocation.create({ data: { paymentId: pay.id, orderId: o.id, amount: take, createdById: by } });
        o.settled = o.settled.plus(take);
        left = left.minus(take);
        allocation.placed = allocation.placed.plus(take);
        if (o.chargeable.minus(o.settled).lte(0)) cursor++;
      }
      if (left.gt(0)) allocation.advanceLeft = allocation.advanceLeft.plus(left);
    }
  }
  for (const list of ordersOf.values()) {
    for (const o of list) if (o.chargeable.gt(0) && o.chargeable.minus(o.settled).lte(0)) allocation.fullyPaid++;
  }

  if (userAgentLinks.length) {
    for (const link of userAgentLinks) {
      const agent = await tx.agent.findUnique({ where: { name: link.agentName }, select: { id: true } });
      if (agent) await tx.user.update({ where: { id: link.userId }, data: { agentId: agent.id } });
    }
  }

  // ─────────── Pass E: kassa hech qachon manfiy emas ───────────
  await ensureCashboxesNonNegative(tx, batchId, by);

  // ─────────── Pass F: yakuniy raqamlar ───────────
  return computeBalances(tx, batchId, {
    allocation, settlement, skipped,
    clientDirectTransport: clientDirectTransportTotal,
    transportSettled: transportSettledTotal,
    clientPaidGoods, clientPaidPallets, palletsPaidQty,
    palletsReturnedByClients: palletsReturnedTotal,
    palletsToFactory,
    returnExpense: returnExpenseTotal,
    palletBasePrice: input.palletBasePrice,
  });
}

/** To'lov qatoridagi PADDON puli (imzosi bilan) — mol puli shundan ayriladi. */
function clientPalletMoneyOf(p: ClientPaymentRow, price: Prisma.Decimal): Prisma.Decimal {
  const qty = p.palletQty ?? 0;
  if (!qty) return new D(0);
  return price.mul(qty).toDP(2);
}

/**
 * Bu partiya tegib o'tgan HAR BIR kassani, agar UMUMIY qoldig'i manfiyga tushsa, bitta
 * «Diller kapitali» KIRIM qatori bilan nolga ko'taradi. Egasining qoidasi: diller bo'shliqni
 * O'Z cho'ntagidan yopadi, to'lov baribir bo'lgan, kassa esa hech qachon minus ko'rsatmaydi.
 */
async function ensureCashboxesNonNegative(tx: Tx, batchId: string, by: string | null): Promise<void> {
  const touched = await tx.cashTransaction.findMany({
    where: { importBatchId: batchId }, select: { cashboxId: true }, distinct: ['cashboxId'],
  });
  for (const { cashboxId } of touched) {
    await tx.$executeRaw`SELECT id FROM "Cashbox" WHERE id = ${cashboxId} FOR UPDATE`;
    const agg = await tx.cashTransaction.groupBy({ by: ['direction'], where: { cashboxId }, _sum: { amount: true } });
    let bal = new D(0);
    for (const g of agg) bal = g.direction === CashDirection.IN ? bal.plus(g._sum.amount ?? 0) : bal.minus(g._sum.amount ?? 0);
    if (bal.isNegative()) {
      const need = bal.negated().toDP(2);
      const earliest = await tx.cashTransaction.findFirst({ where: { cashboxId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], select: { date: true } });
      await tx.cashTransaction.create({
        data: {
          cashboxId, date: earliest?.date ?? new Date(0), direction: CashDirection.IN,
          amount: need, source: CashSource.CAPITAL, importBatchId: batchId,
          note: "Diller kapitali — kassa manfiy boʼlmasligi uchun", createdById: by,
        },
      });
    }
  }
}

/**
 * REPLACE tozalash: hamma biznes qatorini FK tartibida (bolalardan boshlab) o'chiradi.
 * Prisma FK'lari `onDelete: Restrict`, ya'ni to'g'ri TARTIB — yagona kafolat.
 * Saqlanadi: User · AppSetting · AuditLog · AI suhbat · shu importning O'Z staging'i.
 */
async function wipeAllBusinessData(tx: Tx, keepBatchId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "User" SET "agentId" = NULL`;
  await tx.document.deleteMany({});
  await tx.cashTransaction.deleteMany({});
  await tx.expense.deleteMany({});
  // LedgerEntry PaymentAllocation'dan OLDIN: ADVANCE_DRAW qatori o'z taqsimotiga ishora
  // qiladi (Restrict), ya'ni taqsimot endi juftlikning OTASI.
  await tx.ledgerEntry.deleteMany({});
  await tx.paymentAllocation.deleteMany({});
  await tx.bonusTransaction.deleteMany({});
  await tx.bonusProgram.deleteMany({});
  await tx.palletTransaction.deleteMany({});
  await tx.orderComment.deleteMany({});
  await tx.orderStatusHistory.deleteMany({});
  await tx.orderItem.deleteMany({});
  await tx.payment.deleteMany({});
  await tx.order.deleteMany({});
  await tx.clientPrice.deleteMany({});
  await tx.clientAlias.deleteMany({});
  await tx.productPrice.deleteMany({});
  await tx.product.deleteMany({});
  await tx.client.deleteMany({});
  await tx.vehicle.deleteMany({});
  await tx.logisticsRoute.deleteMany({});
  await tx.agent.deleteMany({});
  await tx.factory.deleteMany({});
  await tx.region.deleteMany({});
  await tx.cashbox.deleteMany({});
  await tx.expenseCategory.deleteMany({});
  await tx.legalEntity.deleteMany({});
  await tx.importBatch.deleteMany({ where: { id: { not: keepBatchId } } });
}

interface BalanceInput {
  allocation: { placed: Prisma.Decimal; advanceLeft: Prisma.Decimal; fullyPaid: number };
  settlement: {
    drawn: Prisma.Decimal; ordersSettled: number; ordersPartial: number; ordersUnpaid: number;
    naqd: { orders: number; goods: Prisma.Decimal; paid: Prisma.Decimal };
    otkazma: { orders: number; goods: Prisma.Decimal; paid: Prisma.Decimal };
  };
  skipped: PreviewResult['skipped'];
  clientDirectTransport: Prisma.Decimal;
  transportSettled: Prisma.Decimal;
  clientPaidGoods: Prisma.Decimal;
  clientPaidPallets: Prisma.Decimal;
  palletsPaidQty: number;
  palletsReturnedByClients: number;
  palletsToFactory: number;
  returnExpense: Prisma.Decimal;
  palletBasePrice: Prisma.Decimal;
}

async function computeBalances(tx: Tx, batchId: string, x: BalanceInput): Promise<PreviewResult> {
  const led = await tx.ledgerEntry.groupBy({ by: ['account', 'source'], where: { importBatchId: batchId }, _sum: { amount: true } });
  const sum = (pred: (a: LedgerAccount, s: LedgerSource) => boolean) =>
    led.filter((g) => pred(g.account, g.source)).reduce((a, g) => a.plus(g._sum.amount ?? 0), new D(0));

  const buckets = await tx.ledgerEntry.groupBy({
    by: ['factoryBucket'], where: { importBatchId: batchId, account: LedgerAccount.FACTORY }, _sum: { amount: true },
  });
  const bucket = (b: FactoryBucket) =>
    buckets.filter((g) => g.factoryBucket === b).reduce((a, g) => a.plus(g._sum.amount ?? 0), new D(0));

  const clientDebt = sum((a) => a === LedgerAccount.CLIENT);
  const vehicleBalance = sum((a) => a === LedgerAccount.VEHICLE);
  const saleTotal = sum((a, s) => a === LedgerAccount.CLIENT && s === LedgerSource.ORDER_SALE);
  const costTotal = sum((a, s) => a === LedgerAccount.FACTORY && s === LedgerSource.ORDER_COST);
  const factoryPaid = sum((a, s) => a === LedgerAccount.FACTORY && s === LedgerSource.PAYMENT);
  const clientPaid = sum((a, s) => a === LedgerAccount.CLIENT && s === LedgerSource.PAYMENT);
  const factoryBalance = sum((a) => a === LedgerAccount.FACTORY);

  // ── zavod bo'yicha kesim ──
  const perFactoryLed = await tx.ledgerEntry.groupBy({
    by: ['factoryId', 'source'], where: { importBatchId: batchId, account: LedgerAccount.FACTORY, factoryId: { not: null } }, _sum: { amount: true },
  });
  const perFactoryPallets = await tx.palletTransaction.groupBy({
    by: ['factoryId', 'type'], where: { importBatchId: batchId, factoryId: { not: null } }, _sum: { qty: true },
  });
  const factoryIds = [...new Set([...perFactoryLed.map((r) => r.factoryId), ...perFactoryPallets.map((r) => r.factoryId)].filter(Boolean) as string[])];
  const factoryRows = factoryIds.length
    ? await tx.factory.findMany({ where: { id: { in: factoryIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(factoryRows.map((f) => [f.id, f.name]));
  const factories = factoryIds.map((id) => {
    const rows = perFactoryLed.filter((r) => r.factoryId === id);
    const take = (s: LedgerSource) => rows.filter((r) => r.source === s).reduce((a, r) => a.plus(r._sum.amount ?? 0), new D(0));
    const pal = perFactoryPallets.filter((r) => r.factoryId === id);
    const palQty = (t: PalletTransactionType) => pal.filter((r) => r.type === t).reduce((a, r) => a + (r._sum.qty ?? 0), 0);
    // Storno qatorlari `type = REVERSAL` bilan yotadi, shuning uchun ular SOF songa
    // qo'shiladi (qty allaqachon imzoli balans deltasi). `palletsReturned` esa
    // «Поддон қайтариш заводга» ning SOF soni — brak qaytgani ayrilgan holda.
    const receivedQty = palQty(PalletTransactionType.RECEIVED_FROM_FACTORY);
    const returnedRaw = palQty(PalletTransactionType.RETURNED_TO_FACTORY);
    const signed = palQty(PalletTransactionType.ADJUSTMENT) + palQty(PalletTransactionType.REVERSAL);
    const returnedNet = returnedRaw - pal
      .filter((r) => r.type === PalletTransactionType.REVERSAL)
      .reduce((a, r) => a + (r._sum.qty ?? 0), 0);
    return {
      name: nameById.get(id) ?? id,
      goodsTaken: take(LedgerSource.ORDER_COST).negated().toFixed(2),
      paid: take(LedgerSource.PAYMENT).toFixed(2),
      balance: rows.reduce((a, r) => a.plus(r._sum.amount ?? 0), new D(0)).toFixed(2),
      palletsOwed: receivedQty - returnedRaw + signed,
      palletsReceived: receivedQty,
      palletsReturned: returnedNet,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const orders = await tx.order.count({ where: { importBatchId: batchId } });

  /**
   * SOF sonlar: har turning yig'indisidan uni yo'qqa chiqargan STORNOLAR ayriladi.
   * Xom yig'indi olinsa, daftardagi manfiy tuzatish qatorlari (−19 qaytarish, −71 paddon
   * puli, −113 brak) ko'rinmay qolar va ekrandagi son Excel'nikidan farq qilardi.
   * `reversalOfType` shu uchun saqlanadi — u stornoni asl TURIGA qaytaradi.
   */
  const palAgg = await tx.palletTransaction.groupBy({ by: ['type'], where: { importBatchId: batchId }, _sum: { qty: true } });
  const revAgg = await tx.palletTransaction.groupBy({
    by: ['reversalOfType'],
    where: { importBatchId: batchId, type: PalletTransactionType.REVERSAL, reversalOfType: { not: null } },
    _sum: { qty: true },
  });
  const rawOf = (t: PalletTransactionType) => palAgg.filter((r) => r.type === t).reduce((a, r) => a + (r._sum.qty ?? 0), 0);
  const revOf = (t: PalletTransactionType) =>
    revAgg.filter((r) => r.reversalOfType === t).reduce((a, r) => a + (r._sum.qty ?? 0), 0);
  /** Musbat tomondagi turlar (berildi/olindi): storno MANFIY, shuning uchun qo'shiladi. */
  const netPlus = (t: PalletTransactionType) => rawOf(t) + revOf(t);
  /** Minus tomondagi turlar (qaytdi/undirildi): storno MUSBAT, shuning uchun ayriladi. */
  const netMinus = (t: PalletTransactionType) => rawOf(t) - revOf(t);

  const delivered = netPlus(PalletTransactionType.DELIVERED_TO_CLIENT);
  const received = netPlus(PalletTransactionType.RECEIVED_FROM_FACTORY);
  const returnedByClients = netMinus(PalletTransactionType.RETURNED_BY_CLIENT);
  const chargedToClients = netMinus(PalletTransactionType.CHARGED_LOST);
  const returnedToFactory = netMinus(PalletTransactionType.RETURNED_TO_FACTORY);
  const adjustments = rawOf(PalletTransactionType.ADJUSTMENT);

  const cash = await tx.cashTransaction.groupBy({ by: ['direction', 'source'], where: { importBatchId: batchId }, _sum: { amount: true } });
  const cashSum = (dir: CashDirection, src?: CashSource) =>
    cash.filter((c) => c.direction === dir && (src === undefined ? c.source !== CashSource.CAPITAL : c.source === src))
      .reduce((a, c) => a.plus(c._sum.amount ?? 0), new D(0));
  const cashIn = cashSum(CashDirection.IN);
  const cashOut = cashSum(CashDirection.OUT);
  const cashCapital = cashSum(CashDirection.IN, CashSource.CAPITAL);

  const perBox = await tx.cashTransaction.groupBy({
    by: ['cashboxId', 'direction', 'source'], where: { importBatchId: batchId }, _sum: { amount: true },
  });
  const boxIds = [...new Set(perBox.map((r) => r.cashboxId))];
  const boxRows = boxIds.length ? await tx.cashbox.findMany({ where: { id: { in: boxIds } }, select: { id: true, name: true, type: true } }) : [];
  const boxById = new Map(boxRows.map((b) => [b.id, b]));
  const boxAgg = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal; capital: Prisma.Decimal }>();
  for (const r of perBox) {
    const slot = boxAgg.get(r.cashboxId) ?? { in: new D(0), out: new D(0), capital: new D(0) };
    const amt = new D(r._sum.amount ?? 0);
    if (r.source === CashSource.CAPITAL) slot.capital = slot.capital.plus(amt);
    else if (r.direction === CashDirection.IN) slot.in = slot.in.plus(amt);
    else slot.out = slot.out.plus(amt);
    boxAgg.set(r.cashboxId, slot);
  }
  const cashboxes = [...boxAgg].map(([id, v]) => ({
    name: boxById.get(id)?.name ?? id,
    type: boxById.get(id)?.type ?? CashboxType.CASH,
    in: v.in.toFixed(2), out: v.out.toFixed(2), capital: v.capital.toFixed(2),
    balance: v.in.minus(v.out).plus(v.capital).toFixed(2),
  })).sort((a, b) => a.name.localeCompare(b.name));

  // ── Excel bilan zavod paddon puli farqi (ataylab ochiq) ──
  const takenMoney = x.palletBasePrice.mul(received);
  const returnedMoney = x.palletBasePrice.mul(returnedToFactory);

  return {
    orders,
    factories,
    factoryBalance: factoryBalance.toFixed(2),
    factoryGoodsTaken: costTotal.negated().toFixed(2),
    factoryTransferred: factoryPaid.toFixed(2),
    factorySettled: x.settlement.drawn.toFixed(2),
    factoryOrdersSettled: x.settlement.ordersSettled,
    factoryOrdersPartial: x.settlement.ordersPartial,
    factoryOrdersUnpaid: x.settlement.ordersUnpaid,
    factoryPayable: bucket(FactoryBucket.PAYABLE).toFixed(2),
    factoryAdvanceBank: bucket(FactoryBucket.ADVANCE_BANK).toFixed(2),
    factoryAdvanceCash: bucket(FactoryBucket.ADVANCE_CASH).toFixed(2),
    factoryByChannel: [
      {
        channel: "o'tkazma" as const, orders: x.settlement.otkazma.orders,
        goods: x.settlement.otkazma.goods.toFixed(2), paid: x.settlement.otkazma.paid.toFixed(2),
        debt: x.settlement.otkazma.goods.minus(x.settlement.otkazma.paid).toFixed(2),
      },
      {
        channel: 'naqd' as const, orders: x.settlement.naqd.orders,
        goods: x.settlement.naqd.goods.toFixed(2), paid: x.settlement.naqd.paid.toFixed(2),
        debt: x.settlement.naqd.goods.minus(x.settlement.naqd.paid).toFixed(2),
      },
    ].filter((c) => c.orders > 0),
    palletMoneyGap: {
      takenMoney: takenMoney.toFixed(2),
      returnedMoney: returnedMoney.toFixed(2),
      returnExpense: x.returnExpense.toFixed(2),
      gap: takenMoney.minus(returnedMoney).minus(x.returnExpense).toFixed(2),
    },
    clientDebtTotal: clientDebt.toFixed(2),
    saleTotal: saleTotal.toFixed(2),
    clientDirectTransport: x.clientDirectTransport.toFixed(2),
    clientChargeable: saleTotal.minus(x.clientDirectTransport).toFixed(2),
    clientPaidTotal: clientPaid.negated().toFixed(2),
    clientPaidGoods: x.clientPaidGoods.toFixed(2),
    clientPaidPallets: x.clientPaidPallets.toFixed(2),
    allocatedToOrders: x.allocation.placed.toFixed(2),
    ordersFullyPaid: x.allocation.fullyPaid,
    clientAdvanceLeft: x.allocation.advanceLeft.toFixed(2),
    pallets: {
      delivered,
      returnedByClients,
      paidByClients: chargedToClients,
      clientDebt: delivered - returnedByClients - chargedToClients + adjustments,
      returnedToFactory,
      dealerInHand: returnedByClients - returnedToFactory,
    },
    costTotal: costTotal.negated().toFixed(2),
    vehicleBalance: vehicleBalance.toFixed(2),
    transportSettled: x.transportSettled.toFixed(2),
    cashIn: cashIn.toFixed(2),
    cashOut: cashOut.toFixed(2),
    cashCapital: cashCapital.toFixed(2),
    cashboxes,
    skipped: x.skipped,
  };
}
