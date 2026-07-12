// CommandPalette (04 §1.7, spec 03 §2) — the product's front door.
// Controlled by AppShell (owns Ctrl+K + the sidebar search button). Three result
// groups queried in parallel, debounced 250ms:
//   1. Yozuvlar (records)  — federated server search across clients / orders /
//      payments (role-filtered; AGENT/CASHIER are server-scoped). Rows carry the
//      identifying fact inline (client → BalanceTag; order → date + status chip;
//      payment → amount + kind). Enter opens the record.
//   2. Amallar (actions)   — verb-first, role-filtered. For now each navigates to
//      its target page; record-scoped pre-binding lands with the composers.
//      TODO(composers): re-scope the action list when a record row is highlighted
//      («Yangi buyurtma — Жамол Ургенч») and open the composer party-pre-bound.
//   3. Sahifalar (pages)   — the role-filtered route list with UZ/RU/EN aliases.
// Recents: last 8 opened records (localStorage per user) shown before typing.
// Footer legend; 640px e3 surface; Esc closes; ↑↓/Enter select.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Modal, Spin, Typography, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { asItems, endpoints } from '../lib/api';
import { can, type Capability } from '../lib/permissions';
import { STATUS, PAYMENT_KIND } from '../lib/status-maps';
import { fmtDate, fmtUZS, isSettled } from '../lib/format';
import { BalanceTag } from './BalanceTag';
import { StatusChip } from './StatusChip';
import { KbdHint } from './SmallAtoms';
import type { Role } from '../lib/types';

const ALL: Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER'];
const FIN: Role[] = ['ADMIN', 'ACCOUNTANT'];
const SALES: Role[] = ['ADMIN', 'ACCOUNTANT', 'AGENT'];
const TREASURY: Role[] = ['ADMIN', 'ACCOUNTANT', 'CASHIER'];

// ── Sahifalar: role-filtered to match the App.tsx route guards (never a 403) ──
interface PageCmd { label: string; path: string; roles: Role[]; keywords: string; }
const PAGES: PageCmd[] = [
  { label: 'Ish stoli', path: '/app', roles: ALL, keywords: 'dashboard panel boshqaruv ish stoli glavnaya' },
  { label: 'Buyurtmalar', path: '/orders', roles: SALES, keywords: 'orders buyurtma zakaz' },
  { label: 'Mijozlar', path: '/clients', roles: SALES, keywords: 'clients mijoz klient' },
  { label: 'Agentlar', path: '/agents', roles: FIN, keywords: 'agents agent' },
  { label: "To'lovlar", path: '/payments', roles: ALL, keywords: 'payments tolov oplata pul' },
  { label: 'Qarzlar', path: '/debts', roles: SALES, keywords: 'debts qarz dolg balans undiruv' },
  { label: 'Kassa', path: '/kassa', roles: TREASURY, keywords: 'kassa cash naqd kassa' },
  { label: 'Zavodlar', path: '/factories', roles: FIN, keywords: 'factories zavod' },
  { label: 'Bonus hamyonlar', path: '/bonus', roles: FIN, keywords: 'bonus hamyon wallet' },
  { label: 'Paddonlar', path: '/pallets', roles: SALES, keywords: 'pallets paddon poddon dona' },
  { label: 'Moshinalar', path: '/vehicles', roles: FIN, keywords: 'vehicles moshina avto truck shofyor' },
  { label: 'Mahsulotlar', path: '/products', roles: FIN, keywords: 'products mahsulot gazoblok narx' },
  { label: 'Foydalanuvchilar', path: '/users', roles: ['ADMIN'], keywords: 'users foydalanuvchi login' },
  { label: 'Tizim sozlamalari', path: '/settings', roles: ['ADMIN'], keywords: 'settings sozlama limit' },
  { label: 'Profil', path: '/profile', roles: ALL, keywords: 'profile profil parol email' },
];

// ── Amallar: verb-first, capability-gated (TODO(composers): record pre-binding) ──
interface ActionCmd { label: string; path: string; cap?: Capability; roles?: Role[]; keywords: string; }
const ACTIONS: ActionCmd[] = [
  { label: 'Yangi buyurtma', path: '/orders/new', cap: 'orders.create', keywords: 'new order yangi buyurtma yaratish zakaz' },
  { label: "To'lov qabul qilish", path: '/payments', cap: 'payments.create', keywords: 'tolov qabul client in kirim oplata' },
  { label: "Zavodga to'lash", path: '/payments', roles: FIN, keywords: 'zavodga tolash factory out' },
  { label: "Shofyorga to'lash", path: '/payments', roles: FIN, keywords: 'shofyorga tolash vehicle out haydovchi' },
  { label: 'Paddon qaytarish qabul qilish', path: '/pallets', cap: 'pallets.mutate', keywords: 'paddon qaytarish pallet return' },
];

// ── Recents (localStorage per user, last 8 records) ──
type RecordType = 'client' | 'order' | 'payment';
interface RecentRec { recordType: RecordType; id: string; label: string; sub: string; path: string; }

function recentsKey(userId?: string): string {
  return `sb_recents:${userId ?? 'anon'}`;
}
function readRecents(userId?: string): RecentRec[] {
  try {
    const raw = localStorage.getItem(recentsKey(userId));
    const arr = raw ? (JSON.parse(raw) as RecentRec[]) : [];
    return Array.isArray(arr) ? arr.slice(0, 8) : [];
  } catch {
    return [];
  }
}
function pushRecent(userId: string | undefined, rec: RecentRec): void {
  const prev = readRecents(userId).filter((r) => !(r.recordType === rec.recordType && r.id === rec.id));
  const next = [rec, ...prev].slice(0, 8);
  try {
    localStorage.setItem(recentsKey(userId), JSON.stringify(next));
  } catch {
    /* storage full / disabled — recents are best-effort */
  }
}

// ── the flat navigable entry model (headers are separate; active index skips them) ──
interface Entry {
  id: string;
  label: string;
  meta?: ReactNode;
  path: string;
  /** when set, opening the entry records it in recents */
  recent?: RecentRec;
}
interface Section {
  key: string;
  title: string;
  loading?: boolean;
  entries: Entry[];
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role;

  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  // reset on open
  useEffect(() => {
    if (open) {
      setQ('');
      setDebounced('');
      setActive(0);
    }
  }, [open]);

  // debounce 250ms (03 §2)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const needle = debounced.trim().toLowerCase();
  const searching = needle.length >= 2;

  // federated record search — only the endpoints this role may read (server-scoped)
  const recordsQ = useQuery({
    queryKey: ['palette-search', needle, role],
    enabled: open && searching,
    staleTime: 10_000,
    queryFn: async () => {
      const [clients, orders, payments] = await Promise.all([
        can(role, 'clients.view')
          ? endpoints.clients({ search: needle, pageSize: 5 }).then(asItems).catch(() => [])
          : Promise.resolve([]),
        can(role, 'orders.view')
          ? endpoints.orders({ search: needle, pageSize: 5 }).then((r) => r.items ?? []).catch(() => [])
          : Promise.resolve([]),
        can(role, 'payments.view')
          ? endpoints.payments({ search: needle, pageSize: 5 }).then((r) => r.items ?? []).catch(() => [])
          : Promise.resolve([]),
      ]);
      return { clients, orders, payments };
    },
  });

  const recents = useMemo(() => (open ? readRecents(user?.id) : []), [open, user?.id]);

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];

    const allowedActions = ACTIONS.filter((a) =>
      a.cap ? can(role, a.cap) : a.roles ? !!role && a.roles.includes(role) : true,
    );
    const allowedPages = PAGES.filter((p) => !!role && p.roles.includes(role));

    if (!searching) {
      if (recents.length > 0) {
        out.push({
          key: 'recents',
          title: "So'nggi",
          entries: recents.map((r) => ({
            id: `recent-${r.recordType}-${r.id}`,
            label: r.label,
            meta: <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.sub}</Typography.Text>,
            path: r.path,
            recent: r,
          })),
        });
      }
      out.push({
        key: 'actions',
        title: 'Amallar',
        entries: allowedActions.map((a) => ({ id: `action-${a.label}`, label: a.label, path: a.path })),
      });
      out.push({
        key: 'pages',
        title: 'Sahifalar',
        entries: allowedPages.map((p) => ({ id: `page-${p.path}`, label: p.label, path: p.path })),
      });
      return out;
    }

    // ── searching ──
    const data = recordsQ.data;
    const recEntries: Entry[] = [];
    if (data) {
      for (const c of data.clients) {
        const bal = c.balance ?? '0';
        recEntries.push({
          id: `client-${c.id}`,
          label: c.name,
          meta: <BalanceTag balance={bal} partyType="client" compact pallets={c.palletBalance} />,
          path: `/clients/${c.id}`,
          recent: {
            recordType: 'client',
            id: c.id,
            label: c.name,
            sub: isSettled(bal) ? 'Hisob yopiq' : fmtUZS(bal),
            path: `/clients/${c.id}`,
          },
        });
      }
      for (const o of data.orders) {
        const st = STATUS[o.status];
        recEntries.push({
          id: `order-${o.id}`,
          label: o.orderNo,
          meta: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtDate(o.date)}</Typography.Text>
              <StatusChip meta={st} />
            </span>
          ),
          path: `/orders/${o.id}`,
          recent: {
            recordType: 'order',
            id: o.id,
            label: o.orderNo,
            sub: `${fmtDate(o.date)} · ${st.label}`,
            path: `/orders/${o.id}`,
          },
        });
      }
      for (const p of data.payments) {
        const kind = PAYMENT_KIND[p.kind]?.label ?? p.kind;
        recEntries.push({
          id: `payment-${p.id}`,
          label: fmtUZS(p.amount),
          meta: <Typography.Text type="secondary" style={{ fontSize: 12 }}>{kind} · {fmtDate(p.date)}</Typography.Text>,
          path: `/payments/${p.id}`,
          recent: {
            recordType: 'payment',
            id: p.id,
            label: fmtUZS(p.amount),
            sub: `${kind} · ${fmtDate(p.date)}`,
            path: `/payments/${p.id}`,
          },
        });
      }
    }
    out.push({ key: 'records', title: 'Yozuvlar', loading: recordsQ.isFetching, entries: recEntries });

    const match = (label: string, keywords: string) => (label + ' ' + keywords).toLowerCase().includes(needle);
    out.push({
      key: 'actions',
      title: 'Amallar',
      entries: allowedActions
        .filter((a) => match(a.label, a.keywords))
        .map((a) => ({ id: `action-${a.label}`, label: a.label, path: a.path })),
    });
    out.push({
      key: 'pages',
      title: 'Sahifalar',
      entries: allowedPages
        .filter((p) => match(p.label, p.keywords))
        .map((p) => ({ id: `page-${p.path}`, label: p.label, path: p.path })),
    });
    return out;
  }, [searching, needle, recents, role, recordsQ.data, recordsQ.isFetching]);

  // flatten for keyboard navigation (headers are not selectable)
  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  useEffect(() => {
    setActive((a) => (flat.length === 0 ? 0 : Math.min(a, flat.length - 1)));
  }, [flat.length]);

  const openEntry = (entry: Entry) => {
    if (entry.recent) pushRecent(user?.id, entry.recent);
    onClose();
    navigate(entry.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      const entry = flat[active];
      if (entry) {
        e.preventDefault();
        openEntry(entry);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // running index so section entries map onto the flat active cursor
  let cursor = -1;
  const nonEmpty = sections.filter((s) => s.entries.length > 0 || s.loading);
  const showNoResults = searching && !recordsQ.isFetching && flat.length === 0;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={640}
      style={{ top: 96 }}
      styles={{
        body: { padding: 0 },
        container: { padding: 0, overflow: 'hidden', boxShadow: 'var(--sb-shadow-e3)' },
      }}
      destroyOnHidden
      maskClosable
    >
      <div style={{ padding: '4px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Input
          autoFocus
          size="large"
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="Qidiruv… (mijoz, buyurtma, to'lov, amal, sahifa)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          variant="borderless"
        />
      </div>

      <div style={{ maxHeight: 440, overflowY: 'auto', padding: 8 }}>
        {nonEmpty.map((section) => (
          <div key={section.key} style={{ marginBottom: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                color: token.colorTextTertiary,
              }}
            >
              {section.title}
              {section.loading ? <Spin size="small" /> : null}
            </div>
            {section.entries.map((entry) => {
              cursor += 1;
              const idx = cursor;
              const isActive = idx === active;
              return (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={-1}
                  onClick={() => openEntry(entry)}
                  onMouseEnter={() => setActive(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: 'pointer',
                    borderRadius: token.borderRadiusSM,
                    padding: '8px 12px',
                    background: isActive ? token.colorPrimaryBg : undefined,
                  }}
                >
                  <Typography.Text style={{ fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {entry.label}
                  </Typography.Text>
                  {entry.meta ? <span style={{ flex: '0 0 auto' }}>{entry.meta}</span> : null}
                </div>
              );
            })}
          </div>
        ))}

        {showNoResults ? (
          <div style={{ padding: '20px 12px', textAlign: 'center' }}>
            <Typography.Text type="secondary">Hech narsa topilmadi</Typography.Text>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '8px 12px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          color: token.colorTextTertiary,
          fontSize: 12,
        }}
      >
        <span><KbdHint>↑↓</KbdHint> tanlash</span>
        <span><KbdHint>Enter</KbdHint> ochish</span>
        <span><KbdHint>Esc</KbdHint> yopish</span>
      </div>
    </Modal>
  );
}
