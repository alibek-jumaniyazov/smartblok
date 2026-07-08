import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; msg: string }

const Ctx = createContext<{ toast: (msg: string, kind?: Kind) => void }>({ toast: () => {} });

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const colors = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-sky-500',
};

export function ToasterProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, kind: Kind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, msg }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => {
            const Icon = icons[t.kind];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-e2"
              >
                <Icon size={18} className={colors[t.kind]} />
                <span className="flex-1 text-sm text-body">{t.msg}</span>
                <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-faint hover:text-content">
                  <X size={15} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx).toast;
