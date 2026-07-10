import { motion } from 'framer-motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'grad-brand text-white shadow-primary hover:brightness-[1.07] border border-white/10',
  outline: 'border border-line bg-surface text-body hover:bg-hover hover:border-primary/40',
  ghost: 'text-muted hover:bg-hover hover:text-content',
  danger: 'bg-red-500 text-white hover:bg-red-600 shadow-e1 border border-white/10',
  subtle: 'bg-subtle text-body hover:bg-hover',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export function Button({
  children, variant = 'primary', size = 'md', loading, className, ...props
}: {
  children: ReactNode; variant?: Variant; size?: Size; loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-lg font-semibold transition-[filter,background-color,border-color,box-shadow]',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant], sizes[size], className,
      )}
      disabled={loading || props.disabled}
      {...(props as any)}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </motion.button>
  );
}
