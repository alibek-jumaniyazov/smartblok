import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCountUp } from './useCountUp';
import { fmtNum } from '../../lib/format';

type Tone = 'teal' | 'amber' | 'green' | 'red' | 'blue' | 'violet' | 'slate';

const toneRing: Record<Tone, string> = {
  teal: 'text-brand-600 dark:text-brand-400',
  amber: 'text-accent-600 dark:text-accent-400',
  green: 'text-emerald-600 dark:text-emerald-400',
  red: 'text-red-600 dark:text-red-400',
  blue: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
  slate: 'text-ink-500 dark:text-ink-300',
};
const toneBg: Record<Tone, string> = {
  teal: 'bg-brand-500/12', amber: 'bg-accent-500/15', green: 'bg-emerald-500/12',
  red: 'bg-red-500/12', blue: 'bg-sky-500/12', violet: 'bg-violet-500/12', slate: 'bg-ink-500/12',
};
const toneGlow: Record<Tone, string> = {
  teal: 'bg-brand-500/20', amber: 'bg-accent-500/25', green: 'bg-emerald-500/20',
  red: 'bg-red-500/20', blue: 'bg-sky-500/20', violet: 'bg-violet-500/20', slate: 'bg-ink-500/15',
};

export function KpiCard({
  label, value, suffix = '', icon, tone = 'teal', delay = 0, hint, delta, hero = false,
}: {
  label: string; value: number; suffix?: string; icon?: ReactNode; tone?: Tone;
  delay?: number; hint?: string; delta?: number; hero?: boolean;
}) {
  const v = useCountUp(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className={cn(
        'hairline-top relative overflow-hidden rounded-xl2 border p-5',
        hero ? 'grad-hero border-white/10 text-white shadow-primary'
             : 'border-line bg-surface shadow-e1',
      )}
    >
      {hero && <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl" />}
      {hero && <div className="pointer-events-none absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-black/10 blur-2xl" />}
      {!hero && <div className={cn('pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl', toneGlow[tone])} />}
      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold uppercase tracking-wide', hero ? 'text-white/75' : 'text-muted')}>{label}</p>
          <p className="mt-2 text-[27px] font-extrabold leading-none tracking-tight tabular-nums">
            {fmtNum(Math.round(v))}
            {suffix && <span className={cn('ml-1 text-sm font-semibold', hero ? 'text-white/70' : 'text-faint')}>{suffix}</span>}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            {typeof delta === 'number' && (
              <span className={cn('inline-flex items-center gap-0.5 text-xs font-bold',
                delta >= 0 ? 'text-emerald-500' : 'text-red-500', hero && 'text-white')}>
                {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {Math.abs(delta)}%
              </span>
            )}
            {hint && <span className={cn('text-xs', hero ? 'text-white/75' : 'text-faint')}>{hint}</span>}
          </div>
        </div>
        {icon && (
          <div className={cn('shrink-0 rounded-xl p-2.5', hero ? 'bg-white/15 text-white ring-1 ring-white/20' : cn(toneBg[tone], toneRing[tone]))}>
            {icon}
          </div>
        )}
      </div>
    </motion.div>
  );
}
