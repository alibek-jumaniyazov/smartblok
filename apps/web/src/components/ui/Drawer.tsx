import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Drawer({
  open, onClose, title, subtitle, children, footer,
}: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink-950/55 backdrop-blur-md" onClick={onClose} />
          <motion.aside
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-e3"
          >
            <div className="flex items-start justify-between border-b border-line bg-surface-2/60 px-6 py-4">
              <div>
                <h3 className="text-base font-bold tracking-tight text-content">{title}</h3>
                {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-faint transition hover:bg-hover hover:text-content" aria-label="Yopish">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
            {footer && <div className="border-t border-line bg-surface-2/60 px-6 py-4">{footer}</div>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
