// /payments — To'lovlar. ONE unified surface: the whole-system transactions journal
// (every money movement across all cashboxes & sources — payments, expenses, bonus,
// manual, storno) AND the place every payment is created. A row opens the right detail:
// PAYMENT rows → the full PaymentPeek (allocation · void · receipt), other rows → a
// compact read-only detail (both inside TransactionsJournal). The «Yangi to'lov» dropdown
// creates any payment kind. Deep links: /payments/:id and legacy ?paymentId= → ?peek=.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Dropdown } from 'antd';
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { can } from '../lib/permissions';
import { useIsPhone } from '../lib/responsive';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../components/LangContext';
import type { PaymentKind } from '../lib/types';
import { PageHeader, PaymentComposer, PaymentPeek, TransactionsJournal } from '../components';

/** the six creatable intents, ordered: CLIENT_IN primary, rest follow. */
const INTENTS: { kind: PaymentKind; label: string }[] = [
  { kind: 'CLIENT_IN', label: "To'lov qabul qilish" },
  { kind: 'FACTORY_OUT', label: "Zavodga to'lash" },
  { kind: 'VEHICLE_OUT', label: "Shofyorga to'lash" },
  { kind: 'CLIENT_REFUND', label: 'Mijozga qaytarish' },
  { kind: 'FACTORY_REFUND', label: 'Zavoddan qaytim' },
  { kind: 'TRANSPORT_DIRECT', label: "Mijoz shofyorga to'ladi" },
];

export default function Payments() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [sp, setSp] = useSearchParams();
  const uf = useUrlFilters();
  const { user } = useAuth();
  const isPhone = useIsPhone();

  const role = user?.role ?? null;
  const isAgent = role === 'AGENT';
  const canCreate = can(role, 'payments.create'); // A/B/K/G

  // ── legacy deep link ?paymentId= → ?peek= (no dead link survives) ──
  useEffect(() => {
    const legacy = sp.get('paymentId');
    if (!legacy) return;
    const next = new URLSearchParams(sp);
    next.delete('paymentId');
    next.set('peek', legacy);
    setSp(next, { replace: true });
  }, [sp, setSp]);

  // ── peek: ?peek=<id> (canonical) or the /payments/:id route alias ──
  const routeId = params.id;
  const peekParam = uf.get('peek');
  const peekId = routeId || peekParam || null;
  const peekFromRoute = !!routeId;

  const openPeek = (id: string) => {
    if (peekFromRoute) navigate(`/payments/${id}${location.search}`);
    else uf.set({ peek: id });
  };
  const closePeek = () => {
    if (peekFromRoute) navigate(`/payments${location.search}`);
    else uf.set({ peek: null });
  };

  // ── composer (kind-first entry drawer) — transient, not a URL/list concern ──
  const [composerKind, setComposerKind] = useState<PaymentKind | null>(null);
  const openComposer = (kind: PaymentKind) => setComposerKind(kind);
  const closeComposer = () => setComposerKind(null);

  // ── N = To'lov qabul qilish ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if ((e.key === 'n' || e.key === 'N') && canCreate && !composerKind) {
        e.preventDefault();
        openComposer('CLIENT_IN');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, composerKind]);

  // ── payment-create intents (per role) — the «Yangi to'lov» dropdown ──
  const intents = isAgent ? INTENTS.filter((i) => i.kind === 'CLIENT_IN') : INTENTS;

  return (
    <div>
      <PageHeader
        title="To'lovlar"
        subtitle="Loyihadagi barcha pul harakatlari — hammasi shu yerda ko'rinadi va shu yerdan qilinadi"
        accent
      />

      {/* telefonda asosiy amal butun kenglikni egallaydi (bosh barmoq uchun) */}
      {canCreate ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: isPhone ? 12 : 16 }}>
          <Dropdown
            trigger={['click']}
            menu={{
              items: intents.map((it) => ({ key: it.kind, label: t(it.label), onClick: () => openComposer(it.kind) })),
            }}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              block={isPhone}
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', border: 'none', fontWeight: 600,
                ...(isPhone ? { height: 44 } : null),
              }}
            >
              {t("Yangi to'lov")} <DownOutlined />
            </Button>
          </Dropdown>
        </div>
      ) : null}

      {/* the single, whole-system transactions journal */}
      <TransactionsJournal onOpenPayment={openPeek} />

      {/* docked money-document surface — void + SettleDrawer(?panel=taqsimlash) live inside */}
      <PaymentPeek paymentId={peekId} open={!!peekId} onClose={closePeek} />

      {/* kind-first entry drawer — launched by the dropdown / N */}
      <PaymentComposer open={!!composerKind} kind={composerKind ?? 'CLIENT_IN'} onClose={closeComposer} />
    </div>
  );
}
