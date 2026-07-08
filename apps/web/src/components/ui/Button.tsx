import { motion } from 'framer-motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong shadow-e1',
  outline: 'border border-line bg-surface text-body hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-content',
  danger: 'bg-red-500 text-white hover:bg-red-600 shadow-e1',
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
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold transition-colors',
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
