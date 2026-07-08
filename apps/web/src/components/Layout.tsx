import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Menu, LogOut, Search, Bell, User, ChevronDown, AlertTriangle } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { CommandPalette } from './CommandPalette';
import { useAuth } from '../auth/AuthContext';
import { routeLabels } from '../lib/nav';
import { endpoints } from '../lib/api';
import { fmtUZS } from '../lib/format';

const roleLabel: Record<string, string> = { ADMIN: 'Administrator', ACCOUNTANT: 'Buxgalter', AGENT: 'Agent', CASHIER: 'Kassir' };

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: endpoints.clients });
  const debtors = (clients ?? []).filter((c: any) => c.balance < 0).sort((a: any, b: any) => a.balance - b.balance).slice(0, 6);
  const canSee = user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-muted hover:bg-hover hover:text-content" aria-label="Bildirishnomalar">
        <Bell size={18} />
        {canSee && debtors.length > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-e3"
            >
              <div className="border-b border-line px-4 py-3 text-sm font-semibold text-content">Bildirishnomalar</div>
              <div className="max-h-80 overflow-y-auto">
                {canSee && debtors.length > 0 ? debtors.map((c: any) => (
                  <div key={c.id} className="flex items-start gap-3 border-b border-line-soft px-4 py-3 last:border-0">
                    <span className="mt-0.5 rounded-md bg-red-500/12 p-1.5 text-red-500"><AlertTriangle size={15} /></span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-content">{c.name}</p>
                      <p className="text-xs text-muted">Qarzdorlik: {fmtUZS(Math.abs(c.balance))}</p>
                    </div>
                  </div>
                )) : (
                  <p className="px-4 py-8 text-center text-sm text-faint">Yangi bildirishnoma yo'q</p>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-hover">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
          {user?.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="hidden text-left sm:block">
          <p className="text-[13px] font-semibold leading-none text-content">{user?.name}</p>
          <p className="mt-0.5 text-[11px] text-faint">{user ? roleLabel[user.role] ?? user.role : ''}</p>
        </div>
        <ChevronDown size={15} className="text-faint" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-line bg-surface shadow-e3"
            >
              <div className="border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-content">{user?.name}</p>
                <p className="text-xs text-muted">{user?.email}</p>
              </div>
              <button className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-body hover:bg-hover"><User size={15} /> Profil</button>
              <button onClick={logout} className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/10">
                <LogOut size={15} /> Chiqish
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  const nav = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const crumb = routeLabels[location.pathname] ?? '';

  return (
    <div className="flex h-screen overflow-hidden bg-app">
      <aside className="hidden w-64 shrink-0 border-r border-line lg:block">
        <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              className="absolute left-0 top-0 h-full w-64 border-r border-line"
            >
              <Sidebar onNavigate={() => setMobileOpen(false)} onOpenPalette={() => { setMobileOpen(false); setPaletteOpen(true); }} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-md p-2 text-muted hover:bg-hover lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <nav className="hidden items-center gap-1.5 text-sm sm:flex">
              <span className="text-faint">SmartBlok</span>
              <span className="text-faint">/</span>
              <span className="font-medium text-content">{crumb}</span>
            </nav>
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-faint hover:bg-hover md:flex md:w-72"
          >
            <Search size={15} /> Qidirish...
            <kbd className="ml-auto rounded bg-subtle px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-1">
            <button onClick={() => setPaletteOpen(true)} className="rounded-md p-2 text-muted hover:bg-hover md:hidden"><Search size={18} /></button>
            <NotificationsBell />
            <ThemeToggle />
            <div className="mx-1 h-6 w-px bg-line" />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 xl:p-8">
          <div className="mx-auto max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
