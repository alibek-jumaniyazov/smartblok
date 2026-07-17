/**
 * Name-resolver golden test for the «Smart blok.xlsx» client registry: spelling
 * variants must resolve to the right canonical client, and genuinely-different
 * clients must NEVER auto-merge. Run:  npx tsx test/import/resolve.names.ts
 */
import { matchName, nameScore, AUTO } from '../../src/import/resolve/matcher';
import { norm } from '../../src/import/resolve/normalize';

// The 10 canonical clients (agent-daftar block headers, «N-» prefix stripped).
const CANON = [
  'Урганч Тамирлаш', 'Нормат Умидбек', 'Ирригатсия темир бетон', 'Инвест Холдинг',
  'Фидато Гроуп', 'Мурод ога Урганч', 'Сулаймон Ога Хазарасп', 'Гофур Хазорасп',
  'Рустам Шпик', 'Гайрат Штб',
];

let fails = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
}

// [raw spelling that could appear in the journal, expected canonical]
const CLEAR: [string, string][] = [
  ['УРГАНЧ ТАМИРЛАШ', 'Урганч Тамирлаш'], // case
  ['NORMAT UMIDBEK', 'Нормат Умидбек'], // Latin ↔ Cyrillic
  ['Гофур Хазарасп', 'Гофур Хазорасп'], // о/а drift
  ['Рустам шпик', 'Рустам Шпик'],
  ['Инвест холдинг', 'Инвест Холдинг'],
  ['Фидато Груп', 'Фидато Гроуп'], // гроуп/груп drift
];
const SUBSET: [string, string][] = [
  ['Фидато', 'Фидато Гроуп'],
  ['Сулаймон Хазарасп', 'Сулаймон Ога Хазарасп'],
];

console.log('== CLEAR variants → must auto-link to the right canonical ==');
for (const [raw, want] of CLEAR) {
  const m = matchName(raw, CANON);
  check(m.best === want && m.verdict === 'auto', `"${raw}" → "${want}"`, `[${m.best} · ${m.score.toFixed(3)} · ${m.verdict}]`);
}

console.log('\n== SUBSET variants → best correct, surfaced (auto OR suggest) ==');
for (const [raw, want] of SUBSET) {
  const m = matchName(raw, CANON);
  check(m.best === want && (m.verdict === 'auto' || m.verdict === 'suggest'), `"${raw}" → "${want}"`, `[${m.best} · ${m.score.toFixed(3)} · ${m.verdict}]`);
}

console.log('\n== DIFFERENT clients → must NOT auto-merge ==');
{
  // shares the token «Урганч» with «Урганч Тамирлаш» — still different clients
  const s = nameScore(norm('Мурод ога Урганч'), norm('Урганч Тамирлаш'));
  check(s < AUTO, `«Мурод ога Урганч» ≠ «Урганч Тамирлаш»`, `[score ${s.toFixed(3)} < ${AUTO}]`);
}
{
  // shares «Хазарасп/Хазорасп» with «Сулаймон Ога Хазарасп»
  const s = nameScore(norm('Гофур Хазорасп'), norm('Сулаймон Ога Хазарасп'));
  check(s < AUTO, `«Гофур Хазорасп» ≠ «Сулаймон Ога Хазарасп»`, `[score ${s.toFixed(3)} < ${AUTO}]`);
}
{
  const m = matchName('Гайрат Штб', CANON);
  check(m.best === 'Гайрат Штб' && m.verdict === 'auto', `"Гайрат Штб" o‘ziga to‘g‘ri keladi`, `[${m.best} · ${m.score.toFixed(3)}]`);
}

console.log('\n== agent-name-as-client guard (handled upstream, sanity only) ==');
{
  const m = matchName('Жамол 22-22', CANON);
  check(m.verdict !== 'auto', `agent "Жамол 22-22" mijozga auto-link bo‘lmaydi`, `[best ${m.best} · ${m.score.toFixed(3)} · ${m.verdict}]`);
}
{
  const m = matchName('Шохрух ога', CANON);
  check(m.verdict !== 'auto', `agent "Шохрух ога" mijozga auto-link bo‘lmaydi`, `[best ${m.best} · ${m.score.toFixed(3)} · ${m.verdict}]`);
}

console.log(`\n${fails === 0 ? 'HAMMA NOM-MOSLASH TEKSHIRUV O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
process.exit(fails === 0 ? 0 : 1);
