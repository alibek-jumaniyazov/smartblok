import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Command } from 'lucide-react';
import { LogoMark } from './Logo';
import { useAuth } from '../auth/AuthContext';
import { visibleGroups } from '../lib/nav';
import { cn } from '../lib/utils';

export function Sidebar({ onNavigate, onOpenPalette }: { onNavigate?: () => void; onOpenPalette?: () => void }) {
  const { user } = useAuth();
  const groups = visibleGroups(user?.role);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <LogoMark size={38} className="shadow-e1" />
        <div>
          <p className="text-[15px] font-extrabold leading-none tracking-tight text-content">SmartBlok</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-faint">Gazoblok ERP</p>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'text-primary' : 'text-muted hover:bg-hover hover:text-content',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="active-nav"
                          className="absolute inset-0 rounded-md bg-primary/10 ring-1 ring-primary/20"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                      )}
                      {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
                      <item.icon size={18} className="relative z-10 shrink-0" />
                      <span className="relative z-10 truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* command palette hint */}
      <div className="px-3 py-3">
        <button
          onClick={onOpenPalette}
          className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-xs text-faint hover:bg-hover"
        >
          <Command size={14} /> Tez qidiruv
          <kbd className="ml-auto rounded bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">Ctrl K</kbd>
        </button>
      </div>
    </div>
  );
}
