import { PaymentKind, Prisma, PalletTransactionType } from '@prisma/client';
import { D, round2, ZERO } from '../../common/money';
import { NOT_CANCELLED } from '../../common/order-scope';
import { clientChargeable } from '../../common/transport';
import { tashkentDateStr } from '../../common/tashkent-time';
import type { Ctx } from './ctx';
import type { AgentKpiAggregate } from '../../agents/agent-kpi.calculator';
import { factoryReturnExpenseCredits } from '../../common/pallet-debt';

export const TEMPLATE_SHEETS = ['Кўрсаткичлар', 'Мижозлар қолдиғи', 'Мижоз картаси', 'Қидирув',
  'Поставшиклар ҳисоби', 'Акт сверка', 'Ҳисобот', 'Акт (умумий)', 'KPI',
  'Поддон қайтариш заводга', 'Поддон қайтариш', 'Оплата', 'Оплата поставшику', 'Товар', 'Текширув'] as const;

export type Plain = string | number | Date | null;
export const n = (value: Prisma.Decimal | number | string | null | undefined): number => D(value ?? 0).toNumber();
export const total = (rows: Plain[][], col: number): number => rows.reduce((sum, row) => sum.plus(typeof row[col] === 'number' ? row[col] as number : 0), ZERO).toNumber();
export const excelDate = (date: Date): Date => new Date(`${tashkentDateStr(date)}T00:00:00.000Z`);
export const channel = (method: string): string => ({ CASH: 'Касса', BANK: 'Перечисления', CLICK: 'Клик', TERMINAL: 'Терминал', CARD: 'Нахт пластика', USD: 'Доллар', BONUS: 'Бонус', UNKNOWN: 'Аниқланмаган' })[method] ?? method;

/** Allocate an order-level amount once across its items, retaining every cent. */
export function splitAmount(amount: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  const sum = weights.reduce((a, b) => a.plus(b), ZERO);
  let used = ZERO;
  return weights.map((weight, index) => {
    const value = index === weights.length - 1 ? amount.minus(used)
      : round2(sum.isZero() ? amount.div(weights.length) : amount.mul(weight).div(sum));
    used = used.plus(value);
    return value;
  });
}

const noteField = (note: string | null, label: string): string | null => {
  const line = (note ?? '').split(/\r?\n| · /).find((part) => part.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim() : null;
};

/** Full-history source tables. Filtering belongs to reports, never to their SUMIFS source. */
export async function loadSmartblokData(ctx: Ctx) {
  const [orders, payments, pallets, clients, agents, factories, balances, factoryBuckets, expenses, baseSetting,
    clientPalletBalances, factoryPalletBalances, factoryReturnCredits] = await Promise.all([
    ctx.prisma.order.findMany({ where: NOT_CANCELLED, orderBy: [{ date: 'asc' }, { orderNo: 'asc' }], include: {
      client: { include: { agent: true } }, agent: true, factory: true, vehicle: true,
      items: { include: { product: true }, orderBy: { id: 'asc' } },
    } }),
    ctx.prisma.payment.findMany({ where: { voidedAt: null }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], include: {
      client: { include: { agent: true } }, factory: true, agent: true, payerEntity: true, receiverEntity: true,
    } }),
    ctx.prisma.palletTransaction.findMany({ orderBy: [{ date: 'asc' }, { at: 'asc' }, { id: 'asc' }], include: {
      client: { include: { agent: true } }, factory: true, reversals: true,
    } }),
    ctx.prisma.client.findMany({ orderBy: { name: 'asc' }, include: { aliases: { orderBy: { name: 'asc' } }, agent: true } }),
    ctx.prisma.agent.findMany({ orderBy: [{ sortNo: 'asc' }, { name: 'asc' }] }),
    ctx.prisma.factory.findMany({ orderBy: { name: 'asc' } }),
    ctx.ledger.clientBalances(), ctx.ledger.factoryBucketsMap(),
    ctx.prisma.expense.findMany({ where: { voidedAt: null, importBatchId: { not: null } }, include: { cashbox: true, cashTransactions: true }, orderBy: { date: 'asc' } }),
    ctx.settings.get<number | string | null>('palletPriceDefault'),
    ctx.pallets.clientPalletBalances(), ctx.pallets.factoryPalletBalances(),
    factoryReturnExpenseCredits(ctx.prisma),
  ]);
  const palletPrice = D(baseSetting || 130000);
  const goods: Plain[][] = [];
  const kpiAggregates: AgentKpiAggregate[] = [];
  for (const order of orders) {
    const weights = order.items.map((item) => D(item.actualQuantityM3 ?? item.quantityM3));
    kpiAggregates.push({
      agentId: order.client.agent?.id ?? order.agent?.id ?? null,
      date: tashkentDateStr(order.date), ordersCount: 1,
      quantityM3: weights.reduce((sum, quantity) => sum.plus(quantity), ZERO),
      profit: order.saleTotal.minus(order.costTotal).minus(order.transportCost),
    });
    const transport = splitAmount(order.transportCost, weights);
    const charges = splitAmount(clientChargeable(order), order.items.map((item) => item.saleTotal));
    order.items.forEach((item, index) => {
      const quantity = weights[index];
      const count = item.actualPalletCount ?? item.palletCount;
      const assigned = order.client.agent?.name ?? order.agent?.name ?? null;
      // Outstanding pallets are valued at the editable global price. Historical
      // paid-pallet charges below retain the price of their actual posting.
      const deposit = round2(palletPrice.mul(count));
      goods.push([channel(order.factoryPayIntent), order.factory.name, order.agent?.name ?? null,
        order.client.name, excelDate(order.date), order.vehicle?.plate ?? order.vehicle?.name ?? order.driverName,
        item.product.size ?? item.product.name, n(quantity), quantity.isZero() ? 0 : n(item.costTotal.div(quantity)), n(item.costTotal),
        count, n(palletPrice), n(deposit), n(item.costTotal.plus(deposit)), quantity.isZero() ? 0 : n(item.saleTotal.div(quantity)), n(item.saleTotal),
        order.transportMode === 'CLIENT_PAYS_DRIVER' ? 'Клиент' : 'Сотувчи',
        n(round2(item.saleTotal.minus(item.costTotal).minus(transport[index]))), n(transport[index]), n(charges[index]), assigned,
        order.agent?.name && order.agent.name !== assigned ? 'Бириктирилган агент фарқ қилади' : '', assigned,
        order.note, noteField(order.note, 'ИНН'), noteField(order.note, '№ ЭСФ'), noteField(order.note, 'Статус ЭСФ')]);
    });
  }
  const clientPayments: Plain[][] = [];
  const factoryPayments: Plain[][] = [];
  const unsupported: string[] = [];
  for (const payment of payments) {
    if ([PaymentKind.CLIENT_IN, PaymentKind.CLIENT_REFUND].includes(payment.kind as 'CLIENT_IN' | 'CLIENT_REFUND') && payment.client) {
      const amount = n(payment.kind === PaymentKind.CLIENT_REFUND ? payment.amount.negated() : payment.amount);
      const method = payment.method;
      const assigned = payment.client.agent?.name ?? payment.agent?.name ?? 'Агентсиз';
      // Template has four channels. Additional fields make conversions explicit and auditable.
      if (!['BANK', 'CASH', 'CLICK', 'TERMINAL'].includes(method)) {
        unsupported.push(`${payment.id}: ${channel(method)} — тўлиқ маълумот «Тўловлар» варағида; шаблонга киритилмади`);
        continue;
      }
      clientPayments.push([excelDate(payment.date), payment.agent?.name ?? assigned, payment.client.name,
        method === 'BANK' ? amount : 0, payment.payerEntity?.name ?? payment.payerName, 0, null,
        method === 'CASH' ? amount : 0, method === 'CLICK' ? amount : 0, method === 'TERMINAL' ? amount : 0,
        amount, payment.receiverEntity?.name ?? payment.receiverName, payment.note, n(palletPrice), 0, amount, assigned,
        payment.agent?.name && payment.agent.name !== assigned ? 'Бириктирилган агент фарқ қилади' : '', assigned,
        channel(method), n(payment.usdAmount), n(payment.rate), payment.id]);
    }
    if ([PaymentKind.FACTORY_OUT, PaymentKind.FACTORY_REFUND].includes(payment.kind as 'FACTORY_OUT' | 'FACTORY_REFUND') && payment.factory) {
      if (!['CASH', 'BANK', 'CLICK', 'TERMINAL', 'CARD'].includes(payment.method)) {
        unsupported.push(`${payment.id}: ${channel(payment.method)} — тўлиқ маълумот «Тўловлар» варағида; шаблонга киритилмади`);
        continue;
      }
      factoryPayments.push([excelDate(payment.date), channel(payment.method), n(payment.kind === PaymentKind.FACTORY_REFUND ? payment.amount.negated() : payment.amount),
        payment.payerEntity?.name ?? payment.payerName, payment.factory.name, payment.note, payment.id]);
    }
  }
  const clientReturns: Plain[][] = [];
  const factoryReturns: Plain[][] = [];
  const factoryDefects: Plain[][] = [];
  const usedExpenses = new Set<string>();
  const origin = (note: string | null) => (note ?? '').match(/Excel «[^»]+» r\d+/)?.[0];
  const matchesExpense = (candidate: typeof expenses[number], pallet: typeof pallets[number]) =>
    candidate.importBatchId !== null && pallet.importBatchId === candidate.importBatchId
    && candidate.date.getTime() === pallet.date.getTime()
    && ((pallet.note !== null && candidate.note === pallet.note)
      || (origin(pallet.note) !== undefined && origin(candidate.note) === origin(pallet.note)));
  // Same attribution rule as the API: only imported, unambiguous provenance.
  // A native expense on the same day is not automatically a factory credit.
  const expenseFactory = new Map<string, string>();
  for (const expense of expenses) {
    const ids = new Set(pallets.filter((p) => p.factoryId
      && (p.type === PalletTransactionType.RETURNED_TO_FACTORY
        || (p.type === PalletTransactionType.REVERSAL && p.reversalOfType === PalletTransactionType.RETURNED_TO_FACTORY))
      && matchesExpense(expense, p)).map((p) => p.factoryId!));
    if (ids.size === 1) expenseFactory.set(expense.id, [...ids][0]);
  }
  const remainingPallets = new Map<string, number>();
  const palletById = new Map(pallets.map((p) => [p.id, p]));
  for (const pallet of pallets) {
    const original = pallet.reversalOfId ? palletById.get(pallet.reversalOfId) : undefined;
    const type = pallet.reversalOfType ?? pallet.type;
    const qty = pallet.type === PalletTransactionType.REVERSAL ? -pallet.qty : pallet.qty;
    remainingPallets.set(pallet.id, pallet.qty - pallet.reversals.reduce((sum, reversal) => sum + Math.abs(reversal.qty), 0));
    if (!qty) continue;
    if (!pallet.clientId && !pallet.factoryId && type === PalletTransactionType.ADJUSTMENT) {
      // Warehouse damage and its reversal must never become a fictitious client.
      clientReturns.push([excelDate(pallet.date), pallet.qty < 0 ? 'БРАК' : 'ОМБОР ТУЗАТИШИ', pallet.qty, pallet.note]);
    } else if (type === PalletTransactionType.RETURNED_BY_CLIENT && pallet.client) {
      clientReturns.push([excelDate(pallet.date), pallet.client.name, qty, pallet.note]);
    } else if (type === PalletTransactionType.CHARGED_LOST && pallet.client) {
      // Charge and payment are different facts. Do not guess which receipt paid a charge.
      const price = original?.unitPrice ?? pallet.unitPrice ?? palletPrice;
      const charge = n(round2(price.mul(qty)));
      const assigned = pallet.client.agent?.name ?? 'Агентсиз';
      clientPayments.push([excelDate(pallet.date), assigned, pallet.client.name, 0, null, qty, null, 0, 0, 0, 0, null,
        pallet.note, n(price), charge, -charge, assigned, '', assigned, 'Поддон ҳисоби', 0, 0, pallet.id]);
    } else if (type === PalletTransactionType.DEFECTIVE_FROM_FACTORY && pallet.factory) {
      // Keep the explicit operation marker through Excel and reimport. A defect
      // discharges liability and unusable stock; it never becomes a truck return.
      factoryDefects.push([excelDate(original?.date ?? pallet.date), qty, null, pallet.factory.name,
        0, 0, pallet.note, null, 'DEFECTIVE_FROM_FACTORY']);
    } else if (type === PalletTransactionType.RETURNED_TO_FACTORY && pallet.factory) {
      // Imports preserve the identical provenance note on the return and its expense.
      const expense = expenses.find((candidate) => !usedExpenses.has(candidate.id)
        && expenseFactory.get(candidate.id) === pallet.factoryId && matchesExpense(candidate, pallet));
      if (expense) usedExpenses.add(expense.id);
      const signedExpense = expense ? expense.cashTransactions.reduce((sum, cash) => sum.plus(cash.direction === 'IN' ? cash.amount.negated() : cash.amount), ZERO) : ZERO;
      factoryReturns.push([excelDate(pallet.date), qty, null, pallet.factory.name,
        qty ? n(signedExpense.div(qty)) : 0, n(signedExpense), pallet.note,
        expense?.cashbox ? channel(expense.cashbox.type) : 'Перечисления', 'RETURNED_TO_FACTORY']);
    }
  }
  clientPayments.sort((a, b) => (a[0] as Date).getTime() - (b[0] as Date).getTime());
  const factoryMovements = [...factoryReturns, ...factoryDefects].sort((a, b) =>
    (a[0] as Date).getTime() - (b[0] as Date).getTime() || Number(b[1]) - Number(a[1]));
  return { goods, clientPayments, factoryPayments, clientReturns, factoryReturns, factoryDefects, factoryMovements, clients, agents, factories, kpiAggregates,
    balances, factoryBuckets, palletPrice, pallets, remainingPallets, unsupported,
    clientPalletBalances, factoryPalletBalances, factoryReturnCredits };
}

export type SmartblokData = Awaited<ReturnType<typeof loadSmartblokData>>;
