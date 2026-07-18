// Uzbek amount-in-words (0 … trillion) for formal money documents (receipts, the
// payment peek). ASCII apostrophes to match the app's uz-latn source strings.
const ONES = ['', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const TENS = ['', "o'n", 'yigirma', "o'ttiz", 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', "to'qson"];
const SCALES = ['', 'ming', 'million', 'milliard', 'trillion'];

function threeToWords(x: number): string {
  const parts: string[] = [];
  const h = Math.floor(x / 100);
  const t = Math.floor((x % 100) / 10);
  const o = x % 10;
  if (h) parts.push(ONES[h], 'yuz');
  if (t) parts.push(TENS[t]);
  if (o) parts.push(ONES[o]);
  return parts.join(' ');
}

/** «262014900» → «ikki yuz oltmish ikki million o'n to'rt ming to'qqiz yuz». */
export function sumToWordsUz(value: number | string): string {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'nol';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    // "ming" (not "bir ming"); higher scales keep "bir" (bir million …)
    const gw = i === 1 && g === 1 ? '' : threeToWords(g);
    words.push([gw, SCALES[i]].filter(Boolean).join(' '));
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}
