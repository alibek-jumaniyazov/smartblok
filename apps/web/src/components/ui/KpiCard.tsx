import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { useCountUp } from './useCountUp';
import { fmtNum } from '../../lib/format';

export function KpiCard({
  label, value, suffix = '', icon, tone = 'amber', delay = 0, hint,
}: {
  label: string; value: number; suffix?: string; icon?: ReactNode;
  tone?: 'amber' | 'green' | 'red' | 'blue' | 'slate'; delay?: number; hint?: string;
}) {
  const v = useCountUp(value);
  const tones: Record<string, string> = {
    amber: 'from-brand-500/20 to-brand-500/0 text-brand-600 dark:text-brand-400',
    green: 'from-emerald-500/20 to-emerald-500/0 text-emerald-600 dark:text-emerald-400',
    red: 'from-red-500/20 to-red-500/0 text-red-600 dark:text-red-400',
    blue: 'from-sky-500/20 to-sky-500/0 text-sky-600 dark:text-sky-400',
    slate: 'from-ink-500/20 to-ink-500/0 text-ink-600 dark:text-ink-300',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className="relative overflow-hidden rounded-2xl border border-ink-200/70 bg-white p-5 shadow-sm dark:border-ink-800 dark:bg-ink-900"
    >
      <div className={cn('absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br blur-xl', tones[tone])} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-ink-500 dark:text-ink-400">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            {fmtNum(Math.round(v))}
            {suffix && <span className="ml-1 text-base font-medium text-ink-400">{suffix}</span>}
          </p>
          {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
        </div>
        {icon && <div className={cn('rounded-xl bg-gradient-to-br p-2.5', tones[tone])}>{icon}</div>}
      </div>
    </motion.div>
  );
}
