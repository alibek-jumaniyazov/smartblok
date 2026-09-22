import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { WorkbookReader, TemplateMismatchError } from '../../src/import/parse/workbook.reader';
import { InvalidCellError, readCell, readDate, readInt, readMoney } from '../../src/import/parse/cells';
import { parseWorkbook } from '../../src/import/import.service';
import { shipmentToJson, jsonToShipment } from '../../src/import/serialize';
import { Dictionary } from '../../src/import/resolve/dictionary';

async function main() {
  const buffer = readFileSync(join(__dirname, '../../../../docs/Smart blok.xlsb'));
  const parsed = await parseWorkbook(buffer);
  const unassigned = parsed.clientPayments.find((r) => r.origin.excelRow === 226)!;
  assert.equal(unassigned.clientRaw, '');
  assert.equal(unassigned.bank?.toString(), '163350000', 'unassigned money is staged, never silently dropped');
  assert.equal(parsed.incomplete.length, 1);
  assert.equal(parsed.incomplete[0].origin.excelRow, 18, 'scratch column I is not an inferred factory return');
  assert.match(parsed.incomplete[0].summary, /Столбец1: 500/, 'scratch quantity remains visible for review');
  assert.equal(parsed.shipments.filter((r) => r.sourceNotes).length, 10, 'all source cell notes retained');
  assert.equal(parsed.shipments.filter((r) => r.invoiceNo).length, 9, 'all invoice metadata retained');
  const invoice = parsed.shipments.find((r) => r.origin.excelRow === 473)!;
  const roundTrip = jsonToShipment(shipmentToJson(invoice));
  assert.equal(roundTrip.taxId, '308000738');
  assert.equal(roundTrip.invoiceNo, '395');
  assert.equal(roundTrip.invoiceStatus, 'ОТПРАВЛЕНО');
  assert.equal(roundTrip.note, invoice.note);
  const annotated = parsed.shipments.find((r) => r.origin.excelRow === 406)!;
  assert.match(jsonToShipment(shipmentToJson(annotated)).sourceNotes!, /E406:.*\n3\/9 da sotilgan/);
  assert.equal(parsed.factoryPayments[0].payer, 'Септем Алока', 'correctly spelled Плательщик header');
  assert.equal(parsed.declared.clientBalances?.palletsTaken, 8551, 'filtered SUBTOTAL is not the full-book total');

  // The old XLSX input path remains supported, including formula cache types,
  // zero, notes, and the alternative Excel date epoch.
  const sample = new ExcelJS.Workbook();
  sample.properties.date1904 = true;
  const sheet = sample.addWorksheet('Types');
  sheet.getCell('A1').value = { formula: '1-1', result: 0 };
  sheet.getCell('B1').value = { formula: '"Клиент"', result: 'Клиент' };
  sheet.getCell('C1').value = new Date('2026-09-15T00:00:00Z');
  sheet.getCell('C1').numFmt = 'dd.mm.yyyy';
  sheet.getCell('D1').value = 12.5;
  sheet.getCell('D1').note = 'Historical source note';
  sheet.getCell('E1').value = { error: '#VALUE!' };
  const reader = await WorkbookReader.fromBuffer(Buffer.from(await sample.xlsx.writeBuffer()));
  const ws = reader.worksheet('Types')!;
  assert.equal(reader.cell(ws, 1, 1).v, 0);
  assert.equal(reader.cell(ws, 1, 1).f, '1-1');
  assert.equal(reader.cell(ws, 1, 2).v, 'Клиент');
  assert.equal(readDate(reader.cell(ws, 1, 3))?.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(ws.getCell('D1').note, 'Historical source note');
  assert.throws(() => readCell(ws.getCell('E1')), InvalidCellError, 'Excel error must not become a zero');
  assert.equal(readDate({ t: 's', v: '31.02.2026' }), null);
  assert.equal(readDate({ t: 's', v: '29.02.2024' })?.toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(readDate({ t: 'n', v: 46280.9 })?.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(readInt({ t: 'n', v: 1.5 }), 1.5, 'fractional pallets reach validation without rounding');
  assert.equal(readMoney({ t: 's', v: '163,350,000' }).value?.toString(), '163350000');
  assert.equal(readMoney({ t: 's', v: '1,5' }).value?.toString(), '1.5');
  await assert.rejects(WorkbookReader.fromBuffer(Buffer.from('not a workbook')), TemplateMismatchError);
  await assert.rejects(WorkbookReader.fromBuffer(Buffer.from('504b0304abcdef', 'hex')), TemplateMismatchError);

  const dict = Dictionary.from({ ...parsed.master, clients: [
    { origin: { sheetName: 'test', excelRow: 1 }, officialName: 'First', variants: ['Second'], legacyKey: '', agentName: '' },
    { origin: { sheetName: 'test', excelRow: 2 }, officialName: 'Second', variants: [], legacyKey: '', agentName: '' },
  ] });
  assert.equal(dict.resolveClient('Second').canonical, 'Second', 'official names take priority over aliases');
  console.log('Workbook reader regressions passed (XLSB + XLSX, filtered totals, metadata, missing client, dates, cell errors).');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
