import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function PageHeader({
  title, subtitle, action, breadcrumb,
}: { title: string; subtitle?: string; action?: ReactNode; breadcrumb?: string[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="mb-6"
    >
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-1.5 flex items-center gap-1 text-xs text-faint">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} />}
              <span className={i === breadcrumb.length - 1 ? 'text-muted' : ''}>{b}</span>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-content">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </motion.div>
  );
}
