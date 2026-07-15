// lib/uz-cyrl.ts — o'zbek kirill AntD Locale + dayjs locale.
// Alohida qo'lda yozilmaydi: mavjud uz-latn paketini transliteratsiya qilib
// olinadi (translit.ts), shu bois lotin paket yangilansa kirill ham yangilanadi.
import type { Locale } from 'antd/es/locale';
import { toCyrillic } from './translit';
import { dayjsUzLatn, uzLatn } from './uz-latn';

// Sana format tokenlarini (DD.MM.YYYY, dayjs `formats`, `%s/%d`) VA kod/nomlarni
// saqlaydigan kalitlar — bularning qiymati transliteratsiya qilinmaydi
// (aks holda «DD.MM.YYYY» → «ДД.ММ.ЙЙЙЙ» bo'lib picker/sana buziladi).
const SKIP_KEYS = new Set<string>([
  'locale',
  'name',
  'formats', // dayjs L/LL/LLL… tokenlari (butun obyekt)
  'fieldDateFormat',
  'fieldDateTimeFormat',
  'fieldMonthFormat',
  'fieldYearFormat',
  'fieldWeekFormat',
  'fieldQuarterFormat',
  'yearFormat',
  'cellDateFormat',
  'cellQuarterFormat',
  'cellYearFormat',
  'dateFormat',
  'dateTimeFormat',
  'monthFormat',
  'weekFormat',
  'quarterFormat',
]);

// Tuzilmadagi barcha string qiymatlarni kirillga o'giradi; format tokenli
// kalitlarni (SKIP_KEYS) o'zgarmasdan qoldiradi.
function deepCyrillic<T>(value: T, key?: string): T {
  if (key && SKIP_KEYS.has(key)) return value;
  if (typeof value === 'string') return toCyrillic(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepCyrillic(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = deepCyrillic((value as Record<string, unknown>)[k], k);
    }
    return out as unknown as T;
  }
  return value;
}

const raw = deepCyrillic(uzLatn) as Locale;
// Picker'ning ichki dayjs locale nomini ro'yxatdan o'tgan 'uz-cyrl' ga bog'laymiz
// ('locale' kaliti SKIP_KEYS da — 'uz-latn' bo'lib qolgan edi).
const nested = raw as unknown as {
  DatePicker?: { lang?: { locale?: string } };
  Calendar?: { lang?: { locale?: string } };
};
if (nested.DatePicker?.lang) nested.DatePicker.lang.locale = 'uz-cyrl';
if (nested.Calendar?.lang) nested.Calendar.lang.locale = 'uz-cyrl';

export const uzCyrl: Locale = { ...raw, locale: 'uz-cyrl' };

// dayjs locale — oy/hafta nomlari kirillda, format tokenlari saqlangan.
export const dayjsUzCyrl: ILocale = { ...deepCyrillic(dayjsUzLatn), name: 'uz-cyrl' };
