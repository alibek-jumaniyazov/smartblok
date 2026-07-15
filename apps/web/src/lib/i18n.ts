// lib/i18n.ts — yengil, kutubxonasiz ko'p tillilik yadrosi.
//
// Manba til = o'zbek lotin (butun ilova shu tilda yozilgan). Kalit sifatida
// lotincha matnning O'ZI ishlatiladi — shu bois t() bilan o'ralmagan yoki
// lug'atda yo'q matn muloyimlik bilan o'zbek lotinga qaytadi.
//   • uz       → matnning o'zi
//   • uz-cyrl  → transliteratsiya (translit.ts) — to'liq qamrov, tarjimasiz
//   • ru / en  → i18n.dict.ts lug'ati (topilmasa — lotin fallback)
import { toCyrillic } from './translit';
import { DICT } from './i18n.dict';

export type LangCode = 'uz' | 'uz-cyrl' | 'ru' | 'en';

export interface LangMeta {
  code: LangCode;
  /** o'z tilidagi nomi (menyuda ko'rinadi) */
  native: string;
  /** ixcham kod (ЎЗ / RU …) */
  short: string;
}

export const LANGS: LangMeta[] = [
  { code: 'uz', native: "O'zbekcha", short: 'UZ' },
  { code: 'uz-cyrl', native: 'Ўзбекча', short: 'ЎЗ' },
  { code: 'ru', native: 'Русский', short: 'RU' },
  { code: 'en', native: 'English', short: 'EN' },
];

const VALID = new Set<string>(LANGS.map((l) => l.code));
export const STORAGE_KEY = 'sb_lang';

/** Transliteratsiyadan chetda qoladigan brend/token so'zlar (to'liq moslik). */
const KEEP = new Set(['SmartBlok', 'AI', 'USD', 'UZS', 'Click', 'Excel', 'ERP', 'OK']);

export function initialLang(): LangCode {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s && VALID.has(s)) return s as LangCode;
  } catch {
    /* SSR / storage yo'q */
  }
  return 'uz';
}

// Modul darajasidagi joriy til — hook ishlatolmaydigan joylar uchun
// (masalan lib/status-maps.ts enum yorliqlari). LangProvider sinxron saqlaydi.
let current: LangCode = initialLang();
export const getCurrentLang = (): LangCode => current;
export function setCurrentLang(l: LangCode): void {
  if (VALID.has(l)) current = l;
}

/** Bitta manba (o'zbek lotin) matnni tanlangan tilga o'giradi. */
export function translate(src: string, lang: LangCode = current): string {
  if (!src) return src;
  if (lang === 'uz') return src;
  if (lang === 'uz-cyrl') return KEEP.has(src) ? src : toCyrillic(src);
  const entry = DICT[src];
  if (entry) return lang === 'ru' ? entry.ru : entry.en;
  return src; // lotin fallback
}

/** {token} o'rniga qiymat qo'yadi. */
export function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export type TFn = (src: string, params?: Record<string, string | number>) => string;

/** Berilgan til uchun tayyor tarjima funksiyasini qaytaradi. */
export function makeT(lang: LangCode): TFn {
  return (src, params) => interpolate(translate(src, lang), params);
}
