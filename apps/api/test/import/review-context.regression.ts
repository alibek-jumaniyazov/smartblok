import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../../src/import/import.service';
import { issueReviewContext } from '../../src/import/review-context';
import { shipmentToJson } from '../../src/import/serialize';

async function main() {
  const bytes = readFileSync(resolve(__dirname, '../../../../docs/Smart blok.xlsx'));
  const parsed = await parseWorkbook(bytes);
  const source = parsed.shipments.find((r) => r.origin.excelRow === 543)!;
  const json = shipmentToJson(source);
  const row = { kind: 'SHIPMENT' as const, sheetName: source.origin.sheetName, excelRow: 543, parsedJson: json, resolvedJson: json };
  const snapshot = { sourceLayout: parsed.sourceLayout, master: { clientEntries: parsed.master.clients, agents: parsed.master.agents, factories: parsed.master.factories } };
  const sale = issueReviewContext({ field: 'salePrice' }, row as never, snapshot, []);
  assert.equal(sale.guidance?.sourceCell, 'Товар!O543');
  assert.equal(sale.guidance?.unit, 'so‘m/m³');
  assert.equal(sale.context?.clientName, 'СКЛАДГА');
  assert.equal(sale.context?.agentName, 'Шохрух ога');
  assert.equal(sale.context?.factoryName, 'Ментора');
  assert.equal(sale.context?.date, '2026-09-25');
  assert.equal(sale.context?.costPrice, '605000');
  assert.equal(sale.context?.salePrice, null);
  assert.equal(sale.sourceValue, null);
  assert.equal(sale.effectiveValue, null);
  assert.ok(sale.guidance?.providedBy.includes('Шохрух ога'));
  assert.equal(issueReviewContext({ field: 'transportPayerRaw' }, row as never, snapshot, []).guidance?.sourceCell, 'Товар!Q543');

  // Review must reflect the final client selection and current values, retaining source evidence.
  const other = parsed.master.clients.find((c) => c.agentName !== 'Шохрух ога' && c.agentName)!;
  const changed = { ...row, resolvedJson: { ...json, resolvedClientName: other.officialName, salePrice: '720000', agentRaw: 'Шохрух ога' } };
  const resolved = issueReviewContext({ field: 'salePrice' }, changed as never, snapshot, []);
  assert.equal(resolved.context?.clientName, other.officialName);
  assert.equal(resolved.context?.agentName, other.agentName);
  assert.equal(resolved.context?.sourceAgentName, 'Шохрух ога');
  assert.equal(resolved.context?.sourceClientName, 'СКЛАДГА');
  assert.equal(resolved.sourceValue, null);
  assert.equal(resolved.effectiveValue, '720000');
  assert.equal(issueReviewContext({ field: 'salePrice' }, row as never, { master: snapshot.master }, []).guidance?.sourceCell, null, 'legacy batches never invent cell addresses');
  assert.equal(issueReviewContext({ field: null }, null, snapshot, []).context, null);

  // Move O to AB in a disposable in-memory workbook. The locator must follow the header.
  const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true });
  const sheet = workbook.Sheets['Товар'];
  for (const key of Object.keys(sheet)) {
    if (!/^O\d+$/.test(key)) continue;
    sheet[key.replace(/^O/, 'AB')] = sheet[key];
    delete sheet[key];
  }
  const range = XLSX.utils.decode_range(sheet['!ref']!); range.e.c = Math.max(range.e.c, 27);
  sheet['!ref'] = XLSX.utils.encode_range(range);
  const moved = await parseWorkbook(Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })));
  assert.equal(moved.sourceLayout?.SHIPMENT.columns.salePrice, 'AB');
  const located = issueReviewContext({ field: 'salePrice' }, row as never, { ...snapshot, sourceLayout: moved.sourceLayout }, []);
  assert.equal(located.guidance?.sourceCell, 'Товар!AB543');
  assert.equal(moved.shipments.length, 584);
  console.log('Import review context: exact cells, moved columns, original/resolved values and ownership passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
