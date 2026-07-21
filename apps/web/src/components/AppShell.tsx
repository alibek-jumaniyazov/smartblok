// AppShell (04 §1.1, spec 03 §1–§3) — the new shell. Same file name + default
// export so App.tsx keeps working.
//   • SideNav 240px ⇄ 64px rail ('[' toggles, localStorage-persisted), surface-
//     colored per theme (--sb-sider-bg), wordmark (stacked-blocks glyph → home),
//     a search-button-styled-as-input opening the palette, and a grouped Menu per
//     03 §3 (SAVDO / MOLIYA / TA'MINOT / KATALOG / TIZIM), role-filtered via
//     PERMISSIONS (AGENT/CASHIER get their flat lists). Nav badge slot left for
//     the worklist counts. TODO(worklists).
//   • TopBar 48px: breadcrumb trail · LiveBadge · language switcher · theme toggle
//     (icon button) · avatar chip (localized role from ROLES).
//   • Content: max-width 1440px centered, 24px padding.
//   • Floating AI chat dock (ChatDock) — o'ng pastdagi launcher; alohida sahifa emas.
//   • Global keys: Ctrl+K palette · '[' sidebar · '?' cheatsheet · G-then-key go-to
//     (D/O/M/T/Q/K) — all disabled inside inputs/textareas/selects.
//
//   I18N: nav ma'lumot massivlaridagi matnlar o'zbek lotinda (kalit sifatida)
//   qoladi; render paytida t() bilan tarjima qilinadi. Til almashsa App qayta
//   mount bo'ladi (main.tsx key={lang}), shuning uchun barcha yorliqlar yangilanadi.
//
//   MOBIL (mobile-responsive-spec §2.6): breakpointlar `lib/responsive` dan —
//   `Grid.useBreakpoint()` TAQIQLANGAN (birinchi renderda {} qaytarib, desktopda
//   mobil layoutni «yondirar» edi). Telefonda TopBar 320px da ham omon qoladi:
//   LiveBadge faqat nuqtaga yig'iladi, til + tema almashtirgichlari avatar
//   menyusiga ko'chadi, 1px ajratgich chizilmaydi, sarlavha o'ramchisi
//   `flex: 1 1 auto; minWidth: 0` oladi. Klaviatura xromi (Ctrl+K, «Klaviatura
//   yorliqlari», ShortcutsModal) telefonda umuman ko'rsatilmaydi.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Drawer,
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
  GlobalOutlined,
  IdcardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  ProjectOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  SettingOutlined,
  CloudUploadOutlined,
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
import { useLang, useT } from './LangContext';
import { LANGS, type LangCode } from '../lib/i18n';
import { drawerWidth, modalWidth, useBreakpointUp, useIsPhone } from '../lib/responsive';
import { CommandPalette } from './CommandPalette';
import { ChatDock } from './ChatDock';
import { LangSwitcher } from './LangSwitcher';
import { LiveBadge } from './LiveBadge';
import { MobileTabBar } from './MobileTabBar';
import { KbdHint } from './SmallAtoms';
import { can, type Capability } from '../lib/permissions';
import { ROLES } from '../lib/status-maps';
import type { Role } from '../lib/types';

// ── nav model (badge slot reserved; live counts come with the cockpit) ──
interface Leaf {
  key: string;
  /** o'zbek lotin manba matni (i18n kaliti) — render'da t() bilan tarjima qilinadi */
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
      { key: '/board', label: 'Buyurtmalar doskasi', icon: <ProjectOutlined />, cap: 'orders.view' },
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
      { key: '/kassa', label: 'Kassa', icon: <WalletOutlined />, cap: 'kassa.view' },
      { key: '/bank', label: 'Bank hisoblar', icon: <BankOutlined />, cap: 'kassa.view' },
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
      { key: '/import', label: 'Excel import', icon: <CloudUploadOutlined />, cap: 'settings.read' },
    ],
  },
];

// AGENT — flat, no groups (03 §3).
const AGENT_NAV: Leaf[] = [
  { key: '/app', label: 'Ish stoli', icon: <DashboardOutlined /> },
  { key: '/board', label: 'Buyurtmalar doskasi', icon: <ProjectOutlined /> },
  { key: '/orders', label: 'Buyurtmalar', icon: <ShoppingCartOutlined /> },
  { key: '/clients', label: 'Mijozlar', icon: <TeamOutlined /> },
  { key: '/debts', label: 'Qarzlar', icon: <WalletOutlined /> },
  { key: '/payments', label: "To'lovlar", icon: <DollarOutlined /> },
];

// CASHIER — a terminal, not an ERP (03 §3).
const CASHIER_NAV: Leaf[] = [
  { key: '/app', label: 'Kassa terminali', icon: <DashboardOutlined /> },
  { key: '/payments', label: "To'lovlar", icon: <DollarOutlined /> },
  { key: '/kassa', label: 'Kassa', icon: <WalletOutlined /> },
  { key: '/bank', label: 'Bank hisoblar', icon: <BankOutlined /> },
];

// ── TopBar breadcrumb derivation (simple map for now; deep labels ship with pages) ──
const ROUTE_LABELS: Record<string, string> = {
  '/board': 'Buyurtmalar doskasi',
  '/orders': 'Buyurtmalar',
  '/clients': 'Mijozlar',
  '/agents': 'Agentlar',
  '/payments': "To'lovlar",
  '/debts': 'Qarzlar',
  '/kassa': 'Kassa',
  '/bank': 'Bank hisoblar',
  '/factories': 'Zavodlar',
  '/bonus': 'Bonus hamyonlar',
  '/pallets': 'Paddonlar',
  '/vehicles': 'Moshinalar',
  '/products': 'Mahsulotlar',
  '/users': 'Foydalanuvchilar',
  '/settings': 'Tizim sozlamalari',
  '/import': 'Excel import',
  '/profile': 'Profil',
  '/me': "Mening ko'rsatkichlarim",
};
const SEG2_LABELS: Record<string, string> = { new: 'Yangi' };

// ── go-to (G then …) map (03 §8) ──
const GOTO: Record<string, string> = {
  d: '/app',
  b: '/board',
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
// Matnlar o'zbek lotinda (i18n kaliti); ShortcutsModal ularni t() bilan tarjima qiladi.
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
  const t = useT();
  const isPhone = useIsPhone();
  // telefonda klaviatura yorliqlari yo'q — modal umuman render qilinmaydi
  if (isPhone) return null;
  return (
    <Modal open={open} onCancel={onClose} footer={null} title={t('Klaviatura yorliqlari')} width={modalWidth(560)}>
      <div style={{ display: 'grid', gap: 16 }}>
        {SHORTCUTS.map((sec) => (
          <div key={sec.group}>
            <Typography.Text
              style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}
              type="secondary"
            >
              {t(sec.group)}
            </Typography.Text>
            <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
              {sec.rows.map(([keys, desc]) => (
                <div
                  key={keys}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
                >
                  <Typography.Text style={{ fontSize: 13 }}>{t(desc)}</Typography.Text>
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
  const t = useT();
  const { lang, setLang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = antdTheme.useToken();
  const role = user?.role;

  // responsive: <992px → sider becomes a drawer; <768px → bottom tab bar + page-
  // title header (mirrors the CRM's breakpoint ergonomics, smartblok theme kept).
  // matchMedia asosida — birinchi renderdayoq to'g'ri (Grid.useBreakpoint emas).
  const isMobile = !useBreakpointUp('lg');
  const isPhone = useIsPhone();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sb_nav_collapsed') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const gPending = useRef(false);

  // close the mobile nav drawer on every navigation (CRM parity)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

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
      title: t(l.label),
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(l.label)}</span>
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
          label: <span style={overline}>{t(group.title)}</span>,
          children: leaves.map(leafToItem),
        });
      } else {
        for (const l of leaves) items.push(leafToItem(l));
      }
    }
    return items;
  }, [role, t]);

  // collapsed rail → flatten group wrappers to a plain icon list so section
  // titles (SAVDO / MOLIYA …) never cramp the 72px rail (buissnes_crm parity).
  const railItems = useMemo<MenuProps['items']>(
    () =>
      (menuItems ?? []).flatMap((it) =>
        it && typeof it === 'object' && 'type' in it && (it as { type?: string }).type === 'group'
          ? ((it as { children?: MenuProps['items'] }).children ?? [])
          : [it],
      ),
    [menuItems],
  );

  const topCrumbs = useMemo(() => {
    const homeLabel = t(role === 'CASHIER' ? 'Kassa terminali' : 'Ish stoli');
    if (location.pathname === '/app') return [{ title: <Link to="/app">{homeLabel}</Link> }];
    const segs = location.pathname.split('/').filter(Boolean);
    const first = '/' + segs[0];
    const items: { title: ReactNode }[] = [
      { title: <Link to={first}>{ROUTE_LABELS[first] ? t(ROUTE_LABELS[first]) : segs[0]}</Link> },
    ];
    if (segs[1]) items.push({ title: SEG2_LABELS[segs[1]] ? t(SEG2_LABELS[segs[1]]) : decodeURIComponent(segs[1]) });
    return items;
  }, [location.pathname, role, t]);

  const roleLabel = role ? ROLES[role].label : '';

  // Telefonda til almashtirgich + tema tugmasi TopBar'dan SHU MENYUGA ko'chadi
  // (320px da ular avatar bilan bir qatorga sig'maydi), klaviatura yorliqlari esa
  // umuman ko'rsatilmaydi — telefonda klaviatura yo'q.
  const avatarItems: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: t('Profil') },
  ];
  if (isPhone) {
    avatarItems.push({
      key: 'lang',
      icon: <GlobalOutlined />,
      label: t('Til'),
      children: LANGS.map((l) => ({ key: `lang:${l.code}`, label: `${l.short} · ${l.native}` })),
    });
    avatarItems.push({
      key: 'theme',
      icon: mode === 'dark' ? <SunOutlined /> : <MoonOutlined />,
      label: mode === 'dark' ? t('Yorug‘ rejim') : t('Tungi rejim'),
    });
  } else {
    avatarItems.push({
      key: 'shortcuts',
      icon: <QuestionCircleOutlined />,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, justifyContent: 'space-between', minWidth: 180 }}>
          {t('Klaviatura yorliqlari')} <KbdHint>?</KbdHint>
        </span>
      ),
    });
  }
  avatarItems.push({ type: 'divider' });
  avatarItems.push({ key: 'logout', icon: <LogoutOutlined />, label: t('Chiqish'), danger: true });

  const avatarMenu: MenuProps = {
    items: avatarItems,
    selectedKeys: isPhone ? [`lang:${lang}`] : undefined,
    onClick: ({ key }) => {
      if (key.startsWith('lang:')) setLang(key.slice('lang:'.length) as LangCode);
      else if (key === 'theme') toggle();
      else if (key === 'profile') navigate('/profile');
      else if (key === 'shortcuts') setShortcutsOpen(true);
      else if (key === 'logout') logout();
    },
  };

  // Single authoring source for the sidebar body — reused by the desktop sticky
  // Sider and the mobile Drawer (mirror of the CRM's renderSidebarBody). The
  // Drawer always passes rail=false (full labels); the desktop Sider passes the
  // persisted `collapsed` state.
  const renderSiderInner = (rail: boolean) => (
    <div className="sb-sider__inner">
      <span className="sb-sider__glow" aria-hidden />
      {/* ── header (fixed) — buissnes_crm uslubidagi brendlangan blok ── */}
      <div className="sb-sider__top">
        {rail ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 0 10px' }}>
            <Link to="/app" aria-label={t('SmartBlok — bosh sahifa')} className="sb-sider__logo-badge">
              <BlokGlyph size={20} />
            </Link>
            <Tooltip title={t('Yon panelni ochish')} placement="right">
              <Button type="text" size="small" style={{ color: 'var(--sb-ink-fg-dim)' }} aria-label={t('Yon panelni ochish')} icon={<MenuUnfoldOutlined />} onClick={toggleCollapsed} />
            </Tooltip>
            <Tooltip title={t('Qidiruv (Ctrl+K)')} placement="right">
              <Button type="text" size="small" style={{ color: 'var(--sb-ink-fg-dim)' }} aria-label={t('Qidiruv (Ctrl+K)')} icon={<SearchOutlined />} onClick={openPalette} />
            </Tooltip>
          </div>
        ) : (
          <>
            <div className="sb-sider__brand">
              <Link to="/app" className="sb-sider__brand-link" aria-label={t('SmartBlok — bosh sahifa')}>
                <span className="sb-sider__logo-badge">
                  <BlokGlyph size={20} />
                </span>
                <span className="sb-sider__brand-text">
                  <span className="sb-sider__brand-name">SmartBlok</span>
                  <span className="sb-sider__brand-tag">{t('Gazoblok diller ERP')}</span>
                </span>
              </Link>
              {/* the fold button only makes sense on the desktop sticky sider */}
              {!isMobile ? (
                <Button type="text" size="small" className="sb-sider__fold" aria-label={t("Yon panelni yig'ish")} icon={<MenuFoldOutlined />} onClick={toggleCollapsed} />
              ) : null}
            </div>
            <div style={{ padding: '10px 12px' }}>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  openPalette();
                }}
                className="sb-sider__search"
              >
                <SearchOutlined />
                <span style={{ flex: 1, textAlign: 'left' }}>{t('Qidiruv…')}</span>
                {/* klaviatura maslahati telefonda ko'rsatilmaydi (R19) */}
                {!isPhone ? (
                  <KbdHint style={{ color: 'var(--sb-ink-fg-faint)', borderColor: 'var(--sb-ink-line)' }}>Ctrl+K</KbdHint>
                ) : null}
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
          items={rail ? railItems : menuItems}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
            setMobileOpen(false);
          }}
          style={{ background: 'transparent', borderInlineEnd: 'none' }}
        />
      </div>

      {/* ── account footer (pinned) ── */}
      <div className="sb-sider__footer">
        <Dropdown menu={avatarMenu} trigger={['click']} placement="topLeft">
          <button
            type="button"
            className={rail ? 'sb-sider__account sb-sider__account--collapsed' : 'sb-sider__account'}
            aria-label={t('Hisob menyusi')}
          >
            <Avatar size="small" style={{ background: token.colorPrimary, flex: '0 0 auto' }}>
              {user?.name?.[0] ?? '?'}
            </Avatar>
            {!rail ? (
              <span className="sb-sider__account-meta">
                <span className="sb-sider__account-name">{user?.name}</span>
                <span className="sb-sider__account-role">{roleLabel}</span>
              </span>
            ) : null}
          </button>
        </Dropdown>
      </div>
    </div>
  );

  return (
    // .sb-shell: min-height 100vh → 100dvh progressiv juftligi (design.css)
    <Layout className="sb-shell">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Desktop / tablet: sticky navy rail. Phone / narrow: a left Drawer holding
          the same body, opened by the header hamburger + the «Yana» tab. */}
      {!isMobile ? (
        <Layout.Sider
          className="sb-sider no-print"
          theme="dark"
          width={240}
          collapsedWidth={72}
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
          {renderSiderInner(collapsed)}
        </Layout.Sider>
      ) : (
        <Drawer
          className="sb-sider no-print"
          placement="left"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          width={drawerWidth(264)}
          closable={false}
          styles={{ body: { padding: 0, background: 'var(--sb-sider-bg)' }, header: { display: 'none' } }}
        >
          {renderSiderInner(false)}
        </Drawer>
      )}

      <Layout>
        <Layout.Header
          className="sb-topbar no-print"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            height: 48,
            lineHeight: '48px',
            padding: isPhone ? '0 10px' : '0 16px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            gap: isPhone ? 6 : 10,
          }}
        >
          {isMobile ? (
            <Button
              type="text"
              aria-label={t('Menyu')}
              icon={<MenuOutlined />}
              onClick={() => setMobileOpen(true)}
              style={{ marginInlineStart: -4, flex: '0 0 auto' }}
            />
          ) : null}
          {isPhone ? (
            // 320px da sarlavha o'ramchisi qisqara olishi shart (minWidth: 0)
            <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center' }}>
              <Typography.Text strong ellipsis style={{ fontSize: 15, minWidth: 0 }}>
                {ROUTE_LABELS[selected] ? t(ROUTE_LABELS[selected]) : t(role === 'CASHIER' ? 'Kassa terminali' : 'Ish stoli')}
              </Typography.Text>
            </span>
          ) : (
            <Breadcrumb items={topCrumbs} style={{ fontSize: 12 }} />
          )}
          {!isPhone ? <span style={{ flex: 1 }} /> : null}
          {/* telefonda LiveBadge faqat nuqtaga yig'iladi (.sb-topbar__live) */}
          <span className={isPhone ? 'sb-topbar__live' : undefined} style={{ flex: '0 0 auto' }}>
            <LiveBadge />
          </span>
          {/* til + tema telefonda avatar menyusida — bu yerda ko'rsatilmaydi */}
          {!isPhone ? (
            <>
              <LangSwitcher />
              <Tooltip title={mode === 'dark' ? t('Yorug‘ rejim') : t('Tungi rejim')}>
                <Button
                  type="text"
                  shape="circle"
                  aria-label={mode === 'dark' ? t('Yorug‘ rejim') : t('Tungi rejim')}
                  icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                  onClick={toggle}
                />
              </Tooltip>
              {/* account chip — also in the header (03 §1), not only the sidebar footer */}
              <span style={{ width: 1, height: 22, background: token.colorBorderSecondary, marginInline: 2 }} />
            </>
          ) : null}
          <Dropdown menu={avatarMenu} trigger={['click']} placement="bottomRight">
            <button type="button" className="sb-topbar-account" aria-label={t('Hisob menyusi')}>
              <Avatar size={28} style={{ background: token.colorPrimary, flex: '0 0 auto' }}>
                {user?.name?.[0] ?? '?'}
              </Avatar>
              {!isPhone ? (
                <span className="sb-topbar-account__meta">
                  <span className="sb-topbar-account__name">{user?.name}</span>
                  <span className="sb-topbar-account__role">{roleLabel}</span>
                </span>
              ) : null}
            </button>
          </Dropdown>
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

      {/* floating AI chat dock — o'ng pastdagi launcher, har sahifada mavjud */}
      <ChatDock />

      {/* phone-only thumb-reachable bottom nav (desktop keeps the rail) */}
      {isPhone ? <MobileTabBar onMore={() => setMobileOpen(true)} /> : null}
    </Layout>
  );
}
