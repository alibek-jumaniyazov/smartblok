// AppShell (04 §1.1, spec 03 §1–§3) — the new shell. Same file name + default
// export so App.tsx keeps working.
//   • SideNav 240px ⇄ 64px rail ('[' toggles, localStorage-persisted), surface-
//     colored per theme (--sb-sider-bg), wordmark (stacked-blocks glyph → home),
//     a search-button-styled-as-input opening the palette, and a grouped Menu per
//     03 §3 (SAVDO / MOLIYA / TA'MINOT / KATALOG / TIZIM), role-filtered via
//     PERMISSIONS (AGENT/CASHIER get their flat lists). Nav badge slot left for
//     the worklist counts. TODO(worklists).
//   • TopBar 48px: breadcrumb trail · LiveBadge · theme toggle (icon button) ·
//     avatar chip (localized role from ROLES) with Profil / Klaviatura yorliqlari
//     («?») / Chiqish.
//   • Content: max-width 1440px centered, 24px padding.
//   • Global keys: Ctrl+K palette · '[' sidebar · '?' cheatsheet · G-then-key go-to
//     (D/O/M/T/Q/K) — all disabled inside inputs/textareas/selects.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Layout,
  Menu,
  Modal,
  Spin,
  Tooltip,
  Typography,
  theme as antdTheme,
  type MenuProps,
} from 'antd';
import {
  AppstoreOutlined,
  BankOutlined,
  CarOutlined,
  ContainerOutlined,
  DashboardOutlined,
  DollarOutlined,
  GiftOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SunOutlined,
  TeamOutlined,
  UsergroupAddOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from './ThemeContext';
import { CommandPalette } from './CommandPalette';
import { LiveBadge } from './LiveBadge';
import { KbdHint } from './SmallAtoms';
import { can, type Capability } from '../lib/permissions';
import { ROLES } from '../lib/status-maps';
import type { Role } from '../lib/types';

// ── nav model (badge slot reserved; live counts come with the cockpit) ──
interface Leaf {
  key: string;
  label: string;
  icon: ReactNode;
  /** capability gate; leaves without one always show (desk nav only renders A/B) */
  cap?: Capability;
  /** TODO(worklists): live worklist count — wired by the cockpit queries later */
  badge?: number;
}
interface NavGroup {
  key: string;
  /** overline group title; absent = ungrouped leaves (the «Ish stoli» home row) */
  title?: string;
  items: Leaf[];
}

// ADMIN / ACCOUNTANT — grouped by money-flow, ordered by frequency (03 §3).
const DESK_NAV: NavGroup[] = [
  { key: 'home', items: [{ key: '/app', label: 'Ish stoli', icon: <DashboardOutlined /> }] },
  {
    key: 'savdo',
    title: 'SAVDO',
    items: [
      { key: '/orders', label: 'Buyurtmalar', icon: <ShoppingCartOutlined />, cap: 'orders.view' },
      { key: '/clients', label: 'Mijozlar', icon: <TeamOutlined />, cap: 'clients.view' },
      { key: '/agents', label: 'Agentlar', icon: <IdcardOutlined />, cap: 'agents.view' },
    ],
  },
  {
    key: 'moliya',
    title: 'MOLIYA',
    items: [
      { key: '/payments', label: "To'lovlar", icon: <DollarOutlined />, cap: 'payments.view' },
      { key: '/debts', label: 'Qarzlar', icon: <WalletOutlined />, cap: 'debts.view' },
      { key: '/kassa', label: 'Kassa', icon: <BankOutlined />, cap: 'kassa.view' },
    ],
  },
  {
    key: 'taminot',
    title: "TA'MINOT",
    items: [
      { key: '/factories', label: 'Zavodlar', icon: <ShopOutlined />, cap: 'factories.view' },
      { key: '/products', label: 'Mahsulotlar', icon: <AppstoreOutlined />, cap: 'products.view' },
      { key: '/bonus', label: 'Bonus hamyonlar', icon: <GiftOutlined />, cap: 'bonus.view' },
      { key: '/pallets', label: 'Paddonlar', icon: <ContainerOutlined />, cap: 'pallets.view' },
      { key: '/vehicles', label: 'Moshinalar', icon: <CarOutlined />, cap: 'vehicles.view' },
    ],
  },
  {
    key: 'tizim',
    title: 'TIZIM',
    items: [
      { key: '/users', label: 'Foydalanuvchilar', icon: <UsergroupAddOutlined />, cap: 'users.manage' },
      { key: '/settings', label: 'Tizim sozlamalari', icon: <SettingOutlined />, cap: 'settings.read' },
    ],
  },
];

// AGENT — flat, no groups (03 §3).
const AGENT_NAV: Leaf[] = [
  { key: '/app', label: 'Ish stoli', icon: <DashboardOutlined /> },
  { key: '/orders', label: 'Buyurtmalar', icon: <ShoppingCartOutlined /> },
  { key: '/clients', label: 'Mijozlar', icon: <TeamOutlined /> },
  { key: '/debts', label: 'Qarzlar', icon: <WalletOutlined /> },
  { key: '/payments', label: "To'lovlar", icon: <DollarOutlined /> },
];

// CASHIER — a terminal, not an ERP (03 §3).
const CASHIER_NAV: Leaf[] = [
  { key: '/app', label: 'Kassa terminali', icon: <DashboardOutlined /> },
  { key: '/payments', label: "To'lovlar", icon: <DollarOutlined /> },
  { key: '/kassa', label: 'Kassa', icon: <BankOutlined /> },
];

// ── TopBar breadcrumb derivation (simple map for now; deep labels ship with pages) ──
const ROUTE_LABELS: Record<string, string> = {
  '/orders': 'Buyurtmalar',
  '/clients': 'Mijozlar',
  '/agents': 'Agentlar',
  '/payments': "To'lovlar",
  '/debts': 'Qarzlar',
  '/kassa': 'Kassa',
  '/factories': 'Zavodlar',
  '/bonus': 'Bonus hamyonlar',
  '/pallets': 'Paddonlar',
  '/vehicles': 'Moshinalar',
  '/products': 'Mahsulotlar',
  '/users': 'Foydalanuvchilar',
  '/settings': 'Tizim sozlamalari',
  '/profile': 'Profil',
  '/me': "Mening ko'rsatkichlarim",
};
const SEG2_LABELS: Record<string, string> = { new: 'Yangi' };

// ── go-to (G then …) map (03 §8) ──
const GOTO: Record<string, string> = {
  d: '/app',
  o: '/orders',
  m: '/clients',
  t: '/payments',
  q: '/debts',
  k: '/kassa',
};

function BlokGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="3" y="13" width="11" height="7" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="10" y="8.5" width="11" height="7" rx="2" fill="currentColor" opacity="0.78" />
      <rect x="6.5" y="4" width="11" height="7" rx="2" fill="currentColor" />
    </svg>
  );
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!el.closest('.ant-select, .ant-picker, [contenteditable="true"]');
}

// ── keyboard cheatsheet overlay (the `?` content — 03 §8) ──
const SHORTCUTS: { group: string; rows: [string, string][] }[] = [
  {
    group: 'Umumiy',
    rows: [
      ['Ctrl+K', 'Buyruqlar paneli (yozuvlar / amallar / sahifalar)'],
      ['G → D/O/M/T/Q/K', "O'tish: Ish stoli / Buyurtmalar / Mijozlar / To'lovlar / Qarzlar / Kassa"],
      ['[', "Yon panelni yig'ish"],
      ['?', 'Klaviatura yorliqlari'],
      ['Esc', 'Ustki oynani yopish'],
    ],
  },
  {
    group: "Ro'yxatlar",
    rows: [
      ['/', 'Qidiruvga fokus'],
      ['N', 'Yangi (sahifaning asosiy amali)'],
      ['F', "Filtr qo'shish"],
      ['V', "Saqlangan ko'rinishlar"],
      ['↑↓ / J K', 'Qator kursori'],
      ['Enter', 'Qatorni ochish'],
      ['Space', 'Peek panelni ochish/yopish'],
      ['X', 'Qatorni tanlash'],
      ['.', 'Qator amallari'],
      ['T', "To'lov — qator tarafiga bog'langan"],
    ],
  },
  {
    group: 'Formalar',
    rows: [
      ['Ctrl+Enter', 'Saqlash'],
      ['Alt+Enter', "Qator qo'shish (buyurtma)"],
      ['A', "FIFO avto-taqsimlash"],
      ['Esc', "Bekor qilish (o'zgarish tekshiruvi)"],
    ],
  },
  {
    group: 'Kartalar',
    rows: [
      ['E', 'Tahrirlash'],
      ['P', 'Chop etish menyusi'],
      ['Enter', 'Keyingi bosqich'],
    ],
  },
];

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} title="Klaviatura yorliqlari" width={560}>
      <div style={{ display: 'grid', gap: 16 }}>
        {SHORTCUTS.map((sec) => (
          <div key={sec.group}>
            <Typography.Text
              style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}
              type="secondary"
            >
              {sec.group}
            </Typography.Text>
            <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
              {sec.rows.map(([keys, desc]) => (
                <div
                  key={keys}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
                >
                  <Typography.Text style={{ fontSize: 13 }}>{desc}</Typography.Text>
                  <KbdHint style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>{keys}</KbdHint>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { mode, toggle } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = antdTheme.useToken();
  const role = user?.role;

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sb_nav_collapsed') === '1');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const gPending = useRef(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('sb_nav_collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  // ── global key handlers (03 §8) — chords disabled inside inputs ──
  useEffect(() => {
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+K toggles the palette from anywhere, even inside inputs
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      // don't fire chords while a surface owns the keyboard (it handles its own Esc)
      if (paletteOpen || shortcutsOpen) return;

      if (gPending.current) {
        gPending.current = false;
        const dest = GOTO[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        toggleCollapsed();
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key.toLowerCase() === 'g') {
        gPending.current = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => {
          gPending.current = false;
        }, 1200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(gTimer);
    };
  }, [paletteOpen, shortcutsOpen, navigate, toggleCollapsed]);

  const selected = '/' + location.pathname.split('/')[1];

  const menuItems = useMemo<MenuProps['items']>(() => {
    if (!role) return [];
    const leafToItem = (l: Leaf) => ({
      key: l.key,
      icon: l.icon,
      // plain-text title → clean native tooltip when the rail is collapsed
      title: l.label,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
          {l.badge ? <Badge count={l.badge} size="small" /> : null}
        </span>
      ),
    });

    if (role === 'AGENT') return AGENT_NAV.map(leafToItem);
    if (role === 'CASHIER') return CASHIER_NAV.map(leafToItem);

    const overline = {
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.06em',
      color: 'var(--sb-ink-fg-faint)',
    } as const;

    const items: MenuProps['items'] = [];
    for (const group of DESK_NAV) {
      const leaves = group.items.filter((l) => !l.cap || can(role, l.cap));
      if (leaves.length === 0) continue;
      if (group.title) {
        items.push({
          type: 'group',
          key: group.key,
          label: <span style={overline}>{group.title}</span>,
          children: leaves.map(leafToItem),
        });
      } else {
        for (const l of leaves) items.push(leafToItem(l));
      }
    }
    return items;
  }, [role, token.colorTextTertiary]);

  const topCrumbs = useMemo(() => {
    const homeLabel = role === 'CASHIER' ? 'Kassa terminali' : 'Ish stoli';
    if (location.pathname === '/app') return [{ title: <Link to="/app">{homeLabel}</Link> }];
    const segs = location.pathname.split('/').filter(Boolean);
    const first = '/' + segs[0];
    const items: { title: ReactNode }[] = [
      { title: <Link to={first}>{ROUTE_LABELS[first] ?? segs[0]}</Link> },
    ];
    if (segs[1]) items.push({ title: SEG2_LABELS[segs[1]] ?? decodeURIComponent(segs[1]) });
    return items;
  }, [location.pathname, role]);

  const roleLabel = role ? ROLES[role].label : '';

  const avatarMenu: MenuProps = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: 'Profil' },
      {
        key: 'shortcuts',
        icon: <QuestionCircleOutlined />,
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, justifyContent: 'space-between', minWidth: 180 }}>
            Klaviatura yorliqlari <KbdHint>?</KbdHint>
          </span>
        ),
      },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Chiqish', danger: true },
    ],
    onClick: ({ key }) => {
      if (key === 'profile') navigate('/profile');
      else if (key === 'shortcuts') setShortcutsOpen(true);
      else if (key === 'logout') logout();
    },
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <Layout.Sider
        className="sb-sider no-print"
        theme="dark"
        width={240}
        collapsedWidth={64}
        collapsed={collapsed}
        trigger={null}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1, // paints above the dark-mode ambient glow (its own opaque gradient)
          alignSelf: 'flex-start',
          height: '100vh',
        }}
      >
        <div className="sb-sider__inner">
          {/* ── header (fixed) ── */}
          <div className="sb-sider__top">
            {collapsed ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0 12px' }}>
                <Link
                  to="/app"
                  aria-label="SmartBlok — bosh sahifa"
                  style={{ color: 'var(--sb-brand-500)', display: 'inline-flex', padding: 6 }}
                >
                  <BlokGlyph />
                </Link>
                <Tooltip title="Yon panelni ochish" placement="right">
                  <Button type="text" size="small" style={{ color: 'var(--sb-ink-fg-dim)' }} aria-label="Yon panelni ochish" icon={<MenuUnfoldOutlined />} onClick={toggleCollapsed} />
                </Tooltip>
                <Tooltip title="Qidiruv (Ctrl+K)" placement="right">
                  <Button type="text" size="small" style={{ color: 'var(--sb-ink-fg-dim)' }} aria-label="Qidiruv (Ctrl+K)" icon={<SearchOutlined />} onClick={openPalette} />
                </Tooltip>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 48, padding: '0 14px' }}>
                  <Link
                    to="/app"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minWidth: 0, color: 'var(--sb-brand-500)' }}
                  >
                    <BlokGlyph size={22} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--sb-ink-fg)', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
                      SmartBlok
                    </span>
                  </Link>
                  <span style={{ flex: 1 }} />
                  <Button type="text" size="small" style={{ color: 'var(--sb-ink-fg-dim)' }} aria-label="Yon panelni yig'ish" icon={<MenuFoldOutlined />} onClick={toggleCollapsed} />
                </div>
                <div style={{ padding: '0 12px 8px' }}>
                  <button type="button" onClick={openPalette} className="sb-sider__search">
                    <SearchOutlined />
                    <span style={{ flex: 1, textAlign: 'left' }}>Qidiruv…</span>
                    <KbdHint style={{ color: 'var(--sb-ink-fg-faint)', borderColor: 'var(--sb-ink-line)' }}>Ctrl+K</KbdHint>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── nav (scrolls) ── */}
          <div className="sb-sider__nav">
            <Menu
              mode="inline"
              theme="dark"
              selectedKeys={[selected]}
              items={menuItems}
              onClick={({ key }) => {
                if (key.startsWith('/')) navigate(key);
              }}
              style={{ background: 'transparent', borderInlineEnd: 'none' }}
            />
          </div>

          {/* ── account footer (pinned) ── */}
          <div className="sb-sider__footer">
            <Dropdown menu={avatarMenu} trigger={['click']} placement="topLeft">
              <button
                type="button"
                className={collapsed ? 'sb-sider__account sb-sider__account--collapsed' : 'sb-sider__account'}
                aria-label="Hisob menyusi"
              >
                <Avatar size="small" style={{ background: token.colorPrimary, flex: '0 0 auto' }}>
                  {user?.name?.[0] ?? '?'}
                </Avatar>
                {!collapsed ? (
                  <span className="sb-sider__account-meta">
                    <span className="sb-sider__account-name">{user?.name}</span>
                    <span className="sb-sider__account-role">{roleLabel}</span>
                  </span>
                ) : null}
              </button>
            </Dropdown>
          </div>
        </div>
      </Layout.Sider>

      <Layout>
        <Layout.Header
          className="no-print"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            height: 48,
            lineHeight: '48px',
            padding: '0 16px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Breadcrumb items={topCrumbs} style={{ fontSize: 12 }} />
          <span style={{ flex: 1 }} />
          <LiveBadge />
          <Tooltip title={mode === 'dark' ? 'Yorug‘ rejim' : 'Tungi rejim'}>
            <Button
              type="text"
              shape="circle"
              aria-label={mode === 'dark' ? 'Yorug‘ rejim' : 'Tungi rejim'}
              icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggle}
            />
          </Tooltip>
        </Layout.Header>

        <Layout.Content className="sb-shell-content">
          {/* Suspense lives INSIDE the shell: only the content area suspends when a
              lazy page chunk loads — the sider/topbar never blank to a full-page
              spinner (that was the "refresh" flash). The keyed wrapper fades each
              new section in; keying by the first segment avoids remounting when the
              URL changes within a page (e.g. opening a peek at /payments/:id).
              Width + horizontal padding come from --sb-content-* (design.css) so
              wide screens stay filled, not centered with big empty gutters. */}
          <div className="sb-content">
            <Suspense
              fallback={
                <div className="sb-route-fallback">
                  <Spin size="large" />
                </div>
              }
            >
              <div key={selected} className="sb-route">
                <Outlet />
              </div>
            </Suspense>
          </div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
