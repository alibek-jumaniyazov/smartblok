// MobileTabBar (04 §1.2 responsive) — phone-only bottom navigation. On narrow
// screens the navy rail collapses into a left Drawer (AppShell), so the four most
// frequent destinations move to a thumb-reachable fixed bar, plus a «Yana» tab
// that opens the full nav Drawer. Role-filtered like the sidebar; no agent
// profit/commission destinations (agents have none). Colours come from
// design.css tokens — the brand palette is unchanged.
//   I18N: yorliqlar o'zbek lotinda (kalit); render'da t() bilan tarjima qilinadi.
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AppstoreOutlined,
  BankOutlined,
  DashboardOutlined,
  DollarOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { useT } from './LangContext';
import { can, type Capability } from '../lib/permissions';

export interface MobileTabBarProps {
  /** open the full navigation Drawer (the «Yana» tab) */
  onMore: () => void;
}

interface Tab {
  key: string;
  label: string;
  icon: ReactNode;
  /** capability gate (office roles); tabs without one always show */
  cap?: Capability;
}

// ADMIN / ACCOUNTANT — top four money-flow destinations; the rest live in «Yana».
const OFFICE_TABS: Tab[] = [
  { key: '/app', label: 'Ish stoli', icon: <DashboardOutlined /> },
  { key: '/orders', label: 'Buyurtma', icon: <ShoppingCartOutlined />, cap: 'orders.view' },
  { key: '/clients', label: 'Mijoz', icon: <TeamOutlined />, cap: 'clients.view' },
  { key: '/payments', label: "To'lov", icon: <DollarOutlined />, cap: 'payments.view' },
  { key: '/debts', label: 'Qarz', icon: <WalletOutlined />, cap: 'debts.view' },
];

// AGENT — flat, no profit/KPI destinations.
const AGENT_TABS: Tab[] = [
  { key: '/app', label: 'Ish stoli', icon: <DashboardOutlined /> },
  { key: '/orders', label: 'Buyurtma', icon: <ShoppingCartOutlined /> },
  { key: '/clients', label: 'Mijoz', icon: <TeamOutlined /> },
  { key: '/debts', label: 'Qarz', icon: <WalletOutlined /> },
];

// CASHIER — a terminal: today, payments, cashbox.
const CASHIER_TABS: Tab[] = [
  { key: '/app', label: 'Terminal', icon: <DashboardOutlined /> },
  { key: '/payments', label: "To'lov", icon: <DollarOutlined /> },
  { key: '/kassa', label: 'Kassa', icon: <BankOutlined /> },
];

export function MobileTabBar({ onMore }: MobileTabBarProps) {
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const role = user?.role;
  if (!role) return null;

  const source = role === 'AGENT' ? AGENT_TABS : role === 'CASHIER' ? CASHIER_TABS : OFFICE_TABS;
  const tabs = source.filter((t) => !t.cap || can(role, t.cap)).slice(0, 4);

  // active = the longest tab key matching the current path (exact or prefix), so
  // /orders/:id, /clients/:id highlight their parent tab
  const path = location.pathname;
  const activeKey = tabs
    .map((t) => t.key)
    .filter((k) => path === k || path.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="sb-tabbar no-print" aria-label={t('Asosiy navigatsiya')}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            className={active ? 'sb-tabbar__btn sb-tabbar__btn--active' : 'sb-tabbar__btn'}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(tab.key)}
          >
            <span className="sb-tabbar__icon">{tab.icon}</span>
            <span className="sb-tabbar__label">{t(tab.label)}</span>
          </button>
        );
      })}
      <button type="button" className="sb-tabbar__btn" aria-label={t('Koʻproq')} onClick={onMore}>
        <span className="sb-tabbar__icon">
          <AppstoreOutlined />
        </span>
        <span className="sb-tabbar__label">{t('Yana')}</span>
      </button>
    </nav>
  );
}
