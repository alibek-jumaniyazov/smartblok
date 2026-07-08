export function fmtUZS(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v)) + " so'm";
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(n ?? 0));
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtShort(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + ' mlrd';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + ' mln';
  if (abs >= 1e3) return (v / 1e3).toFixed(0) + ' ming';
  return String(Math.round(v));
}
