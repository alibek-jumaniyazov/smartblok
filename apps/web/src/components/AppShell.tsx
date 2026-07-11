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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Space,
  Typography,
  theme as antdTheme,
  type MenuProps,
} from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BankOutlined,
  BarChartOutlined,
  CarOutlined,
  ContainerOutlined,
  DashboardOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  FallOutlined,
  GiftOutlined,
  IdcardOutlined,
  ImportOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SolutionOutlined,
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
  { key: 'home', items: [{ key: '/', label: 'Ish stoli', icon: <DashboardOutlined /> }] },
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
      { key: '/expenses', label: 'Xarajatlar', icon: <FallOutlined />, cap: 'expenses.view' },
      { key: '/reports', label: 'Hisobotlar', icon: <BarChartOutlined />, cap: 'reports.view' },
    ],
  },
  {
    key: 'taminot',
    title: "TA'MINOT",
    items: [
      { key: '/factories', label: 'Zavodlar', icon: <ShopOutlined />, cap: 'factories.view' },
      { key: '/bonus', label: 'Bonus hamyonlar', icon: <GiftOutlined />, cap: 'bonus.view' },
      { key: '/pallets', label: 'Paddonlar', icon: <ContainerOutlined />, cap: 'pallets.view' },
      { key: '/vehicles', label: 'Moshinalar', icon: <CarOutlined />, cap: 'vehicles.view' },
      { key: '/procurement', label: "Ta'minot matritsasi", icon: <ApartmentOutlined />, cap: 'procurement.view' },
    ],
  },
  // TODO(references): /regions + /legal-entities consolidate into one «Ma'lumotnomalar»
  // → /references when the References page ships (03 §3). Kept separate + routable now.
  {
    key: 'katalog',
    title: 'KATALOG',
    items: [
      { key: '/products', label: 'Mahsulotlar', icon: <AppstoreOutlined />, cap: 'products.view' },
      { key: '/regions', label: 'Hududlar', icon: <EnvironmentOutlined />, cap: 'regions.view' },
      { key: '/legal-entities', label: 'Yuridik shaxslar', icon: <SolutionOutlined />, cap: 'legalEntities.view' },
    ],
  },
  {
    key: 'tizim',
    title: 'TIZIM',
    items: [
      { key: '/users', label: 'Foydalanuvchilar', icon: <UsergroupAddOutlined />, cap: 'users.manage' },
      { key: '/settings', label: 'Tizim sozlamalari', icon: <SettingOutlined />, cap: 'settings.read' },
      { key: '/import', label: 'Excel import', icon: <ImportOutlined />, cap: 'import.use' },
    ],
  },
];

// AGENT — flat, no groups (03 §3).
const AGENT_NAV: Leaf[] = [
  { key: '/', label: 'Ish stoli', icon: <DashboardOutlined /> },
  { key: '/orders', label: 'Buyurtmalar', icon: <ShoppingCartOutlined /> },
  { key: '/clients', label: 'Mijozlar', icon: <TeamOutlined /> },
  { key: '/debts', label: 'Qarzlar', icon: <WalletOutlined /> },
  { key: '/payments', label: "To'lovlar", icon: <DollarOutlined /> },
];

// CASHIER — a terminal, not an ERP (03 §3).
const CASHIER_NAV: Leaf[] = [
  { key: '/', label: 'Kassa terminali', icon: <DashboardOutlined /> },
  { key: '/payments', label: "To'lovlar", icon: <DollarOutlined /> },
  { key: '/kassa', label: 'Kassa', icon: <BankOutlined /> },
  { key: '/expenses', label: 'Xarajatlar', icon: <FallOutlined /> },
];

// ── TopBar breadcrumb derivation (simple map for now; deep labels ship with pages) ──
const ROUTE_LABELS: Record<string, string> = {
  '/orders': 'Buyurtmalar',
  '/clients': 'Mijozlar',
  '/agents': 'Agentlar',
  '/payments': "To'lovlar",
  '/debts': 'Qarzlar',
  '/kassa': 'Kassa',
  '/expenses': 'Xarajatlar',
  '/reports': 'Hisobotlar',
  '/factories': 'Zavodlar',
  '/bonus': 'Bonus hamyonlar',
  '/pallets': 'Paddonlar',
  '/vehicles': 'Moshinalar',
  '/procurement': "Ta'minot matritsasi",
  '/products': 'Mahsulotlar',
  '/regions': 'Hududlar',
  '/legal-entities': 'Yuridik shaxslar',
  '/users': 'Foydalanuvchilar',
  '/settings': 'Tizim sozlamalari',
  '/import': 'Excel import',
  '/profile': 'Profil',
  '/me': "Mening ko'rsatkichlarim",
};
const SEG2_LABELS: Record<string, string> = { new: 'Yangi' };

// ── go-to (G then …) map (03 §8) ──
const GOTO: Record<string, string> = {
  d: '/',
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

  const selected = location.pathname === '/' ? '/' : '/' + location.pathname.split('/')[1];

  const menuItems = useMemo<MenuProps['items']>(() => {
    if (!role) return [];
    const leafToItem = (l: Leaf) => ({
      key: l.key,
      icon: l.icon,
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
      color: token.colorTextTertiary,
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
    if (location.pathname === '/') return [{ title: <Link to="/">{homeLabel}</Link> }];
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

  // input-styled search button (opens the palette)
  const searchBtnStyle = {
    width: '100%',
    height: 32,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 8px',
    border: `1px solid ${token.colorBorder}`,
    borderRadius: token.borderRadius,
    background: token.colorBgContainer,
    color: token.colorTextTertiary,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
  } as const;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <Layout.Sider
        className="no-print"
        theme="light"
        width={240}
        collapsedWidth={64}
        collapsed={collapsed}
        trigger={null}
        style={{
          position: 'sticky',
          top: 0,
          alignSelf: 'flex-start',
          height: '100vh',
          overflow: 'auto',
          background: 'var(--sb-sider-bg)',
          borderInlineEnd: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {collapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0 12px' }}>
            <Link
              to="/"
              aria-label="SmartBlok — bosh sahifa"
              style={{ color: token.colorPrimary, display: 'inline-flex', padding: 6 }}
            >
              <BlokGlyph />
            </Link>
            <Button type="text" size="small" aria-label="Yon panelni ochish" icon={<MenuUnfoldOutlined />} onClick={toggleCollapsed} />
            <Button type="text" size="small" aria-label="Qidiruv (Ctrl+K)" icon={<SearchOutlined />} onClick={openPalette} />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 48, padding: '0 12px' }}>
              <Link
                to="/"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, color: token.colorPrimary }}
              >
                <BlokGlyph />
                <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText, whiteSpace: 'nowrap' }}>
                  SmartBlok
                </span>
              </Link>
              <span style={{ flex: 1 }} />
              <Button type="text" size="small" aria-label="Yon panelni yig'ish" icon={<MenuFoldOutlined />} onClick={toggleCollapsed} />
            </div>
            <div style={{ padding: '0 12px 8px' }}>
              <button type="button" onClick={openPalette} style={searchBtnStyle}>
                <SearchOutlined />
                <span style={{ flex: 1, textAlign: 'left' }}>Qidiruv…</span>
                <KbdHint>Ctrl+K</KbdHint>
              </button>
            </div>
          </>
        )}

        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={menuItems}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
          style={{ background: 'transparent', borderInlineEnd: 'none' }}
        />
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
          <Button
            type="text"
            shape="circle"
            aria-label={mode === 'dark' ? 'Yorug‘ rejim' : 'Tungi rejim'}
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
          />
          <Dropdown menu={avatarMenu} trigger={['click']}>
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" style={{ background: token.colorPrimary }}>
                {user?.name?.[0] ?? '?'}
              </Avatar>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  {user?.name}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: 1.1 }}>
                  {roleLabel}
                </Typography.Text>
              </span>
            </Space>
          </Dropdown>
        </Layout.Header>

        <Layout.Content style={{ padding: 24 }}>
          <div style={{ maxWidth: 1440, margin: '0 auto' }}>
            <Outlet />
          </div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
