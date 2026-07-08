import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, LogOut } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../auth/AuthContext';

const roleLabel: Record<string, string> = { ADMIN: 'Administrator', ACCOUNTANT: 'Buxgalter', AGENT: 'Agent' };

export function Layout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white lg:block dark:border-ink-800 dark:bg-ink-900">
        <Sidebar />
      </aside>

      {/* mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              className="absolute left-0 top-0 h-full w-64 border-r border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900"
            >
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-ink-200 bg-white/80 px-4 backdrop-blur lg:px-8 dark:border-ink-800 dark:bg-ink-900/80">
          <button className="rounded-xl p-2 text-ink-500 hover:bg-ink-100 lg:hidden dark:hover:bg-ink-800" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="mx-1 hidden text-right sm:block">
              <p className="text-sm font-semibold leading-none">{user?.name}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">{user ? roleLabel[user.role] : ''}</p>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-500 text-sm font-bold text-ink-900">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <button onClick={logout} className="rounded-xl p-2 text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
