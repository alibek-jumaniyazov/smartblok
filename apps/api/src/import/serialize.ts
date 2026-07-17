import { Prisma } from '@prisma/client';
import type { ShipmentRow, ClientPaymentRow, FactoryPaymentRow } from './parse/types';

// JSON-safe <-> typed conversions for staged rows (Decimals ↔ strings, Dates ↔ ISO).
const dec = (s: unknown): Prisma.Decimal | null => (s == null || s === '' ? null : new Prisma.Decimal(String(s)));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const date = (s: unknown): Date | null => (s ? new Date(String(s)) : null);
const str = (s: unknown): string | null => (s == null ? null : String(s));
const int = (s: unknown): number | null => (s == null || s === '' ? null : Number(s));

export type Json = Record<string, unknown>;

export function shipmentToJson(r: ShipmentRow): Json {
  return {
    origin: r.origin, no: r.no, supplier: r.supplier, agentRaw: r.agentRaw, clientRaw: r.clientRaw,
    date: iso(r.date), truck: r.truck, size: r.size, cube: r.cube,
    costPrice: str(r.costPrice), palletQty: r.palletQty, palletPrice: str(r.palletPrice),
    salePrice: str(r.salePrice), diff: str(r.diff), saleSum: str(r.saleSum),
    transport: str(r.transport), transportWord: r.transportWord, autoPaid: r.autoPaid, izoh: r.izoh,
  };
}
export function jsonToShipment(j: Json): ShipmentRow {
  return {
    origin: j.origin as ShipmentRow['origin'], no: (j.no as number) ?? null, supplier: String(j.supplier ?? ''),
    agentRaw: String(j.agentRaw ?? ''), clientRaw: String(j.clientRaw ?? ''), date: date(j.date),
    truck: String(j.truck ?? ''), size: String(j.size ?? ''), cube: (j.cube as number) ?? null,
    costPrice: dec(j.costPrice), palletQty: (j.palletQty as number) ?? null, palletPrice: dec(j.palletPrice),
    salePrice: dec(j.salePrice), diff: dec(j.diff), saleSum: dec(j.saleSum),
    transport: dec(j.transport), transportWord: (j.transportWord as string) ?? null,
    autoPaid: String(j.autoPaid ?? ''), izoh: String(j.izoh ?? ''),
  };
}

export function clientPaymentToJson(r: ClientPaymentRow): Json {
  return {
    origin: r.origin, no: r.no, date: iso(r.date), agentRaw: r.agentRaw, agentNo: r.agentNo,
    clientRaw: r.clientRaw, total: str(r.total), payer: r.payer, palletReturn: r.palletReturn, note: r.note,
  };
}
export function jsonToClientPayment(j: Json): ClientPaymentRow {
  return {
    origin: j.origin as ClientPaymentRow['origin'], no: int(j.no), date: date(j.date),
    agentRaw: String(j.agentRaw ?? ''), agentNo: int(j.agentNo), clientRaw: String(j.clientRaw ?? ''),
    total: dec(j.total), payer: String(j.payer ?? ''), palletReturn: int(j.palletReturn),
    note: String(j.note ?? ''),
  };
}

export function factoryPaymentToJson(r: FactoryPaymentRow): Json {
  return { origin: r.origin, date: iso(r.date), amount: str(r.amount), payer: r.payer, receiver: r.receiver };
}
export function jsonToFactoryPayment(j: Json): FactoryPaymentRow {
  return {
    origin: j.origin as FactoryPaymentRow['origin'], date: date(j.date), amount: dec(j.amount),
    payer: String(j.payer ?? ''), receiver: String(j.receiver ?? ''),
  };
}
