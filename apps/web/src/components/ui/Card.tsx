import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Card({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'rounded-2xl border border-ink-200/70 bg-white p-5 shadow-sm',
        'dark:border-ink-800 dark:bg-ink-900',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
