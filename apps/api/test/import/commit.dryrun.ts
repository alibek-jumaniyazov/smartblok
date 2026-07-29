/**
 * DRY-RUN against a database (writes everything, then rolls back). The fastest proof that a
 * NEW workbook still reconciles — no API, no reset, no seed.
 *
 *   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test \
 *     npx tsx test/import/commit.dryrun.ts ["<abs xlsx path>"]
 *
 * SELF-VERIFYING: every expectation is recomputed from the workbook itself, so shipping a new
 * file just works. The absolute goldens this file used to carry («21 mashina», 501 414 039.36)
 * belonged to a workbook that was replaced twice — they failed on every real file since and
 * proved nothing about the current one.
 *
 * What it pins (the owner's own model):
 *   Олинган     = Σ (Блок Куб × Цена Приход)         — BLOCKS only; poddon is in-kind
 *   Берилган    = «Утказилган пул» blokining «Жами»   — rows outside that SUM are NOT imported
 *   qolgan      = Берилган − Олинган                 — «Завод» blokining pastki raqami
 *   zavod qarzi = Σ (mol − «Завотга толов»)          — «тўлов тури» kesimida
 *   Ост         = Σ Расход − Σ Приход                — agent svodkasi
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PaymentMethod, Prisma, PrismaClient } from '@prisma/client';
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import {
  parseJurnal, parseFactoryTransfers, parseFactoryDeclaredTotal, parseAgentSummary, parseFactorySummary,
} from '../../src/import/parse/jurnal.parser';
import { parseAgentSheets } from '../../src/import/parse/agent-sheet.parser';
import { matchName } from '../../src/import/resolve/matcher';
import { norm } from '../../src/import/resolve/normalize';
import { buildDaftarScope } from '../../src/import/resolve/daftar-scope';
import { runCommit, classifyOrderChannel } from '../../src/import/commit/import-commit.service';
import type { ShipmentRow } from '../../src/import/parse/types';

const D = Prisma.Decimal;
const DEFAULT_XLSX = join(__dirname, '../../../../docs/Smart blok.xlsx');

let fails = 0;
const fm = (v: unknown) => Number(v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `   (kutilgan ${want})`}`);
  if (!ok) fails++;
};
const eqNum = (label: string, got: unknown, want: unknown, eps = 0.5) => {
  const ok = Math.abs(Number(got ?? 0) - Number(want ?? 0)) <= eps;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${fm(got)}${ok ? '' : `   (kutilgan ${fm(want)})`}`);
  if (!ok) fails++;
};

const cost = (r: ShipmentRow) => (r.cube !== null && r.costPrice ? new D(String(r.cube)).mul(r.costPrice) : new D(0));
const paidOf = (r: ShipmentRow) => D.max(0, D.min(r.factoryPaid ?? new D(0), cost(r)));

async function main() {
  const wb = await WorkbookReader.fromFile(process.argv[2] ?? DEFAULT_XLSX);
  const prisma = new PrismaClient();

  const shipments = parseJurnal(wb);
  const transfers = parseFactoryTransfers(wb);
  const ledgers = parseAgentSheets(wb);
  const summary = parseAgentSummary(wb);
  const declaredTotal = parseFactoryDeclaredTotal(wb);
  const factorySummary = parseFactorySummary(wb);
  const payments = ledgers.flatMap((l) => l.clients.flatMap((c) => c.payments));

  // ── expectations, straight out of the file ──
  const olingan = shipments.reduce((a, r) => a.plus(cost(r)), new D(0));
  const counted = transfers.filter((t) => t.inDeclaredTotal);
  const skipped = transfers.filter((t) => !t.inDeclaredTotal);
  const berilgan = counted.reduce((a, t) => a.plus(t.amount ?? 0), new D(0));
  const perOrder = shipments.some((r) => r.factoryPaid !== null);
  const zavodgaTolangan = shipments.reduce((a, r) => a.plus(paidOf(r)), new D(0));
  const zavodQarzi = perOrder ? olingan.minus(zavodgaTolangan) : D.max(0, olingan.minus(berilgan));
  const byChannel = { naqd: { g: new D(0), p: new D(0), n: 0 }, otkazma: { g: new D(0), p: new D(0), n: 0 } };
  for (const r of shipments) {
    const m = classifyOrderChannel(r.factoryPayChannel);
    const s = m !== null && m !== PaymentMethod.BANK ? byChannel.naqd : byChannel.otkazma;
    s.g = s.g.plus(cost(r)); s.p = s.p.plus(paidOf(r)); s.n++;
  }
  const want = summary.reduce(
    (a, r) => ({ sales: a.sales.plus(r.sales ?? 0), paid: a.paid.plus(r.paid ?? 0), ost: a.ost.plus(r.balance ?? 0) }),
    { sales: new D(0), paid: new D(0), ost: new D(0) },
  );

  console.log(`FAYL: ${shipments.length} yuklama · ${transfers.length} o‘tkazma (${counted.length} «Жами»da) · ${ledgers.length} agent · ${payments.length} to‘lov`);
  console.log(`  Олинган ${fm(olingan)} · Берилган ${fm(berilgan)} → qolgan ${fm(berilgan.minus(olingan))}`);
  if (perOrder) {
    console.log(`  «Завотга толов»: to‘langan ${fm(zavodgaTolangan)} · qarz ${fm(zavodQarzi)}`);
    console.log(`     o‘tkazma ${byChannel.otkazma.n} ta: mol ${fm(byChannel.otkazma.g)} / qarz ${fm(byChannel.otkazma.g.minus(byChannel.otkazma.p))}`);
    console.log(`     naqd     ${byChannel.naqd.n} ta: mol ${fm(byChannel.naqd.g)} / qarz ${fm(byChannel.naqd.g.minus(byChannel.naqd.p))}`);
  }
  if (skipped.length) {
    console.log(`  «Жами» qamramagan: ${skipped.map((s) => `r${s.origin.excelRow} ${s.channel} ${fm(s.amount)}`).join(' · ')}`);
  }
  if (factorySummary) {
    console.log(`  Faylning «Завод» bloki: Олинган ${fm(factorySummary.goodsTaken)} · Берилган ${fm(factorySummary.transferred)} · qolgan ${fm(factorySummary.remaining)} (Нахт ${fm(factorySummary.remainingCash)} · банк ${fm(factorySummary.remainingBank)})`);
  }

  // ── resolution, mirroring ImportService.resolvedName ──
  const CANON = [...new Map(ledgers.flatMap((l) => l.clients.map((c) => [norm(c.clientRaw).key, c.clientRaw] as const))).values()];
  const agentByClientKey = new Map(ledgers.flatMap((l) => l.clients.map((c) => [norm(c.clientRaw).key, l.agentName] as const)));
  const agentNoByName = new Map(ledgers.map((l) => [l.agentName, l.clients.find((c) => c.agentNo != null)?.agentNo ?? null] as const));
  const scope = buildDaftarScope(ledgers.flatMap((l) => l.clients.map((c) => ({ clientRaw: c.clientRaw, agentName: l.agentName }))));
  // the agent that owns a row: the agent SHEET for a payment, journal col C for a shipment —
  // the same daftar the commit routes by, so «Нахт клент» stays one client PER agent
  const agentOfOrigin = new Map<string, string>();
  for (const l of ledgers) for (const c of l.clients) for (const p of c.payments) agentOfOrigin.set(`${p.origin.sheetName}|${p.origin.excelRow}`, l.agentName);
  for (const s of shipments) agentOfOrigin.set(`${s.origin.sheetName}|${s.origin.excelRow}`, s.agentRaw);
  const resolveClient = (raw: string, o: { sheetName: string; excelRow: number }): string => {
    if (!raw) return 'Nomaʼlum mijoz (import)';
    const m = matchName(raw, CANON);
    const plain = m.best && m.verdict !== 'none' ? m.best : raw;
    return scope.scopedName(plain, agentOfOrigin.get(`${o.sheetName}|${o.excelRow}`) ?? '');
  };

  console.log('\nDRY-RUN (hammasi yoziladi, keyin orqaga qaytariladi)…');
  const res = await runCommit(prisma, {
    batchId: randomUUID(), filename: 'dry-run', factoryName: 'Газоблок',
    shipments,
    clientPayments: payments,
    factoryPayments: transfers,
    resolveClient,
    agentForClient: (name) => agentByClientKey.get(norm(name).key) ?? null,
    agentSortNo: (name) => agentNoByName.get(name) ?? null,
  }, { dryRun: true });

  console.log('\n== KUTILAYOTGAN BAZA HOLATI (dry-run) ==');
  console.log(`  buyurtmalar: ${res.orders} (tannarxi aniq ${res.factoryOrdersSettled} · qisman ${res.factoryOrdersPartial} · to‘lanmagan ${res.factoryOrdersUnpaid})`);
  console.log(`  Sotuv jami:         ${fm(res.saleTotal)}`);
  console.log(`  Zavod tannarxi:     ${fm(res.costTotal)}`);
  console.log(`  Zavodga o‘tkazilgan:${fm(res.factoryPaidTotal)}`);
  console.log(`  Zavod qoldig‘i:     ${fm(res.factoryBalance)}  (qarz ${fm(res.factoryPayable)} · avans bank ${fm(res.factoryAdvanceBank)} · naqd ${fm(res.factoryAdvanceCash)})`);
  console.log(`  Mijoz to‘lovlari:   ${fm(res.clientPaidTotal)}`);
  console.log(`  Mijozlar qarzi:     ${fm(res.clientDebtTotal)}`);
  console.log(`  Shofyor qoldig‘i:   ${fm(res.vehicleBalance)}`);
  console.log(`  Poddon tashqarida:  ${res.palletsOut}`);
  for (const c of res.factoryByChannel) {
    console.log(`  kanal «${c.channel}»: ${c.orders} ta · mol ${fm(c.goods)} · to‘langan ${fm(c.paid)} · qarz ${fm(c.debt)}`);
  }

  console.log('\n== assertions ==');
  eq('buyurtmalar = jurnal qatorlari', res.orders, shipments.length);
  eqNum('Sotuv jami = Σ «Сумма Продажа»', res.saleTotal, shipments.reduce((a, r) => a.plus(r.saleSum ?? 0), new D(0)));
  eqNum('Олинган = Σ (Куб × Цена Приход)', res.costTotal, olingan);
  eqNum('Берилган = «Жами»', res.factoryPaidTotal, berilgan);
  if (declaredTotal) eqNum('«Жами» katagi bilan bir xil', res.factoryPaidTotal, declaredTotal);
  eqNum('Zavod qoldig‘i = Берилган − Олинган', res.factoryBalance, berilgan.minus(olingan));
  eqNum('yopilmagan mol qarzi = Σ (mol − «Завотга толов»)', new D(res.factoryPayable).negated(), zavodQarzi);
  eqNum('yopilgan mol puli = Σ «Завотга толов»', res.factorySettled, perOrder ? zavodgaTolangan : D.min(olingan, berilgan));
  eqNum('uchta cho‘ntak yig‘indisi = qoldiq',
    new D(res.factoryPayable).plus(res.factoryAdvanceBank).plus(res.factoryAdvanceCash), res.factoryBalance);
  eqNum('Mijoz to‘lovlari = Σ Приход', res.clientPaidTotal, want.paid);
  eqNum('Mijozlar qarzi = Σ Ост', res.clientDebtTotal, want.ost);
  eqNum('Sotuv = Σ Расход', res.saleTotal, want.sales);
  eq('Shofyor qoldig‘i 0 (hammasi «Туланди»)', res.vehicleBalance, '0.00');
  eq('Poddon tashqarida', res.palletsOut,
    shipments.reduce((a, r) => a + (r.palletQty ?? 0), 0) - payments.reduce((a, p) => a + Math.max(0, p.palletReturn ?? 0), 0));
  eq('«Жами»dan tashqarida qolgan qatorlar', res.factoryTransfersSkipped, skipped.length);
  eqNum('…ularning jami summasi', res.factoryTransfersSkippedTotal, skipped.reduce((a, t) => a.plus(t.amount?.abs() ?? 0), new D(0)));
  if (perOrder) {
    eqNum('naqd kanal qarzi', res.factoryByChannel.find((c) => c.channel === 'naqd')?.debt ?? 0, byChannel.naqd.g.minus(byChannel.naqd.p));
    eqNum('o‘tkazma kanal qarzi', res.factoryByChannel.find((c) => c.channel === "o'tkazma")?.debt ?? 0, byChannel.otkazma.g.minus(byChannel.otkazma.p));
    eq('«Завотга толов» toʼliq qoplandi', res.factoryUnfunded, '0.00');
  }

  // prove the dry-run left NOTHING behind
  const leaked = await prisma.order.count({ where: { orderNo: { startsWith: 'DRY-' } } });
  eq('dry-run hech narsa qoldirmadi', leaked, 0);

  await prisma.$disconnect();
  console.log(`\n${fails === 0 ? 'DRY-RUN BALANS ISBOTI O‘TDI ✓ — hisob-kitob aralashmaydi' : `${fails} ta YIQILDI ✗`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
