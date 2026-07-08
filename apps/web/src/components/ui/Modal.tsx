import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  open, onClose, title, subtitle, children, wide = false,
}: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className={`relative z-10 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-lg border border-line bg-surface shadow-e3`}
          >
            <div className="flex items-start justify-between border-b border-line px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-content">{title}</h3>
                {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-content" aria-label="Yopish">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
