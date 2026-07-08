import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, CornerDownLeft } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { visibleGroups } from '../lib/nav';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const items = useMemo(
    () => visibleGroups(user?.role).flatMap((g) => g.items.map((i) => ({ ...i, group: g.title }))),
    [user],
  );
  const results = useMemo(() => {
    const n = q.toLowerCase().trim();
    if (!n) return items;
    return items.filter((i) => i.label.toLowerCase().includes(n) || i.group.toLowerCase().includes(n));
  }, [q, items]);

  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => { if (open) setQ(''); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === 'Enter') {
        const item = results[active];
        if (item) { nav(item.to); onClose(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, active, nav, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-e3"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Search size={18} className="text-faint" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Sahifa yoki amalni qidiring..."
                className="w-full bg-transparent text-sm text-content outline-none placeholder:text-faint"
              />
              <kbd className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-faint">Hech narsa topilmadi</p>}
              {results.map((item, i) => (
                <button
                  key={item.to}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { nav(item.to); onClose(); }}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${i === active ? 'bg-primary/10 text-primary' : 'text-body hover:bg-hover'}`}
                >
                  <item.icon size={17} />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-faint">{item.group}</span>
                  {i === active && <CornerDownLeft size={14} className="text-primary" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
