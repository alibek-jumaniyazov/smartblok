import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'teal' | 'violet';

const tones: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted ring-ink-400/15',
  green: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
  red: 'bg-red-500/12 text-red-600 ring-red-500/20 dark:text-red-400',
  amber: 'bg-accent-500/15 text-accent-600 ring-accent-500/25 dark:text-accent-400',
  blue: 'bg-sky-500/12 text-sky-600 ring-sky-500/20 dark:text-sky-400',
  teal: 'bg-brand-500/12 text-brand-700 ring-brand-500/20 dark:text-brand-300',
  violet: 'bg-violet-500/12 text-violet-600 ring-violet-500/20 dark:text-violet-400',
};

export function Badge({ children, tone = 'neutral', className, dot }: { children: ReactNode; tone?: Tone; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

// Payment / transport status taxonomy
const statusMap: Record<string, { label: string; tone: Tone }> = {
  PAID: { label: "To'landi", tone: 'green' },
  UNPAID: { label: "To'lanmagan", tone: 'red' },
  PARTIAL: { label: 'Qisman', tone: 'amber' },
  DEBT: { label: 'Qarzdor', tone: 'red' },
  ADVANCE: { label: 'Avans', tone: 'green' },
  SETTLED: { label: 'Yopilgan', tone: 'neutral' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = statusMap[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}
