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
    factoryPaid: str(r.factoryPaid), factoryPayChannel: r.factoryPayChannel,
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
    // A row staged BEFORE the «Завотга толов» column existed has no such key, and `null` is
    // exactly its meaning: «this file does not say per truck» ⇒ the commit falls back to the
    // old block-FIFO settlement, so a DRAFT batch already in the DB commits as previewed.
    // `dec()` maps '' → null too, which is what the owner's blank cell should mean as well.
    factoryPaid: dec(j.factoryPaid),
    factoryPayChannel: String(j.factoryPayChannel ?? ''),
  };
}

export function clientPaymentToJson(r: ClientPaymentRow): Json {
  return {
    origin: r.origin, no: r.no, date: iso(r.date), agentRaw: r.agentRaw, agentNo: r.agentNo,
    clientRaw: r.clientRaw, total: str(r.total), payer: r.payer, palletReturn: r.palletReturn,
    blockName: r.blockName, note: r.note,
  };
}
export function jsonToClientPayment(j: Json): ClientPaymentRow {
  return {
    origin: j.origin as ClientPaymentRow['origin'], no: int(j.no), date: date(j.date),
    agentRaw: String(j.agentRaw ?? ''), agentNo: int(j.agentNo), clientRaw: String(j.clientRaw ?? ''),
    total: dec(j.total), payer: String(j.payer ?? ''), palletReturn: int(j.palletReturn),
    // blockName: staged rows written before this field existed fall back to the client name,
    // which still carries «Нахт клент …» for exactly the blocks the cash rule cares about.
    blockName: String(j.blockName ?? j.clientRaw ?? ''),
    note: String(j.note ?? j.payer ?? ''),
  };
}

export function factoryPaymentToJson(r: FactoryPaymentRow): Json {
  return {
    origin: r.origin, date: iso(r.date), amount: str(r.amount), channel: r.channel,
    payer: r.payer, receiver: r.receiver, inDeclaredTotal: r.inDeclaredTotal,
  };
}
export function jsonToFactoryPayment(j: Json): FactoryPaymentRow {
  return {
    origin: j.origin as FactoryPaymentRow['origin'], date: date(j.date), amount: dec(j.amount),
    // The commit reads its rows back from the DB, not from the parser — so a channel that is
    // parsed but not round-tripped here would show the naqd/Click split in the preview and
    // still post every so'm as BANK. Rows staged before the «Утказилган пул» block grew its
    // channel column carry no such key: '' is exactly their old meaning (bank o'tkazmasi),
    // so a DRAFT batch already sitting in the DB still commits the way it was previewed.
    channel: String(j.channel ?? ''),
    payer: String(j.payer ?? ''), receiver: String(j.receiver ?? ''),
    // Rows staged before the «Жами» coverage check existed carry no flag — and «counted» is
    // their historical meaning, so an older DRAFT still commits every so'm it previewed.
    // This is also the field the owner flips (ZAVOD_JAMIDAN_TASHQARI → «Toʼgʼrilash») to pull
    // an excluded transfer back into the import.
    inDeclaredTotal: j.inDeclaredTotal === undefined ? true : j.inDeclaredTotal !== false && j.inDeclaredTotal !== 'false',
  };
}
