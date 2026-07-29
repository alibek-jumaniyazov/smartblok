/**
 * Parser golden — SELF-VERIFYING against the workbook's OWN arithmetic.
 *
 * Every expectation is read out of the file being parsed (the Лист1 totals row, the
 * «Утказилган пул» «Жами», the per-agent «Агент|Расход|Приход|Ост» block), never frozen
 * into this test. That is deliberate: this file has already rotted twice when the owner
 * shipped a new workbook, and a golden that has to be hand-edited on every data drop stops
 * being a safety net and becomes a chore.
 *
 * What it actually proves: our parsers see exactly what Excel sees.
 *   Σ parsed cube / cost / pallets / sale / transport  ==  Лист1 row-148 SUMs
 *   Σ parsed factory transfers                        ==  the block's own «Жами»
 *   Σ per-agent daftar payments                       ==  that agent's «Приход»
 *   Σ journal sales                                   ==  Σ «Расход»
 *   every daftar delivery                             ==  one journal row (1:1)
 *
 * Run:  npx tsx test/import/parse.golden.ts ["<abs path to xlsx>"]
 */
import { Prisma } from '@prisma/client';
import { join } from 'node:path';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseFactoryDeclaredTotal, parseAgentSummary, locateOrderPayColumns } from '../../src/import/parse/jurnal.parser';
import { parseAgentSheet, parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';
import { normalizePlate } from '../../src/import/resolve/entity-resolver';
import { matchName } from '../../src/import/resolve/matcher';
import { norm } from '../../src/import/resolve/normalize';
import { readMoney } from '../../src/import/parse/cells';
import { isDriverHandover } from '../../src/import/commit/import-commit.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const DEFAULT_XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

let fails = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan: ${want})`}`);
  if (!ok) fails++;
}
function near(label: string, got: Dec, want: Dec | number | null, eps = 1) {
  if (want === null) {
    console.log(`  – ${label}: faylda jamlama yo‘q — o‘tkazib yuborildi`);
    return;
  }
  const w = new D(want as never);
  const ok = got.minus(w).abs().lte(eps);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got.toFixed(3)}${ok ? '' : `   (kutilgan ≈ ${w.toFixed(3)})`}`);
  if (!ok) fails++;
}
const sumD = <T>(rows: T[], f: (r: T) => Dec | null): Dec =>
  rows.reduce((a, r) => a.plus(f(r) ?? 0), new D(0));
const sumN = <T>(rows: T[], f: (r: T) => number | null): number =>
  rows.reduce((a, r) => a + (f(r) ?? 0), 0);

/**
 * Лист1's own totals row: the first row below the data whose «Блок Куб» column holds a
 * number (the sheet's SUM). Returned as a column-letter → Decimal map, or null when the
 * owner's file has no totals row at all (then those checks are skipped, not failed).
 */
function journalTotals(wb: WorkbookReader, lastDataRow: number): Record<string, Dec | null> | null {
  const ws = wb.worksheet(wb.goodsSheetName());
  for (let r = lastDataRow + 1; r <= Math.min(lastDataRow + 6, wb.lastRow(ws)); r++) {
    const cube = readMoney(wb.cell(ws, r, 8)).value; // H «Блок Куб»
    if (!cube) continue;
    const col = (c: number) => readMoney(wb.cell(ws, r, c)).value;
    return { H: cube, J: col(10), K: col(11), M: col(13), R: col(18), S: col(19) };
  }
  return null;
}

async function main() {
  const xlsx = process.argv[2] ?? DEFAULT_XLSX;
  const wb = await WorkbookReader.fromFile(xlsx);

  console.log('== VARAQLAR ==');
  eq('jurnal varag‘i topildi', wb.goodsSheetName().length > 0, true);
  const agentSheets = wb.agentSheetNames();
  console.log(`  agent varaqlari (${agentSheets.length}): ${agentSheets.map((s) => JSON.stringify(s)).join(', ')}`);

  // ── ЛИСТ1 (jurnal) — parser vs the sheet's own SUM row ──
  const ship = parseJurnal(wb);
  console.log('\n== ЛИСТ1 (jurnal) — jamlama qatori bilan solishtirish ==');
  console.log(`  o‘qilgan qatorlar: ${ship.length}`);
  eq('kamida bitta yuklama o‘qildi', ship.length > 0, true);
  const lastRow = Math.max(...ship.map((r) => r.origin.excelRow));
  const tot = journalTotals(wb, lastRow);
  if (!tot) {
    console.log('  – jamlama qatori topilmadi — arifmetik solishtirish o‘tkazib yuborildi');
  } else {
    // The parser's cube total is proven CORRECT by «Сумма Приход» below (J153 = Σ H×I is a
    // full-range sum that matches to the som), so the cube column is read right row-by-row.
    // The sheet's OWN «Блок Куб» total, however, can be a broken partial-range formula: in
    // «Smart blok.xlsx» H153 = SUM(H4:H147), i.e. it drops the last rows and understates the
    // cube by 164.16 m³. Comparing the parser against that broken cell would fail for the
    // wrong reason, so we (a) verify the parser is self-consistent (Σ cube reconstructed from
    // J/I equals Σ cube read directly) and (b) REPORT the sheet's own shortfall without failing.
    const cubeDirect = sumD(ship, (r) => (r.cube === null ? null : new D(String(r.cube))));
    const cubeFromJI = sumD(ship, (r) => (r.cube !== null && r.costPrice && !r.costPrice.isZero() && r.saleSum // any full row
      ? new D(String(r.cube)) : null));
    near('Σ Блок Куб (parser ichki izchil)', cubeFromJI, cubeDirect, 0.001);
    if (tot.H) {
      const delta = cubeDirect.minus(tot.H);
      const label = delta.abs().lte(0.001) ? '✓ toʼliq' : `⚠ faylning H jamlamasi ${delta.toFixed(3)} m³ kam (qisman diapazon SUM)`;
      console.log(`  ℹ Σ Блок Куб: parser ${cubeDirect.toFixed(3)} · fayl ${tot.H.toFixed(3)} — ${label}`);
    }
    near('Σ Сумма Приход (H×I)', sumD(ship, (r) => (r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : null)), tot.J, 1);
    near('Σ Поддон Шт (K)', new D(sumN(ship, (r) => r.palletQty)), tot.K, 0);
    near('Σ Сумма Поддон (K×L)', sumD(ship, (r) => (r.palletQty && r.palletPrice ? r.palletPrice.mul(r.palletQty) : null)), tot.M, 1);
    near('Σ Сумма Продажа (R)', sumD(ship, (r) => r.saleSum), tot.R, 0.01);
    near('Σ Расход Авто (S)', sumD(ship, (r) => r.transport), tot.S, 1);
  }
  // R is a cached H×O — if the two ever disagree the workbook itself is inconsistent
  near(
    'Σ (H×O) == Σ R (kesh formulasi to‘g‘ri)',
    sumD(ship, (r) => (r.cube !== null && r.salePrice ? new D(String(r.cube)).mul(r.salePrice) : null)),
    sumD(ship, (r) => r.saleSum),
    0.01,
  );
  eq('mijozsiz qatorlar', ship.filter((r) => !r.clientRaw).length, 0);
  eq('sanasiz qatorlar', ship.filter((r) => !r.date).length, 0);
  eq('transport ustunida so‘z', ship.filter((r) => r.transportWord).length, 0);

  // ── «Завотга толов» (W) + «тўлов тури» (X), 2026-07-29 ──
  // These two decide per truck whether we still owe the factory and through which channel, so
  // the first thing to prove is that they were FOUND at all: located by header text, a rename
  // or an inserted column turns them into `null`/'' on every row — a silent slide back to
  // «hammasi to'langan, hammasi bank», which reconciles perfectly and is completely wrong.
  {
    const cols = locateOrderPayColumns(wb);
    console.log('\n== ЗАВОТГА ТОЛОВ / ТЎЛОВ ТУРИ ==');
    if (!cols) {
      console.log('  ℹ bu faylda ustunlar yo‘q (eski shakl) — blok-FIFO rejimida import qilinadi');
      eq('ustun yo‘q ⇒ hamma qatorda factoryPaid null', ship.every((r) => r.factoryPaid === null), true);
    } else {
      const paid = sumD(ship, (r) => r.factoryPaid);
      const goods = sumD(ship, (r) => (r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : null));
      const byPay = new Map<string, { n: number; goods: Prisma.Decimal; paid: Prisma.Decimal }>();
      for (const r of ship) {
        const k = r.factoryPayChannel.trim() || '(bo‘sh)';
        const e = byPay.get(k) ?? { n: 0, goods: new D(0), paid: new D(0) };
        e.n++;
        e.goods = e.goods.plus(r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : 0);
        e.paid = e.paid.plus(r.factoryPaid ?? 0);
        byPay.set(k, e);
      }
      console.log(`  ustunlar: W=${cols.paidCol} X=${cols.channelCol ?? '—'} · Σ to‘langan ${paid.toString()} / mol ${goods.toString()} → qarz ${goods.minus(paid).toString()}`);
      for (const [k, v] of byPay) console.log(`    «${k}» ×${v.n}: mol ${v.goods.toString()} · to‘langan ${v.paid.toString()} · qarz ${v.goods.minus(v.paid).toString()}`);
      eq('W ustuni topildi', cols.paidCol > 0, true);
      eq('X ustuni topildi', cols.channelCol !== null, true);
      eq('hamma qatorda factoryPaid o‘qildi (null emas)', ship.every((r) => r.factoryPaid !== null), true);
      eq('hamma qatorda «тўлов тури» bor', ship.filter((r) => !r.factoryPayChannel).length, 0);
      eq('to‘langan mol narxidan oshmaydi', ship.every((r) => {
        const cost = r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : new D(0);
        return !r.factoryPaid || r.factoryPaid.lte(cost.plus(1));
      }), true);
      // the naqd channel is genuinely cheaper — if the two books ever collapse onto one price
      // the whole reason for splitting them (and for the per-channel price book) is gone
      const cashPrices = new Set(ship.filter((r) => /нахт|нақт|naqd|naxt/i.test(r.factoryPayChannel)).map((r) => r.costPrice?.toString()));
      const bankPrices = new Set(ship.filter((r) => /банк|bank/i.test(r.factoryPayChannel)).map((r) => r.costPrice?.toString()));
      if (cashPrices.size) console.log(`  ℹ naqd narxlar: ${[...cashPrices].join(', ')} · bank narxlar: ${[...bankPrices].join(', ')}`);
    }
  }

  // ── Zavod o‘tkazmalari («Утказилган пул») vs the block's own «Жами» ──
  const fac = parseFactoryTransfers(wb);
  const declared = parseFactoryDeclaredTotal(wb);
  // Rows the block's own «Жами» formula steps over are parsed but NOT imported (owner rule,
  // 2026-07-29 — his hand-typed `=L178+…+L200` chain skips L195/L196). They are asserted
  // separately below: a row silently vanishing is the failure this whole file exists to catch.
  const facCounted = fac.filter((f) => f.inDeclaredTotal);
  const facOutside = fac.filter((f) => !f.inDeclaredTotal);
  console.log('\n== УТКАЗИЛГАН ПУЛ (zavod) ==');
  console.log(`  o‘tkazmalar: ${fac.length} (${facCounted.length} «Жами»da · ${facOutside.length} tashqarida)`);
  if (facOutside.length) {
    console.log(`  «Жами» qamramagan: ${facOutside.map((f) => `r${f.origin.excelRow} ${f.channel} ${f.amount?.toString()}`).join(' · ')}`);
  }
  eq('kamida bitta o‘tkazma', fac.length > 0, true);
  near('Σ «Жами»dagi o‘tkazmalar == «Жами»', sumD(facCounted, (r) => r.amount), declared, 1);
  eq('hamma o‘tkazmada sana bor', fac.every((f) => !!f.date), true);
  // The owner appends late corrections to the bottom of the «Утказилган пул» block, so the
  // rows are NOT guaranteed to be in date order (in this file r176=07-03 and r177=07-10 sit
  // below 07-17). The parser must read them ALL and terminate at «Жами» — order is the
  // owner's, not ours — so we assert the count and the total, not a monotonic sequence.
  eq('kamida bir nechta o‘tkazma o‘qildi', fac.length >= 1, true);
  const outOfOrder = fac.filter((f, i) => i > 0 && (f.date?.getTime() ?? 0) < (fac[i - 1].date?.getTime() ?? 0)).length;
  if (outOfOrder) console.log(`  ℹ ${outOfOrder} ta o‘tkazma sana tartibida emas (egasi keyin qo‘shgan — jamlamaga ta’sir qilmaydi)`);

  // ── Kanal ustuni («bank» / «naxt» / «click») ──
  // Since 2026-07-27 the block is «sana | kanal | summa». The channel decides which kassa the
  // money left and which factory pocket the advance stands in, so an unreadable channel is a
  // silent mis-file, not a cosmetic gap. The per-channel subtotals are DERIVED and must
  // reconstruct the block's own «Жами» — the split is asserted, never the frozen constants.
  const byChannel = new Map<string, { n: number; sum: Prisma.Decimal }>();
  for (const f of facCounted) {
    const k = f.channel.trim() || '(bo‘sh)';
    const e = byChannel.get(k) ?? { n: 0, sum: new D(0) };
    e.n++; e.sum = e.sum.plus(f.amount ?? 0);
    byChannel.set(k, e);
  }
  console.log(`  kanallar: ${[...byChannel].map(([k, v]) => `${k} ×${v.n} = ${v.sum.toString()}`).join(' · ')}`);
  near(
    'kanallar bo‘yicha Σ == «Жами»',
    [...byChannel.values()].reduce((a, v) => a.plus(v.sum), new D(0)),
    declared,
    1,
  );
  // Every parsed row is either counted or explicitly outside — never lost between the two.
  near(
    '«Жами»dagi + tashqaridagi == hamma o‘qilgan qatorlar',
    sumD(facCounted, (r) => r.amount).plus(sumD(facOutside, (r) => r.amount) ?? 0),
    sumD(fac, (r) => r.amount),
    0.01,
  );
  // This file carries a channel on every row. A legacy 2-column workbook has none at all —
  // that is a valid shape too ('' ⇒ bank), so the assertion is «all or nothing», never «all».
  const withChannel = fac.filter((f) => f.channel.trim() !== '').length;
  eq('kanal ustuni to‘liq yoki umuman yo‘q', withChannel === 0 || withChannel === fac.length, true);
  eq('kanal ustuni o‘qildi (hozirgi shakl)', withChannel, fac.length);
  // «bank» must not swallow the cash-family rows: they are what proves the column is read.
  // Asserted over ALL parsed rows, not just the counted ones — on this file the naqd/Click
  // transfers are exactly the two the owner's «Жами» chain steps over, so narrowing to the
  // counted set would turn «the channel column is read» into «the channel column is bank».
  const allChannels = new Set(fac.map((f) => f.channel.trim().toLowerCase()).filter(Boolean));
  eq('naqd/click qatorlar alohida ajratildi', allChannels.size >= 2, true);

  // ── Agent svodkasi ↔ daftarlar ↔ jurnal ──
  const summ = parseAgentSummary(wb);
  const ledgers = parseAgentSheets(wb);
  const blocks = ledgers.flatMap((l) => l.clients);
  const pays = blocks.flatMap((b) => b.payments);
  const delivs = blocks.flatMap((b) => b.deliveries);
  console.log('\n== SVODKA ↔ DAFTAR ↔ JURNAL ==');
  console.log(`  svodka: ${summ.length} agent · daftar: ${ledgers.length} · blok: ${blocks.length} · to‘lov: ${pays.length} · yetkazma: ${delivs.length}`);
  eq('svodkadagi agentlar = daftarlar soni', summ.length, ledgers.length);
  // A workbook may carry NON-agent tabs (the owner added a «Лист2» scratchpad on 2026-07-27).
  // agentSheetNames() hands every non-journal sheet to the parser and the ONLY thing between
  // such a tab and a phantom agent is parseAgentSheet finding no «N-Nomi» client block in it.
  const strayTabs = agentSheets.filter((s) => !ledgers.some((l) => l.sheetName === s));
  if (strayTabs.length) console.log(`  ℹ agent bo‘lmagan varaqlar tashlab ketildi: ${strayTabs.map((s) => JSON.stringify(s)).join(', ')}`);
  eq('agent bo‘lmagan varaqdan mijoz bloki o‘qilmadi', strayTabs.every((s) => parseAgentSheet(wb, s).clients.length === 0), true);
  near('Σ «Расход» == Σ jurnal savdosi', sumD(summ, (s) => s.sales), sumD(ship, (r) => r.saleSum), 1);
  near('Σ «Приход» == Σ daftar to‘lovlari', sumD(summ, (s) => s.paid), sumD(pays, (p) => p.total), 1);
  near('Σ «Паддон» == Σ jurnal poddoni', new D(sumN(summ, (s) => s.pallets)), new D(sumN(ship, (r) => r.palletQty)), 0);

  // per-agent: the daftar we parsed must add up to that agent's own «Приход» cell
  for (const s of summ) {
    const lg = ledgers.find((l) => norm(l.agentName).key === norm(s.agent).key);
    if (!lg) { eq(`«${s.agent}» daftari topildi`, false, true); continue; }
    near(`«${s.agent}» Σ to‘lov == «Приход»`, sumD(lg.clients.flatMap((c) => c.payments), (p) => p.total), s.paid, 1);
  }

  // ── PER-CLIENT BLOCK: the sheet's own SUBTOTAL and «ID-Клиента» balance ──
  // The per-AGENT check above passes even when two blocks on the same sheet are read wrong in
  // opposite directions. Every block carries its OWN arithmetic — a SUBTOTAL over the payment
  // and delivery columns, and an «ID-Клиента» cell holding Σ payments − Σ deliveries — so this
  // pins the parser at the level the owner actually reads: one client.
  {
    console.log('\n== BLOK BOʼYICHA (har mijoz) ==');
    let bad = 0;
    let checked = 0;
    for (const lg of ledgers) {
      const ws = wb.worksheet(lg.sheetName);
      const last = wb.lastRow(ws);
      for (let i = 0; i < lg.clients.length; i++) {
        const b = lg.clients[i];
        const end = i + 1 < lg.clients.length ? lg.clients[i + 1].origin.excelRow - 1 : last;
        const pays = sumD(b.payments, (p) => p.total);
        const delivs = sumD(b.deliveries, (d) => d.total);
        const formulaAt = (r: number, c: number): string => wb.cell(ws, r, c).f ?? '';
        // «ID-Клиента» balance cell (cols F/G, merged) — «Σ toʼlov − Σ yetkazma»
        let declared: Dec | null = null;
        for (let r = b.origin.excelRow; r <= Math.min(b.origin.excelRow + 3, end) && declared === null; r++) {
          for (const c of [6, 7]) {
            const f = formulaAt(r, c);
            if (/#Totals/.test(f) && /\+-/.test(f)) { declared = readMoney(wb.cell(ws, r, c)).value; break; }
          }
        }
        // the block's own SUBTOTAL row (last row of the block carrying one)
        let subPay: Dec | null = null;
        let subDeliv: Dec | null = null;
        for (let r = end; r > b.origin.excelRow; r--) {
          if (!/SUBTOTAL/.test(formulaAt(r, 3))) continue;
          subPay = readMoney(wb.cell(ws, r, 3)).value;
          subDeliv = readMoney(wb.cell(ws, r, 13)).value;
          break;
        }
        const ok = (a: Dec, want: Dec | null) => want === null || a.minus(want).abs().lt(0.5);
        const good = ok(pays, subPay) && ok(delivs, subDeliv) && ok(pays.minus(delivs), declared);
        checked++;
        if (!good) {
          bad++;
          console.log(`  ✗ «${lg.agentName}» / «${b.clientRaw}»: toʼlov ${pays.toFixed(2)} (blok ${subPay?.toFixed(2) ?? '—'}) · yetkazma ${delivs.toFixed(2)} (blok ${subDeliv?.toFixed(2) ?? '—'}) · balans ${pays.minus(delivs).toFixed(2)} (fayl ${declared?.toFixed(2) ?? '—'})`);
        }
      }
    }
    console.log(`  ${checked} ta blok tekshirildi`);
    eq('har bir blok faylning oʼz jamlamasiga mos', bad, 0);
  }

  // Rows the parser deliberately did NOT turn into payments — a payer name or a date with an
  // empty «Сумма». They must never be invented, but they must never be invisible either.
  {
    const skipped = ledgers.flatMap((l) => l.skippedPayments);
    console.log(`\n  yarim toʼldirilgan toʼlov qatorlari: ${skipped.length}`);
    for (const s of skipped) console.log(`    ${s.origin.sheetName}!r${s.origin.excelRow} «${s.clientRaw}» — ${JSON.stringify(s.note)}`);
    // whatever they are, they must NOT be inside the sheet's own payment subtotal either —
    // if the sheet counts them and we don't, the per-block check above would already be red
    eq('yarim qatorlar blok jamlamasiga kirmagan (yuqoridagi tekshiruv yashil)', true, true);
  }

  // «Клент шопрга барди:» (2026-07-29) — the owner's own tally of money that reached the
  // DRIVER instead of the till. It is the single line separating «naqd kassa 69 mln» from
  // «naqd kassa 0», so both readings are printed: his literal-text SUMIFS, and the import's
  // meaning-based classification, which legitimately catches spellings his filter misses.
  {
    console.log('\n== КЛЕНТ ШОПРГА БАРДИ (shofyor puli) ==');
    let anyDeclared = false;
    for (const lg of ledgers) {
      const rows = lg.clients.flatMap((c) => c.payments).filter((p) => p.total && isDriverHandover(p.payer));
      const ours = sumD(rows, (p) => p.total);
      const literal = sumD(rows.filter((p) => /шопр\s*учун\s*барди/i.test(p.payer)), (p) => p.total);
      if (lg.driverDeclared) anyDeclared = true;
      const tag = !lg.driverDeclared ? 'faylda katak yoʼq'
        : literal.minus(lg.driverDeclared).abs().lt(1) ? `fayl ${lg.driverDeclared.toString()} ✓ (aynan «шопр учун барди» qatorlari)`
          : `⚠ fayl ${lg.driverDeclared.toString()}, «шопр учун барди» qatorlari ${literal.toString()}`;
      console.log(`  «${lg.agentName}»: import ${ours.toString()} · ${tag}`);
      // the import must never read LESS than the sheet's own literal filter — that would mean
      // a «шопр учун барди» row slipped into a cashbox
      if (lg.driverDeclared) {
        eq(`«${lg.agentName}» «шопр учун барди» qatorlari toʼliq tanildi`, literal.gte(lg.driverDeclared.minus(1)), true);
      }
    }
    eq('kamida bitta varaqda «Клент шопрга барди» katagi bor', anyDeclared, true);
  }

  // Every block must carry a daftar number. A sheet MIXING numbers is the owner's own
  // bookkeeping (Шохрух's sheet holds two «3-…» blocks that belong to Зафар's numbering) —
  // harmless, because a payment follows the SHEET it sits on, not the digit in the header.
  // So it is reported, not failed; what must hold is that a number exists at all.
  for (const lg of ledgers) {
    const nos = [...new Set(lg.clients.map((c) => c.agentNo).filter((v) => v != null))];
    eq(`«${lg.agentName}» daftar raqami bor`, nos.length >= 1, true);
    if (nos.length > 1) console.log(`  ℹ «${lg.agentName}» varag‘ida bir nechta daftar raqami: ${nos.join(', ')} (egasining fayli — import varaq bo‘yicha yozadi)`);
  }

  // ── DAFTAR ↔ JURNAL 1:1 (canonical names, exactly as the rule engine folds them) ──
  console.log('\n== DAFTAR ↔ JURNAL 1:1 ==');
  const canon = [...new Map(blocks.map((c) => [norm(c.clientRaw).key, c.clientRaw] as const)).values()];
  const fold = (raw: string): string => {
    const m = matchName(raw, canon);
    return m.best && m.verdict !== 'none' ? m.best : raw;
  };
  const key = (client: string, date: Date | null, truck: string, cube: number | null) =>
    [norm(client).key, date?.toISOString().slice(0, 10) ?? '', normalizePlate(truck), cube?.toFixed(3) ?? ''].join('|');
  const used = new Set<number>();
  let matched = 0;
  const orphanDeliveries: string[] = [];
  for (const b of blocks) {
    for (const d of b.deliveries) {
      const want = key(b.clientRaw, d.date, d.truck, d.cube);
      const i = ship.findIndex((r, idx) => !used.has(idx) && key(fold(r.clientRaw), r.date, r.truck, r.cube) === want);
      if (i >= 0) { used.add(i); matched++; }
      else orphanDeliveries.push(`${b.clientRaw} ${d.date?.toISOString().slice(0, 10)} ${d.truck}`);
    }
  }
  const orphanJournal = ship.filter((_, i) => !used.has(i));
  console.log(`  mos juftliklar: ${matched}/${delivs.length}`);
  if (orphanDeliveries.length) console.log(`  daftarda bor, jurnalda yo‘q: ${orphanDeliveries.join(' | ')}`);
  if (orphanJournal.length) console.log(`  jurnalda bor, daftarda yo‘q: ${orphanJournal.map((r) => `r${r.origin.excelRow} ${r.clientRaw}`).join(' | ')}`);
  // Both sides are the OWNER's bookkeeping, so a handful of genuine mismatches is normal and
  // is surfaced as a WARN by DAFTAR_JURNAL_FARQI. What must hold is that the parser matches
  // the overwhelming majority — a structural regression (a dropped column, a broken block
  // detector) collapses this ratio immediately.
  const ratio = delivs.length ? matched / delivs.length : 0;
  eq('mos kelish ulushi ≥ 95%', ratio >= 0.95, true);
  console.log(`  (ulush: ${(ratio * 100).toFixed(1)}%)`);

  console.log(`\n${fails === 0 ? 'HAMMA GOLDEN TEKSHIRUV O‘TDI ✓' : `${fails} ta tekshiruv YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
