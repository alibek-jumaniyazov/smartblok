/**
 * Cyrillic/Latin name normalization for the workbook's spelling chaos:
 *   «Жасур Версал» vs «Жаср Версал» · «Нормат Умидбек» vs Latin "NORMAT UMIDBEK"
 *   «Бунёдкор» vs «БУНЕДКОР» (ё/е) · «Гофур Хазорасп» vs «хазорасп» (case, х/ҳ)
 *   «Шиддат моналит» vs «маналит» (vowel) · a client recorded as a phone number.
 * norm() collapses all of these to a comparable Latin key + pulls out any phone.
 */

// Uzbek/Russian Cyrillic → Latin. Digraphs (ч→ch, ш→sh) handled below.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ў: 'u', ф: 'f', х: 'x', ҳ: 'h', ц: 's', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Low-signal tokens (org suffixes, honorifics, filler) — down-weighted in scoring. */
export const WEAK_TOKENS = new Set([
  'oga', 'aka', 'ota', 'aka', 'grup', 'group', 'guruh', 'kurilish', 'qurilish',
  'mchj', 'ooo', 'mchi', 'xk', 'savdo', 'kompani', 'company', 'mega', 'stroy',
]);

export interface Normalized {
  key: string; // Latin, folded, space-separated tokens
  tokens: string[];
  phone?: string; // digits, when the raw name embedded a 7+ digit number
}

const CH = '';
const SH = '';

export function norm(raw: string): Normalized {
  let t = (raw ?? '').normalize('NFKC').toLowerCase().trim();

  // pull a phone out first (e.g. «94-353-18-02 эликкала бостон»)
  const digits = (t.match(/[\d][\d-]{5,}/g) ?? []).join('').replace(/\D/g, '');
  const phone = digits.length >= 7 ? digits : undefined;

  t = t.replace(/\d+/g, ' ').replace(/[«»"'`()[\].,/\\_—–\-]/g, ' ');
  t = [...t].map((c) => (c in TRANSLIT ? TRANSLIT[c] : c)).join('');

  // fold near-identical Latin renderings, protecting the ch/sh digraphs
  t = t.replace(/ch/g, CH).replace(/sh/g, SH);
  t = t.replace(/h/g, 'x').replace(/q/g, 'k').replace(/w/g, 'v').replace(/c/g, 's');
  t = t.replace(new RegExp(CH, 'g'), 'ch').replace(new RegExp(SH, 'g'), 'sh');

  t = t.replace(/(.)\1+/g, '$1'); // collapse doubles: ООО→o, элликкала→эликкала
  t = t.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

  const tokens = t ? t.split(' ') : [];
  return { key: t, tokens, phone };
}

/** Vowel-fold: unifies о/а and е/и confusion (моналит↔маналит, Уткир↔Уктир residue). */
export function vowelFold(s: string): string {
  return s.replace(/[aou]/g, 'a').replace(/[ei]/g, 'e');
}

export function tokenWeight(tok: string): number {
  return WEAK_TOKENS.has(tok) ? 0.15 : 1;
}
