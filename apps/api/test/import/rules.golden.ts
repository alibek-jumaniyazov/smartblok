/**
 * ═══════ QOIDALAR GOLDEN — shablon v5 ═══════
 *
 * Ikki savol:
 *   (a) HAQIQIY «Smart blok.xlsx» ustida qoidalar to'g'ri javob beradimi — ya'ni toza
 *       faylda to'siq (BLOCK) yo'q, lekin faylning O'ZI biladigan g'alatiliklar
 *       («Текширув» varag'idagi ortiqcha poddon, tugallanmagan qatorlar) AYTILADI;
 *   (b) sun'iy buzilgan qatorlarda tegishli qoida ISHLAYDIMI — aks holda «xato yo'q»
 *       degan yashil natija qoidaning o'lganini yashirib turardi.
 *
 *   cd apps/api && npx tsx test/import/rules.golden.ts ["<abs xlsx>"]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { parseWorkbook } from '../../src/import/import.service';
import { Dictionary } from '../../src/import/resolve/dictionary';
import { runRules, countByRule } from '../../src/import/rules/validate.service';
import { DEFAULT_RULES_CONFIG } from '../../src/import/rules/config';
import type { ParsedWorkbook } from '../../src/import/parse/types';

const D = Prisma.Decimal;
const XLSX = process.argv[2] ?? join(__dirname, '../../../../docs/Smart blok.xlsx');

let checks = 0;
let failures = 0;
const eq = (actual: unknown, expected: unknown, label: string) => {
  checks++;
  if (actual !== expected) { failures++; console.error(`  ✗ ${label}: kutilgan ${expected}, keldi ${actual}`); }
  else console.log(`  ✓ ${label} = ${expected}`);
};
const ok = (cond: boolean, label: string) => {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${label}`); } else console.log(`  ✓ ${label}`);
};

const ctxOf = (p: ParsedWorkbook) => ({ ...p, dict: Dictionary.from(p.master), cfg: DEFAULT_RULES_CONFIG });
/** chuqur nusxa — sun'iy buzish asl obyektga tegmasin */
const clone = (p: ParsedWorkbook): ParsedWorkbook => ({
  ...p,
  shipments: p.shipments.map((r) => ({ ...r })),
  clientPayments: p.clientPayments.map((r) => ({ ...r })),
  factoryPayments: p.factoryPayments.map((r) => ({ ...r })),
  palletReturns: p.palletReturns.map((r) => ({ ...r })),
  factoryPalletReturns: p.factoryPalletReturns.map((r) => ({ ...r })),
  incomplete: [...p.incomplete],
});

async function main() {
  const base = await parseWorkbook(readFileSync(XLSX));

  console.log('\n— (a) HAQIQIY fayl —');
  const found = runRules(ctxOf(base));
  const by = countByRule(found);
  console.log(`     ${Object.entries(by).map(([k, n]) => `${k}:${n}`).join(' · ') || '(topilma yo`q)'}`);

  // TO'SIQ BO'LMASLIGI SHART: toza faylni import qilish uchun egasi hech nima
  // tuzatmasligi kerak. Bittasi chiqsa — parser yoki справочник buzilgan.
  eq(found.filter((f) => f.severity === 'BLOCK').length, 0, 'to`siq (BLOCK) yo`q');
  eq(by.MIJOZ_YOQ ?? 0, 0, 'справочникда yo`q mijoz yo`q');
  eq(by.ZAVOD_NOMALUM ?? 0, 0, 'справочникда yo`q zavod yo`q');
  eq(by.TOLOV_TURI_NOMALUM ?? 0, 0, 'tanilmagan to`lov turi yo`q');
  eq(by.TRANSPORT_TOLOVCHI_NOMALUM ?? 0, 0, 'tanilmagan «Расход Авто» yo`q');
  eq(by.FORMULA_FARQI ?? 0, 0, 'fayldagi hisoblangan kataklar mos');
  eq(by.JAMI_FARQI ?? 0, 0, 'yig`indilar egasining varag`i bilan mos');

  // …LEKIN faylning O'ZI biladigan g'alatiliklar AYTILISHI shart.
  eq(by.QATOR_TOLIQ_EMAS ?? 0, 7, 'tugallanmagan qatorlar sanab berildi');
  // «Текширув» varag'ining 1-bo'limi 7 ta mijozni sanaydi — biz ham shuncha topamiz
  eq(by.PADDON_ORTIQCHA ?? 0, 7, 'ortiqcha poddonli mijozlar («Текширув» §1 bilan bir xil)');
  eq(by.ZAVOD_PADDON_PULI ?? 0, 1, 'Excel bilan farq (zavod poddon puli) izohlandi');
  ok((by.AGENT_FARQI ?? 0) === 0, 'varaqdagi agent справочник bilan hamma joyda bir xil');

  console.log('\n— (b) sun`iy buzilgan qatorlarda qoidalar ishlaydimi —');

  { // MIJOZ_YOQ
    const p = clone(base);
    p.shipments[0].clientRaw = 'Umuman yo`q mijoz';
    const f = runRules(ctxOf(p)).filter((x) => x.ruleId === 'MIJOZ_YOQ');
    eq(f.length, 1, 'MIJOZ_YOQ ishladi');
    eq(f[0].severity, 'BLOCK', 'MIJOZ_YOQ to`siq');
  }
  { // ZAVOD_NOMALUM
    const p = clone(base);
    p.shipments[0].factoryRaw = 'Boshqa zavod';
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'ZAVOD_NOMALUM'), 'ZAVOD_NOMALUM ishladi');
  }
  { // TOLOV_TURI_NOMALUM
    const p = clone(base);
    p.shipments[0].factoryPayChannel = 'nimadir';
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'TOLOV_TURI_NOMALUM'), 'TOLOV_TURI_NOMALUM ishladi');
  }
  { // TRANSPORT_TOLOVCHI_NOMALUM
    const p = clone(base);
    p.shipments[0].transportPayerRaw = '';
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'TRANSPORT_TOLOVCHI_NOMALUM'), 'TRANSPORT_TOLOVCHI_NOMALUM ishladi');
  }
  { // YUK_MAJBURIY_MAYDON
    const p = clone(base);
    p.shipments[0].cube = 0;
    p.shipments[1].date = null;
    const f = runRules(ctxOf(p)).filter((x) => x.ruleId === 'YUK_MAJBURIY_MAYDON');
    ok(f.length >= 2, 'YUK_MAJBURIY_MAYDON hajm va sana yo`qligini topdi');
  }
  { // FORMULA_FARQI — keshlangan katak eskirgan
    const p = clone(base);
    p.shipments[0].saleSumDeclared = new D(1);
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'FORMULA_FARQI'), 'FORMULA_FARQI ishladi');
  }
  { // TOLOV_KANALI_YOQ — jami bor, kanal ustunlari bo`sh
    const p = clone(base);
    const pay = p.clientPayments[0];
    pay.bank = null; pay.cash = null; pay.click = null; pay.terminal = null;
    pay.totalDeclared = new D(1000000);
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'TOLOV_KANALI_YOQ'), 'TOLOV_KANALI_YOQ ishladi');
  }
  { // TAKRORIY_YUK
    const p = clone(base);
    p.shipments.push({ ...p.shipments[0], origin: { ...p.shipments[0].origin, excelRow: 9999 } });
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'TAKRORIY_YUK'), 'TAKRORIY_YUK ishladi');
  }
  { // MOSHINA_SIGIMI
    const p = clone(base);
    p.shipments[0].palletQty = 99;
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'MOSHINA_SIGIMI'), 'MOSHINA_SIGIMI ishladi');
  }
  { // USTAMA_CHEGARASI
    const p = clone(base);
    p.shipments[0].salePrice = (p.shipments[0].costPrice ?? new D(1)).mul(5);
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'USTAMA_CHEGARASI'), 'USTAMA_CHEGARASI ishladi');
  }
  { // AGENT_FARQI — qatordagi agent справочникдагиdan boshqa
    const p = clone(base);
    const dict = Dictionary.from(p.master);
    const own = dict.resolveClient(p.shipments[0].clientRaw).agentName;
    const other = p.master.agents.find((a) => a !== own);
    ok(!!other, 'sinov uchun boshqa agent topildi');
    p.shipments[0].agentRaw = other as string;
    ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'AGENT_FARQI'), 'AGENT_FARQI ishladi');
  }
  { // JAMI_FARQI — egasining yig`indisi boshqacha bo`lsa AYTILADI
    const p = clone(base);
    if (p.declared.clientBalances) {
      p.declared = { ...p.declared, clientBalances: { ...p.declared.clientBalances, palletsTaken: 1 } };
      ok(runRules(ctxOf(p)).some((x) => x.ruleId === 'JAMI_FARQI'), 'JAMI_FARQI ishladi');
    }
  }

  console.log(`\n${checks} tekshiruv, ${failures} xato`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
