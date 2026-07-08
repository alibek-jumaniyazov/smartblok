import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, ShoppingCart, Wallet, Users, UserCog,
  Factory, ClipboardList, Package, Boxes,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { cn } from '../lib/utils';

const nav = [
  { to: '/', label: 'Boshqaruv paneli', icon: LayoutDashboard, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { to: '/sales', label: 'Sotuvlar (Tovar)', icon: ShoppingCart, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { to: '/payments', label: "To'lovlar (Oplata)", icon: Wallet, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { to: '/clients', label: 'Mijozlar', icon: Users, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { to: '/agents', label: 'Agentlar', icon: UserCog, roles: ['ADMIN', 'ACCOUNTANT'] },
  { to: '/procurement', label: 'Zavod narxlari', icon: Factory, roles: ['ADMIN', 'ACCOUNTANT'] },
  { to: '/pallets', label: 'Poddonlar', icon: Package, roles: ['ADMIN', 'ACCOUNTANT', 'AGENT'] },
  { to: '/reports', label: 'Hisobot (Svod)', icon: ClipboardList, roles: ['ADMIN', 'ACCOUNTANT'] },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const items = nav.filter((n) => !user || n.roles.includes(user.role));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-ink-900">
          <Boxes size={20} />
        </div>
        <div>
          <p className="text-base font-extrabold leading-none tracking-tight">SmartBlok</p>
          <p className="mt-1 text-[11px] text-ink-400">Gazoblok CRM/ERP</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'text-ink-900 dark:text-white'
                  : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="active-nav"
                    className="absolute inset-0 rounded-xl bg-brand-500/15 ring-1 ring-brand-500/30"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <item.icon size={18} className="relative z-10" />
                <span className="relative z-10">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4 text-[11px] text-ink-400">v1.0 · Xorazm</div>
    </div>
  );
}
