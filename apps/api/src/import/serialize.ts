import { Prisma } from '@prisma/client';
import type {
  ClientPaymentRow, FactoryPalletReturnRow, FactoryPaymentRow, PalletReturnRow, ShipmentRow,
} from './parse/types';

/**
 * Staged qatorlarni JSON ↔ tip o'girish (Decimal ↔ matn, Date ↔ ISO).
 *
 * NEGA DECIMAL MATN BO'LIB SAQLANADI: JSON'da son `double` bo'lib yotadi va 7 451 239 050
 * kabi summalar bilan ishlaganda oxirgi tiyinlar suzib ketadi. Butun daftar `Prisma.Decimal`
 * bilan hisoblanadi, shuning uchun staging'ga ham AYNAN o'sha aniqlikda yoziladi.
 */
const dec = (s: unknown): Prisma.Decimal | null => (s == null || s === '' ? null : new Prisma.Decimal(String(s)));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const date = (s: unknown): Date | null => (s ? new Date(String(s)) : null);
const str = (s: unknown): string | null => (s == null ? null : String(s));
const num = (s: unknown): number | null => (s == null || s === '' ? null : Number(s));
const txt = (s: unknown): string => String(s ?? '');

export type Json = Record<string, unknown>;

// ─────────────────────────── «Товар» ───────────────────────────

export function shipmentToJson(r: ShipmentRow): Json {
  return {
    origin: r.origin,
    factoryPayChannel: r.factoryPayChannel, factoryRaw: r.factoryRaw,
    agentRaw: r.agentRaw, clientRaw: r.clientRaw, date: iso(r.date),
    truck: r.truck, size: r.size, cube: r.cube,
    costPrice: str(r.costPrice), costSumDeclared: str(r.costSumDeclared),
    palletQty: r.palletQty, palletPrice: str(r.palletPrice), palletSumDeclared: str(r.palletSumDeclared),
    takenSumDeclared: str(r.takenSumDeclared),
    salePrice: str(r.salePrice), saleSumDeclared: str(r.saleSumDeclared),
    transportPayerRaw: r.transportPayerRaw, profitDeclared: str(r.profitDeclared),
    transportCost: str(r.transportCost), clientChargeDeclared: str(r.clientChargeDeclared),
  };
}

export function jsonToShipment(j: Json): ShipmentRow {
  return {
    origin: j.origin as ShipmentRow['origin'],
    factoryPayChannel: txt(j.factoryPayChannel), factoryRaw: txt(j.factoryRaw),
    agentRaw: txt(j.agentRaw), clientRaw: txt(j.clientRaw), date: date(j.date),
    truck: txt(j.truck), size: txt(j.size), cube: num(j.cube),
    costPrice: dec(j.costPrice), costSumDeclared: dec(j.costSumDeclared),
    palletQty: num(j.palletQty), palletPrice: dec(j.palletPrice), palletSumDeclared: dec(j.palletSumDeclared),
    takenSumDeclared: dec(j.takenSumDeclared),
    salePrice: dec(j.salePrice), saleSumDeclared: dec(j.saleSumDeclared),
    transportPayerRaw: txt(j.transportPayerRaw), profitDeclared: dec(j.profitDeclared),
    transportCost: dec(j.transportCost), clientChargeDeclared: dec(j.clientChargeDeclared),
  };
}

// ─────────────────────────── «Оплата» ───────────────────────────

export function clientPaymentToJson(r: ClientPaymentRow): Json {
  return {
    origin: r.origin, date: iso(r.date), agentRaw: r.agentRaw, clientRaw: r.clientRaw,
    bank: str(r.bank), cash: str(r.cash), click: str(r.click), terminal: str(r.terminal),
    totalDeclared: str(r.totalDeclared), payer: r.payer,
    palletQty: r.palletQty, palletPrice: str(r.palletPrice),
    palletMoneyDeclared: str(r.palletMoneyDeclared), goodsMoneyDeclared: str(r.goodsMoneyDeclared),
    receiver: r.receiver, note: r.note,
  };
}

export function jsonToClientPayment(j: Json): ClientPaymentRow {
  return {
    origin: j.origin as ClientPaymentRow['origin'], date: date(j.date),
    agentRaw: txt(j.agentRaw), clientRaw: txt(j.clientRaw),
    bank: dec(j.bank), cash: dec(j.cash), click: dec(j.click), terminal: dec(j.terminal),
    totalDeclared: dec(j.totalDeclared), payer: txt(j.payer),
    palletQty: num(j.palletQty), palletPrice: dec(j.palletPrice),
    palletMoneyDeclared: dec(j.palletMoneyDeclared), goodsMoneyDeclared: dec(j.goodsMoneyDeclared),
    receiver: txt(j.receiver), note: txt(j.note),
  };
}

// ─────────────── «Оплата поставшику» ───────────────

export function factoryPaymentToJson(r: FactoryPaymentRow): Json {
  return {
    origin: r.origin, date: iso(r.date), channel: r.channel,
    amount: str(r.amount), payer: r.payer, factoryRaw: r.factoryRaw,
  };
}

export function jsonToFactoryPayment(j: Json): FactoryPaymentRow {
  return {
    origin: j.origin as FactoryPaymentRow['origin'], date: date(j.date), channel: txt(j.channel),
    amount: dec(j.amount), payer: txt(j.payer), factoryRaw: txt(j.factoryRaw),
  };
}

// ─────────────── «Поддон қайтариш» ───────────────

export function palletReturnToJson(r: PalletReturnRow): Json {
  return { origin: r.origin, date: iso(r.date), clientRaw: r.clientRaw, qty: r.qty, note: r.note };
}

export function jsonToPalletReturn(j: Json): PalletReturnRow {
  return {
    origin: j.origin as PalletReturnRow['origin'], date: date(j.date),
    clientRaw: txt(j.clientRaw), qty: num(j.qty), note: txt(j.note),
  };
}

// ─────────── «Поддон қайтариш заводга» ───────────

export function factoryPalletReturnToJson(r: FactoryPalletReturnRow): Json {
  return {
    origin: r.origin, date: iso(r.date), qty: r.qty, senderRaw: r.senderRaw, factoryRaw: r.factoryRaw,
    unitCost: str(r.unitCost), totalCostDeclared: str(r.totalCostDeclared), note: r.note, channel: r.channel,
  };
}

export function jsonToFactoryPalletReturn(j: Json): FactoryPalletReturnRow {
  return {
    origin: j.origin as FactoryPalletReturnRow['origin'], date: date(j.date), qty: num(j.qty),
    senderRaw: txt(j.senderRaw), factoryRaw: txt(j.factoryRaw),
    unitCost: dec(j.unitCost), totalCostDeclared: dec(j.totalCostDeclared),
    note: txt(j.note), channel: txt(j.channel),
  };
}
