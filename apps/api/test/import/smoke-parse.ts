// Quick parser smoke over the real workbook: npx tsx test/import/smoke-parse.ts [xlsx]
import { Prisma } from '@prisma/client';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseAgentSummary } from '../../src/import/parse/jurnal.parser';
import { parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';

const D = Prisma.Decimal;
const XLSX = process.argv[2] ?? 'C:/Users/mello/Documents/GitHub/smartblok/docs/Smart blok.xlsx';

async function main() {
  const wb = await WorkbookReader.fromFile(XLSX);
  console.log('goods sheet:', wb.goodsSheetName(), '| agent sheets:', wb.agentSheetNames().join(', '));
  const ship = parseJurnal(wb);
  console.log('shipments:', ship.length,
    'ΣsaleSum:', ship.reduce((a, r) => a.plus(r.saleSum ?? 0), new D(0)).toFixed(2),
    'Σcost:', ship.reduce((a, r) => a.plus(r.cube && r.costPrice ? r.costPrice.mul(String(r.cube)) : 0), new D(0)).toFixed(0),
    'pallets:', ship.reduce((a, r) => a + (r.palletQty ?? 0), 0),
    'Σtransport:', ship.reduce((a, r) => a.plus(r.transport ?? 0), new D(0)).toFixed(0));
  const fac = parseFactoryTransfers(wb);
  console.log('factory transfers:', fac.length, 'Σ:', fac.reduce((a, r) => a.plus(r.amount ?? 0), new D(0)).toFixed(0));
  const summ = parseAgentSummary(wb);
  console.log('agent summary:', summ.map((s) => `${s.agent}: ${s.sales?.toFixed(0) ?? '-'} / ${s.paid?.toFixed(0) ?? '-'} / poddon ${s.pallets ?? '-'}`).join(' | '));
  const ledgers = parseAgentSheets(wb);
  for (const l of ledgers) {
    console.log(l.agentName, '->', l.clients.map((c) => `[${c.agentNo}]${c.clientRaw} p${c.payments.length} d${c.deliveries.length}`).join(' ; '));
  }
  const pays = ledgers.flatMap((l) => l.clients.flatMap((c) => c.payments));
  console.log('payments:', pays.length, 'Σ:', pays.reduce((a, p) => a.plus(p.total ?? 0), new D(0)).toFixed(0),
    'palletReturns:', pays.reduce((a, p) => a + (p.palletReturn ?? 0), 0));
}
main().catch((e) => { console.error(e); process.exit(1); });
