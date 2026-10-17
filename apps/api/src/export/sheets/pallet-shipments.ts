import { Prisma } from '@prisma/client';
import { ZERO } from '../../common/money';
import { tashkentDateStr } from '../../common/tashkent-time';
import type { Ctx } from './ctx';
import { Col, FIRST_DATA_ROW, num0, writeTable } from '../xlsx/sheet-builder';
import { NUMFMT } from '../xlsx/theme';

export const PALLET_SHIPMENT_SHEET = 'Paddon reyslari';
export const PALLET_INSPECTION_SHEET = 'Paddon qabul tafsiloti';
export const PALLET_RESTOCK_SHEET = 'Paddon omborga qaytishi';
export const PALLET_SHIPMENT_MARKER = 'SMARTBLOK_FACTORY_PALLET_SHIPMENTS_V1';

/** Full history is required: these quantities feed the current warehouse reconciliation. */
export async function loadPalletShipments(prisma: Pick<Prisma.TransactionClient, 'factoryPalletShipment'>) {
  return prisma.factoryPalletShipment.findMany({
    orderBy: [{ dispatchedAt: 'asc' }, { returnNo: 'asc' }],
    include: {
      factory: { select: { name: true } }, createdBy: { select: { name: true } },
      inspections: { orderBy: [{ date: 'asc' }, { id: 'asc' }], include: {
        lines: { orderBy: { id: 'asc' } }, createdBy: { select: { name: true } },
      } },
      warehouseReturns: { orderBy: [{ date: 'asc' }, { id: 'asc' }], include: { createdBy: { select: { name: true } } } },
    },
  });
}

export type ExportPalletShipment = Awaited<ReturnType<typeof loadPalletShipments>>[number];

export function exportShipmentTotals(shipment: ExportPalletShipment) {
  const inspections = shipment.inspections.filter((inspection) => !inspection.voidedAt);
  const accepted = inspections.reduce((sum, inspection) => sum + inspection.lines.reduce((s, line) => s + line.qty, 0), 0);
  const rejected = inspections.reduce((sum, inspection) => sum + inspection.rejectedQty, 0);
  const returned = shipment.warehouseReturns.filter(row => !row.voidedAt).reduce((sum, row) => sum + row.qty, 0);
  const cancelled = shipment.cancelledAt !== null;
  const uninspected = cancelled ? 0 : shipment.qty - accepted - rejected;
  return { accepted, rejected, returned, uninspected,
    outstanding: cancelled ? 0 : shipment.qty - accepted - returned,
    inTransit: !cancelled && !shipment.arrivedAt ? shipment.qty - accepted - returned : 0,
    awaitingInspection: !cancelled && shipment.arrivedAt ? uninspected : 0,
    rejectedAtFactory: cancelled ? 0 : rejected - returned,
    amount: inspections.reduce((sum, inspection) => inspection.lines.reduce((s, line) => s.plus(line.amount), sum), ZERO),
  };
}

const STATUS: Record<string, string> = { IN_TRANSIT: 'Yo‘lda', INSPECTING: 'Tekshiruvda', AWAITING_RETURN: 'Rad etilgan — qaytishi kutilmoqda', COMPLETED: 'Yakunlangan', CANCELLED: 'Bekor qilingan' };
const day = (date: Date | null) => date ? new Date(`${tashkentDateStr(date)}T00:00:00.000Z`) : null;

/** Separate report tables retain prices/inspection evidence without pretending to be importable source rows. */
export function writePalletShipments(ctx: Ctx, shipments: ExportPalletShipment[]): void {
  if (!shipments.length) return;
  const footnote = 'Bu reyslar hisoboti avtomatik qayta import qilinmaydi: yo‘l, tekshiruv, rad etish va qabul narxi tarixini oddiy qaytarish qatori bilan almashtirib bo‘lmaydi. Baza tiklash uchun zaxira nusxasidan foydalaning. Jo‘natish faqat omborni kamaytiradi; zavod qarzini faqat qabul qilingan son kamaytiradi. Qabul bahosi qayd etiladi, pul to‘lovi hisoblanmaydi.';
  const make = (name: string, title: string) => {
    const ws = ctx.book.sheet('ops', { tab: name, exactName: true, title, desc: 'Poddon reysi va zavod qabulining to‘liq tarixi.' });
    ws.getCell('Z1').value = PALLET_SHIPMENT_MARKER;
    ws.getColumn('Z').hidden = true;
    return ws;
  };
  const cols: Col<ExportPalletShipment>[] = [
    { header: 'Reys ID', value: r => r.id, width: 38 },
    { header: 'Reys №', value: r => r.returnNo, width: 20 },
    { header: 'Zavod', value: r => r.factory.name, width: 26 },
    { header: 'Jo‘natilgan sana', value: r => day(r.dispatchedAt), fmt: NUMFMT.date },
    { header: 'Yetib kelgan sana', value: r => day(r.arrivedAt), fmt: NUMFMT.date },
    { header: 'Holat', value: r => STATUS[r.status] ?? r.status, width: 28 },
    { header: 'Yuklangan', value: r => r.qty, fmt: NUMFMT.int },
    { header: 'Qabul qilingan (sof)', value: r => exportShipmentTotals(r).accepted, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Rad etilgan (jami)', value: r => exportShipmentTotals(r).rejected, fmt: NUMFMT.int },
    { header: 'Omborga qaytgan', value: r => exportShipmentTotals(r).returned, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Tekshirilmagan', value: r => exportShipmentTotals(r).uninspected, fmt: NUMFMT.int },
    { header: 'Ombordan tashqarida — hali qarzimiz', value: r => exportShipmentTotals(r).outstanding, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Yo‘lda', value: r => exportShipmentTotals(r).inTransit, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Tekshiruv kutilmoqda', value: r => exportShipmentTotals(r).awaitingInspection, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Rad etilgan — zavodda', value: r => exportShipmentTotals(r).rejectedAtFactory, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Qabul bahosi (sof)', value: r => num0(exportShipmentTotals(r).amount), fmt: NUMFMT.money, total: 'sum' },
    { header: 'Avtomobil raqami', value: r => r.vehiclePlate, width: 20 },
    { header: 'Haydovchi', value: r => r.driverName, width: 25 },
    { header: 'Izoh', value: r => r.note, width: 40, wrap: true },
    { header: 'Bekor qilingan sana', value: r => day(r.cancelledAt), fmt: NUMFMT.date },
    { header: 'Bekor qilish sababi', value: r => r.cancelReason, width: 40, wrap: true },
    { header: 'Kiritgan', value: r => r.createdBy?.name ?? null, width: 24 },
    { header: 'Yetib kelish izohi', value: r => r.arrivalNote, width: 40, wrap: true },
  ];
  const ws = make(PALLET_SHIPMENT_SHEET, 'Zavodga poddon qaytarish — reyslar');
  writeTable(ws, { title: 'Zavodga poddon qaytarish — reyslar', subtitle: 'Butun tarix. Qoldiqlar bugungi holat bo‘yicha.', columns: cols, rows: shipments, freezeCols: 2, footnote });
  ws.getRow(4).height = 60;
  shipments.forEach((row, index) => {
    const r = FIRST_DATA_ROW + index;
    ws.getCell(r, 12).value = { formula: row.cancelledAt !== null ? '0' : `G${r}-H${r}-J${r}`, result: exportShipmentTotals(row).outstanding };
  });
  ctx.book.count(ws, shipments.length);

  const inspections = shipments.flatMap(shipment => shipment.inspections.flatMap(inspection => [
    ...inspection.lines.map(line => ({ shipment, inspection, line, rejected: false })),
    ...(inspection.rejectedQty ? [{ shipment, inspection, line: null, rejected: true }] : []),
  ]));
  type I = typeof inspections[number];
  const inspected = make(PALLET_INSPECTION_SHEET, 'Zavod tekshiruvi — har bir holat va narx');
  const inspectionCols: Col<I>[] = [
    { header: 'Reys №', value: r => r.shipment.returnNo, width: 20 },
    { header: 'Zavod', value: r => r.shipment.factory.name, width: 26 },
    { header: 'Tekshiruv ID', value: r => r.inspection.id, width: 38 },
    { header: 'Sana', value: r => day(r.inspection.date), fmt: NUMFMT.date },
    { header: 'Natija', value: r => r.rejected ? 'Rad etilgan' : 'Qabul qilingan' },
    { header: 'Holat / rad sababi', value: r => r.line?.condition ?? r.inspection.rejectionReason, width: 40, wrap: true },
    { header: 'Dona', value: r => r.line?.qty ?? r.inspection.rejectedQty, fmt: NUMFMT.int },
    { header: 'Qabul narxi', value: r => r.line ? num0(r.line.unitPrice) : null, fmt: NUMFMT.money },
    { header: 'Qabul bahosi', value: r => r.line ? num0(r.line.amount) : null, fmt: NUMFMT.money },
    { header: 'Amaldagi qabul bahosi', value: r => !r.inspection.voidedAt && r.line ? num0(r.line.amount) : 0, fmt: NUMFMT.money, total: 'sum' },
    { header: 'Qabul qilgan', value: r => r.inspection.receiverName, width: 25 },
    { header: 'Hujjat', value: r => r.inspection.documentRef, width: 25 },
    { header: 'Izoh', value: r => r.inspection.note, width: 40, wrap: true },
    { header: 'Bekor qilingan sana', value: r => day(r.inspection.voidedAt), fmt: NUMFMT.date },
    { header: 'Bekor qilish sababi', value: r => r.inspection.voidReason, width: 40, wrap: true },
    { header: 'Kiritgan', value: r => r.inspection.createdBy?.name ?? null },
    { header: 'Poddon yozuvi ID', value: r => r.line?.palletTransactionId ?? null, width: 38 },
  ];
  writeTable(inspected, { title: 'Zavod tekshiruvi — har bir holat va narx', subtitle: 'Bekor qilingan tekshiruvlar tarixda saqlanadi; sof bahoga qo‘shilmaydi.', columns: inspectionCols, rows: inspections, footnote });
  inspected.getRow(4).height = 60;
  ctx.book.count(inspected, inspections.length);
  const returns = shipments.flatMap(shipment => shipment.warehouseReturns.map(row => ({ shipment, row })));
  type R = typeof returns[number];
  const restock = make(PALLET_RESTOCK_SHEET, 'Rad etilgan poddon — omborga haqiqiy qaytish');
  const returnCols: Col<R>[] = [
    { header: 'Reys №', value: r => r.shipment.returnNo, width: 20 },
    { header: 'Zavod', value: r => r.shipment.factory.name, width: 26 },
    { header: 'Sana', value: r => day(r.row.date), fmt: NUMFMT.date },
    { header: 'Dona (asl yozuv)', value: r => r.row.qty, fmt: NUMFMT.int },
    { header: 'Izoh', value: r => r.row.note, width: 48, wrap: true },
    { header: 'Kiritgan', value: r => r.row.createdBy?.name ?? null, width: 25 },
    { header: 'Yozuv ID', value: r => r.row.id, width: 38 },
    { header: 'Omborga qaytgan (sof)', value: r => r.row.voidedAt ? 0 : r.row.qty, fmt: NUMFMT.int, total: 'sum' },
    { header: 'Bekor qilingan sana', value: r => day(r.row.voidedAt), fmt: NUMFMT.date },
    { header: 'Bekor qilish sababi', value: r => r.row.voidReason, width: 40, wrap: true },
    { header: 'Yozuv holati', value: r => r.row.voidedAt ? 'Bekor qilingan' : 'Amalda', width: 20 },
  ];
  writeTable(restock, { title: 'Rad etilgan poddon — omborga haqiqiy qaytish', subtitle: 'Faqat amaldagi haqiqiy qaytish omborni oshiradi; bekor qilingan yozuvlar tarixda qoladi.', columns: returnCols, rows: returns, footnote });
  restock.getRow(4).height = 60;
  ctx.book.count(restock, returns.length);
}
