// lib/translit.ts — O'zbek lotin → kirill transliteratsiyasi.
// Loyihaning butun matni lotin o'zbekchada yozilgan; kirill tili shu matnni
// jonli tarzda transliteratsiya qilib olinadi (qo'lda tarjima kerak emas).
//
// Qoidalar (o'zbek kirill imlosi):
//   • Digraflar: sh→ш, ch→ч, yo→ё, yu→ю, ya→я, ye→е, ts→ц
//   • o'/g' (barcha apostrof variantlari) → ў/ғ
//   • tutuq belgisi (harflar orasidagi ') → ъ
//   • e → э (so'z boshida yoki unlidan keyin), aks holda → е
//   • {token} va %s/%d (interpolatsiya / format tokenlari) o'zgarmaydi
//   • harf bo'lmagan belgilar (raqam, tinish, bo'shliq) o'zgarmaydi

const DIGRAPHS: Record<string, string> = {
  yo: 'ё',
  yu: 'ю',
  ya: 'я',
  ye: 'е',
  ts: 'ц',
  sh: 'ш',
  ch: 'ч',
};

const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и',
  j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р',
  s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'х', y: 'й', z: 'з',
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
// ASCII ', typografik ' ' ' ʼ ʻ, va teskari urg'u ` — hammasi apostrof sifatida.
const APOS = new Set(["'", '’', '‘', 'ʼ', 'ʻ', '`']);

const isLatinLetter = (ch: string): boolean => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
const isUpperLetter = (ch: string): boolean => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

/** O'zbek lotin matnini kirillga o'giradi. Kirill/boshqa belgilar o'zgarmaydi. */
export function toCyrillic(input: string): string {
  if (!input) return input;
  const s = input;
  const n = s.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = s[i];

    // {interpolatsiya kaliti} — ichini o'zgartirmasdan ko'chiramiz
    if (ch === '{') {
      const close = s.indexOf('}', i);
      if (close !== -1) {
        out += s.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }

    // %s, %d kabi format tokenlari (dayjs relativeTime) — o'zgarmaydi
    if (ch === '%' && i + 1 < n) {
      out += ch + s[i + 1];
      i += 2;
      continue;
    }

    const lower = ch.toLowerCase();
    const upper = isUpperLetter(ch);

    // o' / g' → ў / ғ (keyingi belgi apostrof bo'lsa)
    if ((lower === 'o' || lower === 'g') && i + 1 < n && APOS.has(s[i + 1])) {
      const cyr = lower === 'o' ? 'ў' : 'ғ';
      out += upper ? cyr.toUpperCase() : cyr;
      i += 2;
      continue;
    }

    // ikki harfli digraflar
    if (isLatinLetter(ch) && i + 1 < n) {
      const two = (ch + s[i + 1]).toLowerCase();
      // "yo'" — bu ye+o' emas, y + o' ; shuning uchun apostrof kelsa digrafni o'tkazamiz
      const isYoBeforeApos = two === 'yo' && i + 2 < n && APOS.has(s[i + 2]);
      if (DIGRAPHS[two] && !isYoBeforeApos) {
        const cyr = DIGRAPHS[two];
        const secondUpper = isUpperLetter(s[i + 1]);
        let mapped: string;
        if (upper && secondUpper) mapped = cyr.toUpperCase();
        else if (upper) mapped = cyr.charAt(0).toUpperCase() + cyr.slice(1);
        else mapped = cyr;
        out += mapped;
        i += 2;
        continue;
      }
    }

    // yakka apostrof → harflar orasida bo'lsa tutuq belgisi (ъ)
    if (APOS.has(ch)) {
      const prev = i > 0 ? s[i - 1] : '';
      const next = i + 1 < n ? s[i + 1] : '';
      if (isLatinLetter(prev) && isLatinLetter(next)) out += 'ъ';
      i += 1;
      continue;
    }

    // yakka harf (e uchun maxsus qoida)
    if (SINGLE[lower]) {
      let cyr = SINGLE[lower];
      if (lower === 'e') {
        const prev = i > 0 ? s[i - 1].toLowerCase() : '';
        const wordInitial = !isLatinLetter(prev);
        cyr = wordInitial || VOWELS.has(prev) ? 'э' : 'е';
      }
      out += upper ? cyr.toUpperCase() : cyr;
      i += 1;
      continue;
    }

    // qolganlari o'zgarmaydi
    out += ch;
    i += 1;
  }

  return out;
}
