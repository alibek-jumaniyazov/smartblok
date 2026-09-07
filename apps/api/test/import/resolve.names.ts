/**
 * ═══════ AYNIYAT GOLDEN — «Кўрсаткичлар» справочниги hamma nomni qamraydimi ═══════
 *
 * Faylning O'ZIDA «Текширув» varag'ining 3-bo'limi bor: «СПРАВОЧНИКДА ЙЎҚ НОМЛАР — бу
 * рўйхатда ном бўлса, унинг суммаси ҳисобга кирмайди». Etalon faylda u olti ustunda ham
 * «— тўғри —» deydi, ya'ni egasi lug'atni to'liq deb hisoblaydi.
 *
 * Bu to'plam AYNAN o'sha da'voni mustaqil tekshiradi: Товар · Оплата · Поддон қайтариш
 * varaqlaridagi HAR BIR mijoz/agent/zavod nomi lug'atga tushishi shart. Bitta nom tushmasa,
 * import o'sha mijozning butun pulini «noma'lum» ga tashlaydi — va bu jimgina bo'ladi.
 *
 *   cd apps/api && npx tsx test/import/resolve.names.ts
 */
import { WorkbookReader } from '../../src/import/parse/workbook.reader';
import { parseMasterData } from '../../src/import/parse/master.parser';
import {
  parseShipments, parseClientPayments, parseFactoryPayments,
  parsePalletReturns, parseFactoryPalletReturns,
} from '../../src/import/parse/sheets.parser';
import { Dictionary } from '../../src/import/resolve/dictionary';

const FILE = process.env.WORKBOOK ?? '../../docs/Smart blok.xlsx';

let checks = 0;
let failures = 0;
const eq = (actual: unknown, expected: unknown, label: string) => {
  checks++;
  if (actual !== expected) { failures++; console.error(`  ✗ ${label}: kutilgan ${expected}, keldi ${actual}`); }
  else console.log(`  ✓ ${label} = ${expected}`);
};

async function main() {
  const wb = await WorkbookReader.fromFile(FILE);
  const master = parseMasterData(wb);
  const dict = Dictionary.from(master);

  const ships = parseShipments(wb).rows;
  const pays = parseClientPayments(wb).rows;
  const prets = parsePalletReturns(wb).rows;
  const fpays = parseFactoryPayments(wb).rows;
  const frets = parseFactoryPalletReturns(wb).rows;

  console.log('\n— mijoz nomlari uch varaqda ham lug`atga tushadimi —');
  const unresolved = new Map<string, string[]>();
  const note = (raw: string, where: string) => {
    const list = unresolved.get(raw) ?? [];
    if (list.length < 4) list.push(where);
    unresolved.set(raw, list);
  };
  const check = (raw: string, where: string) => {
    if (!raw.trim()) return;
    if (dict.resolveClient(raw).canonical === null) note(raw, where);
  };
  for (const s of ships) check(s.clientRaw, `Товар r${s.origin.excelRow}`);
  for (const p of pays) check(p.clientRaw, `Оплата r${p.origin.excelRow}`);
  for (const p of prets) check(p.clientRaw, `Поддон қайтариш r${p.origin.excelRow}`);
  if (unresolved.size) {
    for (const [raw, where] of unresolved) {
      const s = dict.resolveClient(raw).suggestion;
      console.error(`     «${raw}» — ${where.join(', ')}${s ? ` · taklif: «${s.name}» (${s.confidence})` : ''}`);
    }
  }
  eq(unresolved.size, 0, 'справочникda topilmagan mijoz nomlari');

  console.log('\n— nechta nom QANDAY topildi —');
  {
    const via = new Map<string, number>();
    const seen = new Set<string>();
    for (const raw of [...ships.map((s) => s.clientRaw), ...pays.map((p) => p.clientRaw), ...prets.map((p) => p.clientRaw)]) {
      if (!raw.trim() || seen.has(raw)) continue;
      seen.add(raw);
      const v = dict.resolveClient(raw).via;
      via.set(v, (via.get(v) ?? 0) + 1);
    }
    console.log(`     ${[...via].map(([k, n]) => `${k}: ${n}`).join(' · ')}`);
    eq(via.get('unknown') ?? 0, 0, 'noma`lum nom yo`q');
  }

  console.log('\n— agent va zavod nomlari —');
  {
    const badAgents = new Set<string>();
    for (const s of ships) if (s.agentRaw && !dict.resolveAgent(s.agentRaw)) badAgents.add(s.agentRaw);
    for (const p of pays) if (p.agentRaw && !dict.resolveAgent(p.agentRaw)) badAgents.add(p.agentRaw);
    if (badAgents.size) console.error(`     ${[...badAgents].join(' · ')}`);
    eq(badAgents.size, 0, 'справочникda topilmagan agent nomlari');

    const badFactories = new Set<string>();
    for (const s of ships) if (s.factoryRaw && !dict.resolveFactory(s.factoryRaw)) badFactories.add(s.factoryRaw);
    for (const p of fpays) if (p.factoryRaw && !dict.resolveFactory(p.factoryRaw)) badFactories.add(p.factoryRaw);
    for (const p of frets) if (p.factoryRaw && !dict.resolveFactory(p.factoryRaw)) badFactories.add(p.factoryRaw);
    if (badFactories.size) console.error(`     ${[...badFactories].join(' · ')}`);
    eq(badFactories.size, 0, 'справочникda topilmagan zavod nomlari');
  }

  console.log('\n— AGENT BIRIKTIRILISHI: varaqdagi agent lug`atdagisi bilan bir xilmi —');
  {
    // «Товар» varag'ining U/W ustunlari («Агент (бириктирилган)», «Рухсат этилган агент»)
    // AYNAN shu tekshiruvni formula bilan qiladi. Import ham xuddi shunday javob berishi
    // kerak, aks holda buyurtma boshqa agentning hisobiga tushib qoladi.
    let mismatch = 0;
    for (const s of ships) {
      const r = dict.resolveClient(s.clientRaw);
      if (!r.canonical) continue;
      const sheetAgent = dict.resolveAgent(s.agentRaw);
      if (sheetAgent && r.agentName && sheetAgent !== r.agentName) mismatch++;
    }
    eq(mismatch, 0, '«Товар» agenti справочник agentiga teng');

    let payMismatch = 0;
    for (const p of pays) {
      const r = dict.resolveClient(p.clientRaw);
      if (!r.canonical) continue;
      const sheetAgent = dict.resolveAgent(p.agentRaw);
      if (sheetAgent && r.agentName && sheetAgent !== r.agentName) payMismatch++;
    }
    eq(payMismatch, 0, '«Оплата» agenti справочник agentiga teng');
  }

  console.log('\n— lug`atning o`zi —');
  eq(dict.clients().length, 48, 'lug`atdagi mijozlar');
  eq(dict.agents().length, 6, 'lug`atdagi agentlar');
  eq(dict.factories().length, 2, 'lug`atdagi zavodlar');
  eq(dict.clients().every((c) => dict.agentForClient(c) !== null), true, 'har mijozning agenti bor');

  console.log(`\n${checks} tekshiruv, ${failures} xato`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
