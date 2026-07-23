/**
 * Rule-engine golden test: (a) the real «Smart blok.xlsx» produces exactly the expected
 * findings, (b) the new reconciliation rules fire correctly on synthetic anomalies.
 * Run:  npx tsx test/import/rules.golden.ts ["<abs xlsx>"]
 */
import { Prisma } from '@prisma/client';
import { join } from 'node:path';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseFactoryDeclaredTotal, parseJurnalDeclaredTotals, parseAgentSummary } from '../../src/import/parse/jurnal.parser';
import { parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';
import { runRules, countByRule } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import type { RuleContext } from '../../src/import/rules/rule-registry';
import type { AgentLedger, ClientPaymentRow, ShipmentRow } from '../../src/import/parse/types';
import { norm } from '../../src/import/resolve/normalize';

const D = Prisma.Decimal;
const DEFAULT_XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};

// ── synthetic row factories ──
const mkShip = (o: Partial<ShipmentRow>): ShipmentRow => ({
  origin: { sheetName: 'Лист1', excelRow: 4 }, no: 1, supplier: 'Газоблок', agentRaw: 'Agent A',
  clientRaw: 'Mijoz X', date: new Date('2026-06-24'), truck: '01 A 111 AA', size: '600x300x200',
  cube: 32.832, costPrice: new D(500_000), palletQty: 19, palletPrice: new D(130_000),
  salePrice: new D(700_000), diff: new D(200_000), saleSum: new D('22982400'),
  transport: new D(2_000_000), transportWord: null, autoPaid: 'Туланди', izoh: '', ...o,
});
const mkPay = (o: Partial<ClientPaymentRow>): ClientPaymentRow => ({
  origin: { sheetName: 'Agent A', excelRow: 7 }, no: 1, date: new Date('2026-06-25'),
  agentRaw: 'Agent A', agentNo: 1, clientRaw: 'Mijoz X', total: new D(1_000_000),
  payer: 'OOO Payer', palletReturn: null, note: '', ...o,
});
const mkCtx = (o: Partial<RuleContext>): RuleContext => ({
  shipments: [], clientPayments: [], factoryPayments: [], ledgers: [], agentSummary: [],
  factoryDeclaredTotal: null,
  agentKeys: new Set([norm('Agent A').key]), cfg: DEFAULT_RULES_CONFIG, ...o,
});

async function main() {
  // ── A: real workbook ──
  const wb = await WorkbookReader.fromFile(process.argv[2] ?? DEFAULT_XLSX);
  const ship = parseJurnal(wb);
  const ledgers = parseAgentSheets(wb);
  const declared = parseFactoryDeclaredTotal(wb);
  const ctx = mkCtx({
    shipments: ship,
    clientPayments: ledgers.flatMap((l) => l.clients.flatMap((c) => c.payments)),
    factoryPayments: parseFactoryTransfers(wb),
    ledgers,
    agentSummary: parseAgentSummary(wb),
    factoryDeclaredTotal: declared,
    jurnalTotals: parseJurnalDeclaredTotals(wb, ship),
    agentKeys: new Set(ledgers.map((l) => norm(l.agentName).key)),
  });
  const findings = runRules(ctx);
  const byRule = countByRule(findings);
  console.log('== REAL FILE ==');
  console.log('  topilmalar:', JSON.stringify(byRule));

  // Expectations are DERIVED from the file, never frozen: what matters is that each rule
  // fires exactly where the data says it should, whichever workbook the owner ships.
  const paysAll = ctx.clientPayments;
  const facAll = ctx.factoryPayments;
  const facSum = facAll.reduce((a, f) => a.plus(f.amount ?? 0), new D(0));
  eq('«Жами» o‘qildi va Σ o‘tkazmalarga teng', declared?.toFixed(2), facSum.toFixed(2));

  // clean-data invariants — these must hold for ANY importable workbook
  eq('BLOCK darajali topilma yo‘q', findings.filter((f) => f.severity === 'BLOCK').length, 0);
  eq('MIJOZ_YOQ = mijozsiz qatorlar soni', byRule['MIJOZ_YOQ'] ?? 0, ship.filter((r) => !r.clientRaw).length);
  eq(
    'SANA_YOQ = sanasiz qatorlar soni',
    byRule['SANA_YOQ'] ?? 0,
    ship.filter((r) => !r.date).length + paysAll.filter((p) => !p.date && p.total).length + facAll.filter((f) => !f.date && f.amount).length,
  );
  eq('ZAVOD_JAMI_FARQI (Σ == «Жами») → 0', byRule['ZAVOD_JAMI_FARQI'] ?? 0, 0);
  eq('ZAVOD_QOLDIGI hisoboti chiqdi', byRule['ZAVOD_QOLDIGI'] ?? 0, 1);

  // JAMLAMA_QATORI_NOTOGRI fires once per totals cell that disagrees with the rows.
  // In «Smart blok.xlsx» exactly TWO of the eight totals are broken partial-range formulas:
  //   H153 «Блок Куб»    = SUM(H4:H147)  → understates cube by 164.16 m³
  //   T153 «Общая прибль» = SUM(T4:T116)  → understates gross profit by 84 344 960.016
  // and CRUCIALLY «Соф фойда» (V153 = SUM(V4:V152)) is a CORRECT full-range sum, so it must
  // NOT be flagged. «Сумма Продажа» (R153) and the other four are correct too.
  const jam = findings.filter((f) => f.ruleId === 'JAMLAMA_QATORI_NOTOGRI');
  const jamLabels = jam.map((f) => /(«[^»]+»)/.exec(f.message)?.[1] ?? '?').sort();
  console.log(`  jamlama farqlari: ${jamLabels.join(', ') || '—'}`);
  eq('«Сумма Продажа» jamlamasi to‘g‘ri (ogohlantirish yo‘q)', jamLabels.includes('«Сумма Продажа»'), false);
  eq('«Соф фойда» jamlamasi to‘g‘ri (ogohlantirish yo‘q — to‘liq diapazon)', jamLabels.includes('«Соф фойда»'), false);
  eq('«Блок Куб» buzuq SUM diapazoni topildi', jamLabels.includes('«Блок Куб»'), true);
  eq('«Общая прибль» buzuq SUM diapazoni topildi', jamLabels.includes('«Общая прибль»'), true);
  eq('aynan 2 ta jamlama xatosi', jamLabels.length, 2);

  // NARX_BUTUN_SON_EMAS fires once per non-integer sale price, and always edits saleSum
  const nonInteger = ship.filter((r) => r.salePrice && !r.salePrice.isInteger());
  const narx = findings.filter((f) => f.ruleId === 'NARX_BUTUN_SON_EMAS');
  eq('NARX_BUTUN_SON_EMAS = butun bo‘lmagan narxlar soni', narx.length, nonInteger.length);
  eq('NARX maydoni saleSum (yaxlitlash jamiga yoziladi)', narx.every((f) => f.field === 'saleSum'), true);
  eq(
    'NARX qatorlari aynan o‘sha qatorlar',
    narx.map((f) => f.origin.excelRow).sort((a, b) => a - b).join(','),
    nonInteger.map((r) => r.origin.excelRow).sort((a, b) => a - b).join(','),
  );

  // The daftar↔jurnal reconciliation folds spelling variants onto canonical block names.
  // A handful of genuine owner mismatches is expected; a NAME-MATCHING regression would
  // blow this up to dozens, so the guard is a share of the journal, not a fixed count.
  const daftarFarq = byRule['DAFTAR_JURNAL_FARQI'] ?? 0;
  eq('DAFTAR_JURNAL_FARQI jurnalning 5% idan kam', daftarFarq < ship.length * 0.05, true);
  console.log(`  (DAFTAR_JURNAL_FARQI: ${daftarFarq} / ${ship.length} qator)`);
  const agentFarq = byRule['AGENT_NOMI_FARQI'] ?? 0;
  eq('AGENT_NOMI_FARQI jurnalning 5% idan kam', agentFarq < ship.length * 0.05, true);
  console.log(`  (AGENT_NOMI_FARQI: ${agentFarq})`);

  // ── B: synthetic anomalies ──
  console.log('\n== SINTETIK ==');

  // B1: ledger delivery missing from journal + journal row missing from ledger
  {
    const ledger: AgentLedger = {
      sheetName: 'Agent A', agentName: 'Agent A',
      clients: [{
        origin: { sheetName: 'Agent A', excelRow: 1 }, agentNo: 1, clientRaw: 'Mijoz X', payments: [],
        deliveries: [
          { origin: { sheetName: 'Agent A', excelRow: 7 }, refNo: 1, date: new Date('2026-06-24'), truck: '01 A 111 AA', size: '600x300x200', cube: 32.832, palletQty: 19, price: new D(700_000), total: new D('22982400') }, // matches
          { origin: { sheetName: 'Agent A', excelRow: 8 }, refNo: 2, date: new Date('2026-06-26'), truck: '02 B 222 BB', size: '600x300x200', cube: 31.104, palletQty: 18, price: new D(700_000), total: new D('21772800') }, // NOT in journal
        ],
      }],
    };
    const c = mkCtx({
      shipments: [mkShip({}), mkShip({ origin: { sheetName: 'Лист1', excelRow: 5 }, truck: '03 C 333 CC', date: new Date('2026-06-27') })], // second NOT in ledger
      ledgers: [ledger],
    });
    const f = runRules(c).filter((x) => x.ruleId === 'DAFTAR_JURNAL_FARQI');
    eq('B1: 1 daftar-ortiqcha + 1 jurnal-ortiqcha', f.length, 2);
    eq('B1: daftar tomoni WARN', f[0]?.severity, 'WARN');
  }

  // B2: journal agent ≠ ledger agent → CONFIRM with the ledger agent suggested
  {
    const ledger: AgentLedger = {
      sheetName: 'Agent B', agentName: 'Agent B',
      clients: [{ origin: { sheetName: 'Agent B', excelRow: 1 }, agentNo: 2, clientRaw: 'Mijoz X', payments: [], deliveries: [] }],
    };
    const f = runRules(mkCtx({ shipments: [mkShip({ agentRaw: 'Agent A' })], ledgers: [ledger] }))
      .filter((x) => x.ruleId === 'AGENT_NOMI_FARQI');
    eq('B2: agent farqi topildi', f.length, 1);
    eq('B2: taklif = daftar agenti', f[0]?.suggestedValue, 'Agent B');
    eq('B2: maydon agentRaw', f[0]?.field, 'agentRaw');
  }

  // B3: pallet return exceeds delivered → CONFIRM
  {
    const f = runRules(mkCtx({
      shipments: [mkShip({ palletQty: 19 })],
      clientPayments: [mkPay({ clientRaw: 'Mijoz X', total: null, palletReturn: 25 })],
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'PODDON_QAYTARISH_ORTIQCHA');
    eq('B3: ortiqcha poddon qaytarish topildi', f.length, 1);
  }

  // B4: agent-name-as-client payment → BLOCK
  {
    const f = runRules(mkCtx({ clientPayments: [mkPay({ clientRaw: 'Agent A' })] }))
      .filter((x) => x.ruleId === 'MIJOZ_AGENT_NOMI');
    eq('B4: agent nomi mijoz sifatida → BLOCK', f[0]?.severity, 'BLOCK');
  }

  // B5: duplicate payment → WARN
  {
    const f = runRules(mkCtx({ clientPayments: [mkPay({}), mkPay({ origin: { sheetName: 'Agent A', excelRow: 9 } })], agentKeys: new Set() }))
      .filter((x) => x.ruleId === 'BIR_XIL_TOLOV');
    eq('B5: takror to‘lov → WARN', f.length, 1);
  }

  // B6: svod mismatch vs ledger sums → INFO
  {
    const ledger: AgentLedger = {
      sheetName: 'Agent A', agentName: 'Agent A',
      clients: [{
        origin: { sheetName: 'Agent A', excelRow: 1 }, agentNo: 1, clientRaw: 'Mijoz X',
        payments: [mkPay({ total: new D(5_000_000) })],
        deliveries: [{ origin: { sheetName: 'Agent A', excelRow: 7 }, refNo: 1, date: new Date('2026-06-24'), truck: '01 A 111 AA', size: '600x300x200', cube: 32.832, palletQty: 19, price: new D(700_000), total: new D('22982400') }],
      }],
    };
    const f = runRules(mkCtx({
      ledgers: [ledger],
      agentSummary: [{ origin: { sheetName: 'Лист1', excelRow: 37 }, agent: 'Agent A', sales: new D('99000000'), paid: new D(5_000_000), balance: null, pallets: 19 }],
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'SVOD_FARQI');
    eq('B6: svod sotuv farqi → INFO', `${f.length}/${f[0]?.severity}`, '1/INFO');
  }

  // B7: declared «Жами» ≠ Σ transfers → WARN
  {
    const f = runRules(mkCtx({
      factoryPayments: [{ origin: { sheetName: 'Лист1', excelRow: 37 }, date: new Date('2026-06-25'), amount: new D(50), payer: '', receiver: '' }],
      factoryDeclaredTotal: new D(100),
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'ZAVOD_JAMI_FARQI');
    eq('B7: «Жами» farqi → WARN', `${f.length}/${f[0]?.severity}`, '1/WARN');
  }

  // B8: missing dates → SANA_YOQ CONFIRM with a date editor
  {
    const f = runRules(mkCtx({
      shipments: [mkShip({ date: null })],
      clientPayments: [mkPay({ date: null })],
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'SANA_YOQ');
    eq('B8: 2 ta sanasiz qator topildi', f.length, 2);
    eq('B8: maydon date', f.every((x) => x.field === 'date'), true);
  }

  console.log(`\n${fails === 0 ? 'HAMMA QOIDA TEKSHIRUVI O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
