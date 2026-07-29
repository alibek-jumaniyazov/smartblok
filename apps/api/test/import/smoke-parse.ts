// Quick parser smoke over the real workbook: npx tsx test/import/smoke-parse.ts [xlsx]
import { Prisma } from '@prisma/client';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseFactoryDeclaredTotal, parseAgentSummary, factoryBlockHeaderExists, locateOrderPayColumns, parseFactorySummary } from '../../src/import/parse/jurnal.parser';
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
  // «Завотга толов» / «тўлов тури» — located by header text, so «—» here means the owner
  // renamed or moved a column and every truck is about to be imported as «bank, fully paid».
  const payCols = locateOrderPayColumns(wb);
  const goods = ship.reduce((a, r) => a.plus(r.cube && r.costPrice ? r.costPrice.mul(String(r.cube)) : 0), new D(0));
  const paidToFactory = ship.reduce((a, r) => a.plus(r.factoryPaid ?? 0), new D(0));
  const chan = new Map<string, { n: number; goods: Prisma.Decimal; paid: Prisma.Decimal }>();
  for (const r of ship) {
    const k = r.factoryPayChannel.trim() || '(bo\'sh)';
    const e = chan.get(k) ?? { n: 0, goods: new D(0), paid: new D(0) };
    e.n++;
    e.goods = e.goods.plus(r.cube && r.costPrice ? r.costPrice.mul(String(r.cube)) : 0);
    e.paid = e.paid.plus(r.factoryPaid ?? 0);
    chan.set(k, e);
  }
  console.log('zavodga toʼlov ustunlari:', payCols ? `W=${payCols.paidCol} X=${payCols.channelCol ?? '—'}` : '— (eski fayl: blok-FIFO)',
    payCols ? `| Σ toʼlangan ${paidToFactory.toFixed(0)} / mol ${goods.toFixed(0)} → qarz ${goods.minus(paidToFactory).toFixed(0)}` : '');
  if (payCols) {
    for (const [k, v] of chan) console.log(`   «${k}» ×${v.n}: mol ${v.goods.toFixed(0)} · toʼlangan ${v.paid.toFixed(0)} · qarz ${v.goods.minus(v.paid).toFixed(0)}`);
  }

  const fac = parseFactoryTransfers(wb);
  const byChannel = new Map<string, number>();
  for (const f of fac) byChannel.set(f.channel.trim() || '(bo\'sh)', (byChannel.get(f.channel.trim() || '(bo\'sh)') ?? 0) + 1);
  const counted = fac.filter((f) => f.inDeclaredTotal);
  const outside = fac.filter((f) => !f.inDeclaredTotal);
  console.log('factory transfers:', fac.length, 'Σ:', fac.reduce((a, r) => a.plus(r.amount ?? 0), new D(0)).toFixed(0),
    '| channels:', [...byChannel].map(([k, v]) => `${k}×${v}`).join(' '));
  console.log('  «Жами»da:', counted.length, 'Σ:', counted.reduce((a, r) => a.plus(r.amount ?? 0), new D(0)).toFixed(0),
    '| «Жами» katagi:', parseFactoryDeclaredTotal(wb)?.toFixed(0) ?? '—');
  if (outside.length) {
    // Not an error — the owner's «Жами» is the declaration of what the factory received — but
    // it IS money leaving the import, so it must be on screen the first time anyone looks.
    console.log('  ⚠ «Жами» qamramagan (import QILINMAYDI):',
      outside.map((f) => `r${f.origin.excelRow} ${f.channel || '?'} ${f.amount?.toFixed(0)}`).join(' · '));
  }
  // This smoke is the first thing anyone runs on a new workbook, and it used to print
  // «factory transfers: 0» and still exit 0 — which is exactly how the 2026-07-27 layout
  // change (3 027 089 420 soʼm dropped) got past a human. A journal with rows but no
  // transfers is never a real state of this file.
  if (ship.length > 0 && fac.length === 0 && factoryBlockHeaderExists(wb)) {
    console.error('!! «Утказилган пул» bloki faylda bor, lekin birorta oʼtkazma oʼqilmadi — parser blok shakliga mos emas');
    process.exitCode = 1;
  }
  // the owner's own «Завод» arithmetic, quoted verbatim — this is the number he checks first
  const fs = parseFactorySummary(wb);
  if (fs) {
    console.log('«Завод» bloki (faylning oʼzi):',
      `Олинган ${fs.goodsTaken?.toFixed(0) ?? '—'} · Берилган ${fs.transferred?.toFixed(0) ?? '—'} · qolgan ${fs.remaining?.toFixed(0) ?? '—'}`,
      fs.remainingCash != null || fs.remainingBank != null
        ? `(Нахт ${fs.remainingCash?.toFixed(0) ?? '—'} · банк ${fs.remainingBank?.toFixed(0) ?? '—'})` : '');
  }
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
