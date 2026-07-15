import { norm, Normalized, tokenWeight, vowelFold } from './normalize';

// ── string metrics ──

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array(a.length).fill(false);
  const bMatch = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = bMatch[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - t) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function damerau(a: string, b: string): number {
  const da: Record<string, number> = {};
  const maxDist = a.length + b.length;
  const d: number[][] = Array.from({ length: a.length + 2 }, () => new Array(b.length + 2).fill(0));
  d[0][0] = maxDist;
  for (let i = 0; i <= a.length; i++) {
    d[i + 1][0] = maxDist;
    d[i + 1][1] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    d[0][j + 1] = maxDist;
    d[1][j + 1] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    let db = 0;
    for (let j = 1; j <= b.length; j++) {
      const k = da[b[j - 1]] ?? 0;
      const l = db;
      let cost = 1;
      if (a[i - 1] === b[j - 1]) {
        cost = 0;
        db = j;
      }
      d[i + 1][j + 1] = Math.min(
        d[i][j] + cost,
        d[i + 1][j] + 1,
        d[i][j + 1] + 1,
        d[k][l] + (i - k - 1) + 1 + (j - l - 1),
      );
    }
    da[a[i - 1]] = i;
  }
  return d[a.length + 1][b.length + 1];
}

/** Token-level similarity: character transposition + vowel-confusion aware. */
export function tsim(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length) || 1;
  return Math.max(
    jaroWinkler(a, b),
    1 - damerau(a, b) / maxLen,
    jaroWinkler(vowelFold(a), vowelFold(b)) * 0.98,
  );
}

// ── name-level scoring ──

/** Weighted coverage: how much of `from`'s tokens are present in `to`'s tokens. */
function coverage(from: Normalized, to: Normalized): number {
  if (!from.tokens.length) return 0;
  let num = 0;
  let den = 0;
  for (const t of from.tokens) {
    const w = tokenWeight(t);
    den += w;
    const best = to.tokens.length ? Math.max(...to.tokens.map((u) => tsim(t, u))) : 0;
    num += w * best;
  }
  return den ? num / den : 0;
}

export interface NameScore {
  score: number;
  verdict: 'auto' | 'suggest' | 'ask' | 'none';
}

// First-import thresholds (tighten to 0.90 auto once ClientAlias has learned).
//   ≥AUTO    → silent LINK       ·  ≥SUGGEST → strong suggestion (owner confirms)
//   ≥ASK     → weak candidate the owner is ASKED about (Нахт клиент↔накд клент)
//   <ASK     → too weak to mean anything → treat as a NEW client, no spurious hint
export const AUTO = 0.95;
export const SUGGEST = 0.86;
export const ASK = 0.8;

export function verdictOf(score: number): NameScore['verdict'] {
  if (score >= AUTO) return 'auto';
  if (score >= SUGGEST) return 'suggest';
  if (score >= ASK) return 'ask';
  return 'none';
}

/** Symmetric name score in [0,1]. */
export function nameScore(a: Normalized, b: Normalized): number {
  if (a.key === b.key) return 1;
  return 0.5 * coverage(a, b) + 0.5 * coverage(b, a);
}

export interface Match {
  best: string | null;
  score: number;
  verdict: NameScore['verdict'];
  byPhone?: string;
}

/** Match a raw name against a set of canonical names; returns the best candidate + verdict. */
export function matchName(raw: string, canonicals: string[]): Match {
  const a = norm(raw);
  let best: string | null = null;
  let score = 0;
  for (const c of canonicals) {
    const s = nameScore(a, norm(c));
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return { best, score, verdict: verdictOf(score) };
}
