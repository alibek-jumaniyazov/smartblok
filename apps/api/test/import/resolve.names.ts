/**
 * Name-resolver golden test: the workbook's real spelling variants must resolve
 * to the right canonical client, and genuinely-different clients must NEVER
 * auto-merge. Run:  npx tsx test/import/resolve.names.ts
 */
import { matchName, nameScore, AUTO } from '../../src/import/resolve/matcher';
import { norm } from '../../src/import/resolve/normalize';

// The 24 canonical clients (per-client sheet titles, agent prefix stripped) +
// «Бунёдкор» (a real Товар client with no sheet, per the audit).
const CANON = [
  'Урганч Тамирлаш', 'Инвест Холдинг', 'Нормат Умидбек', 'Ирригатсия темир бетон',
  'Фидато Груп', 'Хонкага', 'Гофур Хазорасп', 'Шиддат маналит', 'Дастон шопир',
  'Сулаймон Ога Хазарасп', 'Мурод ога Урганч', 'Сарвар ога Шовот', 'Гайрат Штб',
  'Рустам Шпик', 'Элликкала Бостон', 'Жаср Версал', 'Мустафо машал',
  'Одилбек Ера хоус', 'Уткир мини', 'Отабек дамирчи', 'Журат ога хонка',
  'Мамун Университети', 'Уктир ога Шовот', 'накд клент', 'Бунёдкор',
];

let fails = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
}

// [raw spelling seen in Товар/Оплата, expected canonical]
const CLEAR: [string, string][] = [
  ['NORMAT UMIDBEK', 'Нормат Умидбек'],
  ['БУНЕДКОР', 'Бунёдкор'],
  ['Гофур хазорасп', 'Гофур Хазорасп'],
  ['Шиддат моналит', 'Шиддат маналит'],
  ['Мустофо курилиш Машал', 'Мустафо машал'],
  ['Жасур Версал', 'Жаср Версал'],
  ['94-353-18-02 эликкала бостон', 'Элликкала Бостон'],
  ['Журат Хонка', 'Журат ога хонка'],
];
const SUBSET: [string, string][] = [
  ['Фидато', 'Фидато Груп'],
  ['Одилбек ера', 'Одилбек Ера хоус'],
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
  const m = matchName('Нахт клиент', CANON);
  check(m.verdict !== 'auto', `"Нахт клиент" does NOT auto-link`, `[best ${m.best} · ${m.score.toFixed(3)} · ${m.verdict}]`);
}
{
  const s = nameScore(norm('Уткир мини'), norm('Уктир ога Шовот'));
  check(s < AUTO, `«Уткир мини» ≠ «Уктир ога Шовот»`, `[score ${s.toFixed(3)} < ${AUTO}]`);
  const m = matchName('Уткир мини', CANON);
  check(m.best === 'Уткир мини', `"Уткир мини" resolves to itself, not Уктир`, `[best ${m.best} · ${m.score.toFixed(3)}]`);
}

console.log('\n== agent-name-as-client guard (handled upstream, sanity only) ==');
{
  const m = matchName('Жамол 22-22', CANON);
  check(m.verdict !== 'auto', `agent "Жамол 22-22" doesn't auto-link to a client`, `[best ${m.best} · ${m.score.toFixed(3)} · ${m.verdict}]`);
}

console.log(`\n${fails === 0 ? 'HAMMA NOM-MOSLASH TEKSHIRUV O‘TDI ✓' : `${fails} ta YIQILDI ✗`}`);
process.exit(fails === 0 ? 0 : 1);
