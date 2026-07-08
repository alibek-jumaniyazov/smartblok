import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Card({
  children, className, delay = 0, interactive = false, padded = true,
}: { children: ReactNode; className?: string; delay?: number; interactive?: boolean; padded?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={interactive ? { y: -3 } : undefined}
      className={cn(
        'rounded-lg border border-line bg-surface shadow-e1',
        padded && 'p-5',
        interactive && 'cursor-pointer transition-shadow hover:shadow-e2',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-[15px] font-semibold text-content">{children}</h3>
      {right}
    </div>
  );
}
