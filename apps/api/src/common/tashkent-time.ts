/**
 * Business days/months are Asia/Tashkent (UTC+5, no DST) calendar units,
 * while DB timestamps are UTC. These helpers convert local boundaries to the
 * UTC instants that Prisma filters need. Shared by dashboard and reports.
 */
export const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

const toLocal = (d: Date) => new Date(d.getTime() + TASHKENT_OFFSET_MS);

/** UTC instant of today's Tashkent-local midnight. */
export function tashkentDayStart(now: Date = new Date()): Date {
  const l = toLocal(now);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - TASHKENT_OFFSET_MS);
}

/** UTC instant of the 1st of the current Tashkent-local month. */
export function tashkentMonthStart(now: Date = new Date()): Date {
  const l = toLocal(now);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - TASHKENT_OFFSET_MS);
}

/** UTC instant of Jan 1 of the current Tashkent-local year. */
export function tashkentYearStart(now: Date = new Date()): Date {
  const l = toLocal(now);
  return new Date(Date.UTC(l.getUTCFullYear(), 0, 1) - TASHKENT_OFFSET_MS);
}

/** [start, end) UTC window of a Tashkent-local calendar month; month = "YYYY-MM" (default: current). */
export function tashkentMonthWindow(
  month?: string,
  now: Date = new Date(),
): { start: Date; end: Date; month: string } {
  let y: number;
  let m: number;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    y = Number(month.slice(0, 4));
    m = Number(month.slice(5, 7)) - 1;
  } else {
    const l = toLocal(now);
    y = l.getUTCFullYear();
    m = l.getUTCMonth();
  }
  return {
    start: new Date(Date.UTC(y, m, 1) - TASHKENT_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - TASHKENT_OFFSET_MS),
    month: `${y}-${String(m + 1).padStart(2, '0')}`,
  };
}

/** Report lower bound: bare YYYY-MM-DD ⇒ that day's Tashkent-local midnight (UTC). */
export function parseTashkentFrom(v?: string): Date | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - TASHKENT_OFFSET_MS);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Report exclusive upper bound: bare YYYY-MM-DD ⇒ NEXT Tashkent-local midnight (whole day included). */
export function parseTashkentTo(v?: string): Date | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1) - TASHKENT_OFFSET_MS);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** 'YYYY-MM-DD' of a UTC instant, in Tashkent local time. */
export function tashkentDateStr(d: Date): string {
  return toLocal(d).toISOString().slice(0, 10);
}
