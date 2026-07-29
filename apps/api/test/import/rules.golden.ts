/**
 * Rule-engine golden test: (a) the real «Smart blok.xlsx» produces exactly the expected
 * findings, (b) the new reconciliation rules fire correctly on synthetic anomalies.
 * Run:  npx tsx test/import/rules.golden.ts ["<abs xlsx>"]
 */
import { Prisma } from '@prisma/client';
import { join } from 'node:path';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseFactoryDeclaredTotal, parseJurnalDeclaredTotals, parseAgentSummary, factoryBlockHeaderExists } from '../../src/import/parse/jurnal.parser';
import { parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';
import { runRules, countByRule } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import type { RuleContext } from '../../src/import/rules/rule-registry';
import type { AgentLedger, ClientPaymentRow, ShipmentRow } from '../../src/import/parse/types';
import { norm } from '../../src/import/resolve/normalize';
import { classifyOrderChannel } from '../../src/import/commit/import-commit.service';

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
  transport: new D(2_000_000), transportWord: null, autoPaid: 'Туланди', izoh: '',
  // `null` = «this file has no «Завотга толов» column», the legacy shape most of these
  // synthetic cases exercise; the W/X cases below opt in explicitly.
  factoryPaid: null, factoryPayChannel: '', ...o,
});
const mkPay = (o: Partial<ClientPaymentRow>): ClientPaymentRow => ({
  origin: { sheetName: 'Agent A', excelRow: 7 }, no: 1, date: new Date('2026-06-25'),
  agentRaw: 'Agent A', agentNo: 1, clientRaw: 'Mijoz X', total: new D(1_000_000),
  payer: 'OOO Payer', palletReturn: null, blockName: '1-Mijoz X', note: '', ...o,
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
    factoryBlockPresent: factoryBlockHeaderExists(wb),
  });
  const findings = runRules(ctx);
  const byRule = countByRule(findings);
  console.log('== REAL FILE ==');
  console.log('  topilmalar:', JSON.stringify(byRule));

  // Expectations are DERIVED from the file, never frozen: what matters is that each rule
  // fires exactly where the data says it should, whichever workbook the owner ships.
  const paysAll = ctx.clientPayments;
  const facAll = ctx.factoryPayments;
  // Only the rows the block's own «Жами» adds up are money the factory received (owner rule,
  // 2026-07-29). Comparing the declared total against Σ of ALL parsed rows would now fail on
  // his own file, where the hand-typed SUM chain deliberately steps over two of them.
  const facCounted = facAll.filter((f) => f.inDeclaredTotal);
  const facSum = facCounted.reduce((a, f) => a.plus(f.amount ?? 0), new D(0));
  // These three are asserted SEPARATELY on purpose. When the «Утказилган пул» block changed
  // shape on 2026-07-27 the parser returned 0 rows and a null «Жами», so «ZAVOD_JAMI_FARQI → 0»
  // below passed VACUOUSLY — the rule short-circuits on a null declared total, i.e. "0 findings"
  // meant "the rule never ran". A count of zero is only meaningful once both sides exist.
  eq('«Утказилган пул» bloki o‘qildi', facAll.length > 0, true);
  eq('«Жами» katagi o‘qildi', declared != null, true);
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
  // «Жами» qamramagan har bir qator ATAB aytilishi shart — 56 000 000 jimgina tushib
  // qolmasligi uchun (egasining 2026-07-29 qarori: «Жами»ga amal qilinadi)
  eq(
    'ZAVOD_JAMIDAN_TASHQARI = «Жами»dan tashqaridagi qatorlar',
    byRule['ZAVOD_JAMIDAN_TASHQARI'] ?? 0,
    facAll.filter((f) => !f.inDeclaredTotal && f.amount && !f.amount.isZero()).length,
  );
  eq(
    'ZAVOD_TOLOV_TURI_NOMALUM = «тўлов тури» tanilmagan qatorlar',
    byRule['ZAVOD_TOLOV_TURI_NOMALUM'] ?? 0,
    ship.some((r) => r.factoryPaid !== null)
      ? ship.filter((r) => classifyOrderChannel(r.factoryPayChannel) === null).length
      : 0,
  );
  eq(
    'ZAVOD_TOLOVI_ORTIQCHA = mol narxidan ko‘p to‘langan qatorlar',
    byRule['ZAVOD_TOLOVI_ORTIQCHA'] ?? 0,
    ship.filter((r) => {
      const cost = r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : new D(0);
      return r.factoryPaid && r.factoryPaid.gt(cost.plus(1));
    }).length,
  );
  eq('ZAVOD_BLOKI_OQILMADI → 0 (blok o‘qildi)', byRule['ZAVOD_BLOKI_OQILMADI'] ?? 0, 0);
  eq('ZAVOD_KANALI_NOMALUM → 0 (hamma kanal tanildi)', byRule['ZAVOD_KANALI_NOMALUM'] ?? 0, 0);
  // ZAVOD_QOLDIGI is the card the owner ticks off Лист1 M159/N159 before committing, so its
  // number is asserted, not just its existence: «Берилган − Олинган».
  {
    const olingan = ship.reduce(
      (a, r) => (r.cube != null && r.costPrice ? a.plus(new D(String(r.cube)).mul(r.costPrice)) : a),
      new D(0),
    );
    const card = findings.find((f) => f.ruleId === 'ZAVOD_QOLDIGI');
    eq('ZAVOD_QOLDIGI = Берилган − Олинган', new D(String(card?.currentValue ?? 0)).toFixed(2), facSum.minus(olingan).toFixed(2));
  }

  // JAMLAMA_QATORI_NOTOGRI fires once per totals cell that disagrees with the rows.
  //
  // Which cells those are is a property of the FILE, not of the importer: the July workbook
  // carried two broken partial ranges (H153 = SUM(H4:H147), T153 = SUM(T4:T116)) and the
  // 2026-07-29 one carries none. Pinning the two labels froze a defect of a dead file into a
  // requirement, so this now checks the rule against the sheet's own SUM row — it must fire
  // for exactly the totals that really disagree, and stay silent for the rest.
  const jam = findings.filter((f) => f.ruleId === 'JAMLAMA_QATORI_NOTOGRI');
  const jamLabels = jam.map((f) => /(«[^»]+»)/.exec(f.message)?.[1] ?? '?').sort();
  console.log(`  jamlama farqlari: ${jamLabels.join(', ') || '—'}`);
  const sumOf = (f: (r: ShipmentRow) => Prisma.Decimal | null) => ship.reduce((a, r) => a.plus(f(r) ?? 0), new D(0));
  const rowCost = (r: ShipmentRow) => (r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : null);
  const gross = sumOf((r) => r.saleSum).minus(sumOf(rowCost));
  const expected: Array<[string, Prisma.Decimal | null | undefined, Prisma.Decimal]> = [
    ['«Блок Куб»', ctx.jurnalTotals?.cube, sumOf((r) => (r.cube === null ? null : new D(String(r.cube))))],
    ['«Сумма Приход»', ctx.jurnalTotals?.costSum, sumOf(rowCost)],
    ['«Сумма Продажа»', ctx.jurnalTotals?.saleSum, sumOf((r) => r.saleSum)],
    ['«Расход Авто»', ctx.jurnalTotals?.transport, sumOf((r) => r.transport)],
    ['«Общая прибль»', ctx.jurnalTotals?.grossProfit, gross],
    ['«Соф фойда»', ctx.jurnalTotals?.netProfit, gross.minus(sumOf((r) => r.transport))],
  ];
  for (const [label, declaredCell, actual] of expected) {
    const broken = !!declaredCell && declaredCell.minus(actual).abs().gte(1);
    eq(`${label} jamlamasi ${broken ? 'buzuq → ogohlantirish' : 'to‘g‘ri → jim'}`, jamLabels.includes(label), broken);
  }

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
    const ledger: AgentLedger = { driverDeclared: null,
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
    const ledger: AgentLedger = { driverDeclared: null,
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
    const ledger: AgentLedger = { driverDeclared: null,
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
      factoryPayments: [{ origin: { sheetName: 'Лист1', excelRow: 37 }, date: new Date('2026-06-25'), amount: new D(50), channel: 'bank', payer: '', receiver: '', inDeclaredTotal: true }],
      factoryDeclaredTotal: new D(100),
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'ZAVOD_JAMI_FARQI');
    eq('B7: «Жами» farqi → WARN', `${f.length}/${f[0]?.severity}`, '1/WARN');
  }

  // B9: the «Утказилган пул» kanal ustuni — the cell that decides which kassa the money left
  {
    const fac = (channel: string, row = 37, inDeclaredTotal = true) =>
      ({ origin: { sheetName: 'Лист1', excelRow: row }, date: new Date('2026-06-25'), amount: new D(50), channel, payer: '', receiver: '', inDeclaredTotal });
    const run = (rows: ReturnType<typeof fac>[], extra: Partial<Parameters<typeof mkCtx>[0]> = {}) =>
      runRules(mkCtx({ factoryPayments: rows, agentKeys: new Set(), ...extra })).filter((x) => x.ruleId === 'ZAVOD_KANALI_NOMALUM');

    eq('B9a: tanilgan kanallar → topilma yo‘q', run([fac('bank'), fac('naxt', 38), fac('click', 39)]).length, 0);
    const bad = run([fac('bank'), fac('bnak', 38)]);
    eq('B9b: notanish kanal → BLOCK', `${bad.length}/${bad[0]?.severity}`, '1/BLOCK');
    const blank = run([fac('bank'), fac('', 38)]);
    eq('B9c: kanal ustuni bor, katak bo‘sh → CONFIRM', `${blank.length}/${blank[0]?.severity}`, '1/CONFIRM');
    // a legacy 2-column workbook has NO channel anywhere — that is a valid shape, stay silent
    eq('B9d: eski 2-ustunli fayl → jim', run([fac(''), fac('', 38)]).length, 0);

    // B10: the block is present but nothing was read — the exact 2026-07-27 regression
    const dead = runRules(mkCtx({ factoryPayments: [], factoryBlockPresent: true, agentKeys: new Set() }))
      .filter((x) => x.ruleId === 'ZAVOD_BLOKI_OQILMADI');
    eq('B10a: blok bor, o‘tkazma yo‘q → BLOCK', `${dead.length}/${dead[0]?.severity}`, '1/BLOCK');
    eq('B10b: blok o‘qildi → jim', runRules(mkCtx({ factoryPayments: [fac('bank')], factoryBlockPresent: true, agentKeys: new Set() }))
      .filter((x) => x.ruleId === 'ZAVOD_BLOKI_OQILMADI').length, 0);
    eq('B10c: faylda blok yo‘q → jim', runRules(mkCtx({ factoryPayments: [], factoryBlockPresent: false, agentKeys: new Set() }))
      .filter((x) => x.ruleId === 'ZAVOD_BLOKI_OQILMADI').length, 0);
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

  // B11: «Завотга толов» / «тўлов тури» — the 2026-07-29 columns
  {
    // a row that HAS the column (factoryPaid non-null) is what switches the file into
    // per-order mode; a null one is a legacy sheet and must keep every rule silent
    const paid = (v: number | null, channel: string, row = 4) =>
      mkShip({ origin: { sheetName: 'Лист1', excelRow: row }, factoryPaid: v === null ? null : new D(v), factoryPayChannel: channel });
    const run = (rows: ShipmentRow[], id: string) =>
      runRules(mkCtx({ shipments: rows, agentKeys: new Set() })).filter((x) => x.ruleId === id);
    // mkShip's truck costs 32.832 × 500 000 = 16 416 000
    const FULL = 16_416_000;

    eq('B11a: eski fayl (ustun yo‘q) → «тўлов тури» so‘ralmaydi',
      run([paid(null, '')], 'ZAVOD_TOLOV_TURI_NOMALUM').length, 0);
    const blank = run([paid(FULL, 'Банк'), paid(0, '', 5)], 'ZAVOD_TOLOV_TURI_NOMALUM');
    eq('B11b: ustun bor, katak bo‘sh → CONFIRM', `${blank.length}/${blank[0]?.severity}`, '1/CONFIRM');
    const odd = run([paid(FULL, 'Банк'), paid(0, 'Кредит', 5)], 'ZAVOD_TOLOV_TURI_NOMALUM');
    eq('B11c: notanish so‘z → CONFIRM', `${odd.length}/${odd[0]?.severity}`, '1/CONFIRM');
    eq('B11d: «Банк» va «Нахт» tanildi', run([paid(FULL, 'Банк'), paid(0, 'Нахт', 5)], 'ZAVOD_TOLOV_TURI_NOMALUM').length, 0);

    const over = run([paid(FULL + 1_000_000, 'Банк')], 'ZAVOD_TOLOVI_ORTIQCHA');
    eq('B11e: mol narxidan ko‘p to‘lov → CONFIRM', `${over.length}/${over[0]?.severity}`, '1/CONFIRM');
    eq('B11f: to‘liq to‘lov → jim', run([paid(FULL, 'Банк')], 'ZAVOD_TOLOVI_ORTIQCHA').length, 0);

    // «Завотга толов» claims more than the block ever transferred
    const short = runRules(mkCtx({
      shipments: [paid(FULL, 'Банк')],
      factoryPayments: [{ origin: { sheetName: 'Лист1', excelRow: 200 }, date: new Date('2026-06-25'), amount: new D(1_000_000), channel: 'bank', payer: '', receiver: '', inDeclaredTotal: true }],
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'ZAVOD_TOLOVI_QOPLANMADI');
    eq('B11g: blokda pul yetmadi → WARN', `${short.length}/${short[0]?.severity}`, '1/WARN');

    // a transfer the «Жами» steps over must be NAMED, never silently dropped
    const outside = runRules(mkCtx({
      factoryPayments: [
        { origin: { sheetName: 'Лист1', excelRow: 195 }, date: new Date('2026-07-03'), amount: new D(6_000_000), channel: 'Нахт', payer: '', receiver: '', inDeclaredTotal: false },
        { origin: { sheetName: 'Лист1', excelRow: 197 }, date: new Date('2026-07-10'), amount: new D(300_000_000), channel: 'Банк', payer: '', receiver: '', inDeclaredTotal: true },
      ],
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'ZAVOD_JAMIDAN_TASHQARI');
    eq('B11h: «Жами»dan tashqaridagi qator → WARN', `${outside.length}/${outside[0]?.severity}`, '1/WARN');
    eq('B11i: …va u aynan o‘sha qator', outside[0]?.origin.excelRow, 195);

    // naqd is genuinely cheaper on the same day — TANNARX must compare like with like
    const mixed = runRules(mkCtx({
      shipments: [
        paid(FULL, 'Банк', 4), paid(FULL, 'Банк', 5), paid(FULL, 'Банк', 6),
        mkShip({ origin: { sheetName: 'Лист1', excelRow: 7 }, costPrice: new D(430_000), factoryPaid: new D(0), factoryPayChannel: 'Нахт' }),
        mkShip({ origin: { sheetName: 'Лист1', excelRow: 8 }, costPrice: new D(430_000), factoryPaid: new D(0), factoryPayChannel: 'Нахт' }),
      ],
      agentKeys: new Set(),
    })).filter((x) => x.ruleId === 'TANNARX_NARXNOMAGA_MOS_EMAS');
    eq('B11j: naqd narx bank narxiga taqqoslanmaydi', mixed.length, 0);
  }

  console.log(`\n${fails === 0 ? 'HAMMA QOIDA TEKSHIRUVI O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
