// /payments — To'lovlar (register). The append-only book of every money document
// (money.md §1). Rebuilt on the foundation: PageHeader intent buttons, the URL-
// synced FilterBar, the one DataTable (peekable), the docked PaymentPeek at
// ?peek=<id> / route alias /payments/:id, the kind-first PaymentComposer, and the
// SettleDrawer via ?panel=taqsimlash (opened by the peek). All list state lives in
// the URL (useUrlFilters); every endpoint is the existing api.ts surface.
//
// §11 feature-loss audit — everything the old 961-line page did is preserved:
//   • all 7 filters (kind · method · client · factory · search · date · voided)
//     → FilterBar; voided is now the tri-state «Bekorlar» (hide/show/only §1.5);
//   • reconciled tri-state «Tekshiruv» + the Taqsimlanmagan (chip=alloc-open) and
//     Tekshirilmagan (reconciled=false) worklists (§5) as SavedViews / chip;
//   • create → PaymentComposer (kind-first, no silent field-wipe); allocation →
//     SettleDrawer (over-allocation unreachable); void → ReasonModal + impact
//     preview (both inside the peek); detail Drawer → URL PeekPanel; legacy
//     ?paymentId= normalized to ?peek=; idempotency-key-per-open, USD equation,
//     pagination, party text, kassa column all kept.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Dropdown, Segmented, theme } from 'antd';
import type { MenuProps } from 'antd';
import { CloseOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { endpoints } from '../lib/api';
import { fmtDate, fmtMoney, fmtNum, num } from '../lib/format';
import { PAYMENT_KIND, PAYMENT_METHOD, UNRECONCILED, type StatusMeta } from '../lib/status-maps';
import { can } from '../lib/permissions';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useAuth } from '../auth/AuthContext';
import type { Payment, PaymentKind } from '../lib/types';
import {
  DataTable,
  FilterBar,
  MoneyCell,
  PageHeader,
  PaymentComposer,
  PaymentPeek,
  StatusChip,
  TableCard,
  TransactionsJournal,
  totalsRow,
  type FilterField,
  type MoneyVariant,
  type PageHeaderAction,
  type QueryLike,
  type SavedView,
  type SbColumn,
} from '../components';

// ── domain constants ──────────────────────────────────────────────────────────
const ALLOCATABLE = new Set<PaymentKind>(['CLIENT_IN', 'FACTORY_OUT', 'VEHICLE_OUT', 'TRANSPORT_DIRECT']);
const IN_KINDS = new Set<PaymentKind>(['CLIENT_IN', 'FACTORY_REFUND']);
const OUT_KINDS = new Set<PaymentKind>(['FACTORY_OUT', 'CLIENT_REFUND', 'VEHICLE_OUT']);

/** danger chip for a voided document (matches CANCELLED ink, 02 §2.5). */
const VOID_META: StatusMeta = { label: 'Bekor qilingan', light: '#C2413B', dark: '#E8827C', filled: true };
/** positive dot for a reconciled, live payment (the amber «Tekshirilmagan» inverse). */
const RECONCILED_META: StatusMeta = { label: 'Tekshirilgan', light: '#1A7F37', dark: '#6CC495' };

/** the six creatable intents, ordered: CLIENT_IN primary, rest to the overflow kebab. */
const INTENTS: { kind: PaymentKind; label: string }[] = [
  { kind: 'CLIENT_IN', label: "To'lov qabul qilish" },
  { kind: 'FACTORY_OUT', label: "Zavodga to'lash" },
  { kind: 'VEHICLE_OUT', label: "Shofyorga to'lash" },
  { kind: 'CLIENT_REFUND', label: 'Mijozga qaytarish' },
  { kind: 'FACTORY_REFUND', label: 'Zavoddan qaytim' },
  { kind: 'TRANSPORT_DIRECT', label: "Mijoz shofyorga to'ladi" },
];

// ── pure helpers (no hooks) ────────────────────────────────────────────────────
const monthStart = (): string => dayjs().startOf('month').format('YYYY-MM-DD');
const today = (): string => dayjs().format('YYYY-MM-DD');

/** amount − Σ active allocations (the list payload embeds active allocations, fact 0.2). */
function remainderOf(p: Payment): number {
  const allocated = (p.allocations ?? []).reduce((s, a) => s + (a.voidedAt ? 0 : num(a.amount)), 0);
  return num(p.amount) - allocated;
}

function amountVariant(p: Payment): MoneyVariant {
  if (p.voidedAt) return 'ghost';
  return IN_KINDS.has(p.kind) ? 'in' : 'neutral';
}

function partyCell(p: Payment): ReactNode {
  const link = (to: string, label: string) => <Link to={to}>{label}</Link>;
  if (p.kind === 'TRANSPORT_DIRECT') {
    return (
      <span>
        {p.clientId && p.client ? link(`/clients/${p.clientId}`, p.client.name) : '—'}
        {' → '}
        {p.vehicleId && p.vehicle ? link(`/vehicles/${p.vehicleId}`, p.vehicle.name) : '—'}
      </span>
    );
  }
  if (p.clientId && p.client) return link(`/clients/${p.clientId}`, p.client.name);
  if (p.factoryId && p.factory) return link(`/factories/${p.factoryId}`, p.factory.name);
  if (p.vehicleId && p.vehicle)
    return link(`/vehicles/${p.vehicleId}`, p.vehicle.name + (p.vehicle.plate ? ` (${p.vehicle.plate})` : ''));
  return '—';
}

/** «Taqsimot» mini-bar + caption from the row's embedded active allocations (§5.1). */
function AllocCell({ p }: { p: Payment }) {
  const { token } = theme.useToken();
  if (p.voidedAt || !ALLOCATABLE.has(p.kind)) {
    return <span style={{ color: token.colorTextTertiary }}>—</span>;
  }
  const amount = num(p.amount);
  const remainder = remainderOf(p);
  const pct = amount > 0 ? Math.min(1, Math.max(0, (amount - remainder) / amount)) : 0;
  const full = remainder < 1;
  return (
    <div style={{ width: 120 }}>
      <div style={{ height: 5, borderRadius: 999, background: token.colorFillSecondary, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct * 100}%`,
            borderRadius: 999,
            background: full ? 'var(--sb-money-in)' : token.colorPrimary,
          }}
        />
      </div>
      <div style={{ marginTop: 3, fontSize: 11, color: full ? 'var(--sb-money-in)' : token.colorWarning }}>
        {full ? "to'liq" : `qoldiq ${fmtMoney(remainder)}`}
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────────
export default function Payments() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [sp, setSp] = useSearchParams();
  const uf = useUrlFilters();
  const { user } = useAuth();

  const role = user?.role ?? null;
  const isAgent = role === 'AGENT';
  const canAllocate = can(role, 'payments.allocate'); // A/B
  const canVoid = can(role, 'payments.void'); // A/B
  const canCreate = can(role, 'payments.create'); // A/B/K/G

  // ── legacy deep link ?paymentId= → ?peek= (no dead link survives, §1.5) ──
  useEffect(() => {
    const legacy = sp.get('paymentId');
    if (!legacy) return;
    const next = new URLSearchParams(sp);
    next.delete('paymentId');
    next.set('peek', legacy);
    setSp(next, { replace: true });
  }, [sp, setSp]);

  // ── URL → query params (single source of truth) ──
  const search = uf.get('search') || undefined;
  const kindUrl = uf.get('kind'); // lowercase in the URL (client_in…)
  const kindApi = kindUrl ? (kindUrl.toUpperCase() as string) : undefined;
  const method = uf.get('method') || undefined;
  const clientId = uf.get('clientId') || undefined;
  const factoryId = isAgent ? undefined : uf.get('factoryId') || undefined;
  const from = uf.get('from') || undefined;
  const to = uf.get('to') || undefined;
  const voidedState = uf.get('voided'); // '' | 'show' | 'only'
  const voidedInclude = voidedState === 'show' || voidedState === 'only' ? true : undefined;
  const onlyVoided = voidedState === 'only';
  const reconciledUrl = uf.get('reconciled'); // '' | 'true' | 'false'
  const reconciled = reconciledUrl === 'true' ? true : reconciledUrl === 'false' ? false : undefined;
  const chipMode = uf.get('chip') === 'alloc-open';
  const chipFrom = from || monthStart();

  const page = Number(uf.get('page')) || 1;
  const pageSize = Number(uf.get('pageSize')) || 20;

  // ── view: «Tranzaksiyalar» (whole money journal, default) vs «To'lov hujjatlari» (register) ──
  const view = uf.get('view') === 'register' ? 'register' : 'journal';

  // ── the register query — server-paginated normally; a 200-row scan in chip mode ──
  const listQ = useQuery({
    queryKey: [
      'payments',
      'list',
      chipMode
        ? { chip: 'alloc-open', from: chipFrom, search, kindApi, method, clientId, factoryId }
        : { page, pageSize, search, kindApi, method, clientId, factoryId, from, to, voidedInclude, reconciled },
    ],
    queryFn: () =>
      endpoints.payments(
        chipMode
          ? { pageSize: 200, dateFrom: chipFrom, search, kind: kindApi, method, clientId, factoryId }
          : {
              page,
              pageSize,
              search,
              kind: kindApi,
              method,
              clientId,
              factoryId,
              dateFrom: from,
              dateTo: to,
              voided: voidedInclude,
              reconciled,
            },
      ),
    placeholderData: keepPreviousData,
    enabled: view === 'register', // the journal view has its own query
  });

  const serverItems = listQ.data?.items ?? [];

  // client-derived modes yield a plain array (AntD then client-paginates it);
  // the pure server mode passes the Paged payload straight through.
  const clientFiltered = chipMode
    ? serverItems.filter((p) => !p.voidedAt && ALLOCATABLE.has(p.kind) && remainderOf(p) >= 1)
    : onlyVoided
      ? serverItems.filter((p) => !!p.voidedAt)
      : null;

  const displayQuery: QueryLike<Payment> = {
    data: clientFiltered ?? listQ.data,
    isLoading: listQ.isLoading,
    isFetching: listQ.isFetching,
    isError: listQ.isError,
    error: listQ.error,
    refetch: listQ.refetch,
  };

  // rows actually on the visible page (for peek triage + CSV + totals fallback)
  const visibleRows = clientFiltered
    ? clientFiltered.slice((page - 1) * pageSize, page * pageSize)
    : serverItems;
  const rowIds = visibleRows.map((p) => p.id);
  const resultCount = clientFiltered ? clientFiltered.length : listQ.data?.total ?? 0;

  // ── peek: ?peek=<id> (canonical) or the /payments/:id route alias ──
  const routeId = params.id;
  const peekParam = uf.get('peek');
  const peekId = routeId || peekParam || null;
  const peekFromRoute = !!routeId;

  const openPeek = (id: string) => {
    if (peekFromRoute) navigate(`/payments/${id}${location.search}`);
    else uf.set({ peek: id });
  };
  const navPeek = (id: string) => {
    if (peekFromRoute) navigate(`/payments/${id}${location.search}`, { replace: true });
    else uf.set({ peek: id }, { replace: true });
  };
  const closePeek = () => {
    if (peekFromRoute) navigate(`/payments${location.search}`);
    else uf.set({ peek: null });
  };
  const togglePeek = (id: string) => (peekId === id ? closePeek() : openPeek(id));

  /** open the peek already switched to the allocation workbench (row kebab «Taqsimlash»). */
  const openSettle = (id: string) => {
    const next = new URLSearchParams(sp);
    next.set('peek', id);
    next.set('panel', 'taqsimlash');
    setSp(next);
  };

  // ── composer (kind-first entry drawer) — transient, not a URL/list concern ──
  const [composerKind, setComposerKind] = useState<PaymentKind | null>(null);
  const openComposer = (kind: PaymentKind) => setComposerKind(kind);
  const closeComposer = () => setComposerKind(null);

  // ── realtime row pulse (one-shot on the documents this page just created) ──
  const [pulseId, setPulseId] = useState<string | null>(null);
  const pulse = (id: string) => {
    setPulseId(id);
    window.setTimeout(() => setPulseId((cur) => (cur === id ? null : cur)), 1200);
  };

  // ── N = To'lov qabul qilish (§1.6) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if ((e.key === 'n' || e.key === 'N') && canCreate && !composerKind) {
        e.preventDefault();
        openComposer('CLIENT_IN');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, composerKind]);

  // ── header intent actions (per role, §1.4 / §9) ──
  const intents = isAgent ? INTENTS.filter((i) => i.kind === 'CLIENT_IN') : INTENTS;
  const actions: PageHeaderAction[] = canCreate
    ? intents.map((it, i) => ({
        key: it.kind,
        label: it.label,
        icon: i === 0 ? <PlusOutlined /> : undefined,
        primary: i === 0,
        kbd: i === 0 ? 'N' : undefined,
        onClick: () => openComposer(it.kind),
      }))
    : [];

  // ── FilterBar schema (§1.5) ──
  const kindOptions = (Object.keys(PAYMENT_KIND) as PaymentKind[]).map((k) => ({
    label: PAYMENT_KIND[k].label,
    value: k.toLowerCase(),
  }));
  const methodOptions = (Object.keys(PAYMENT_METHOD) as (keyof typeof PAYMENT_METHOD)[]).map((m) => ({
    label: PAYMENT_METHOD[m].label,
    value: m,
  }));

  const schema: FilterField[] = [
    { key: 'kind', label: 'Turi', type: 'select', options: kindOptions, hidden: isAgent, placeholder: "To'lov turi" },
    { key: 'method', label: 'Usul', type: 'select', options: methodOptions, placeholder: 'Usul' },
    { key: 'clientId', label: 'Mijoz', type: 'party', partyType: 'client' },
    { key: 'factoryId', label: 'Zavod', type: 'party', partyType: 'factory', hidden: isAgent },
    {
      key: 'reconciled',
      label: 'Tekshiruv',
      type: 'select',
      options: [
        { label: 'Tekshirilmagan', value: 'false' },
        { label: 'Tekshirilgan', value: 'true' },
      ],
      placeholder: 'Tekshiruv holati',
    },
    {
      key: 'voided',
      label: 'Bekorlar',
      type: 'tristate',
      triLabels: { hide: 'Yashirish', show: "Ko'rsatish", only: 'Faqat' },
    },
    { key: 'date', label: 'Sana', type: 'daterange' },
  ];

  const builtins: SavedView[] = [
    { id: 'unreconciled', label: 'Tekshirilmagan', query: 'reconciled=false', builtin: true },
    { id: 'today-in', label: 'Bugungi kirimlar', query: `from=${today()}&kind=client_in&to=${today()}`, builtin: true },
    { id: 'alloc-open', label: 'Taqsimlanmagan', query: 'chip=alloc-open', builtin: true, starred: true },
  ];

  // ── FilterBar captions (honest windows for the client-derived modes) ──
  const captionPills = (
    <>
      {chipMode ? (
        <CaptionPill
          label={`Taqsimlanmagan — oyna: ${from ? `${fmtDate(from)} dan` : 'Shu oy'}`}
          onClear={() => uf.set({ chip: null })}
        />
      ) : null}
      {onlyVoided ? (
        <span style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
          faqat bekorlar (sahifada)
        </span>
      ) : null}
    </>
  );

  // ── columns ──
  const columns: SbColumn<Payment>[] = [
    {
      title: 'Sana',
      key: 'date',
      dataIndex: 'date',
      columnKey: 'date',
      width: 96,
      sortable: true,
      render: (v: string) => fmtDate(v),
    },
    {
      title: 'Turi',
      key: 'kind',
      columnKey: 'kind',
      width: 168,
      render: (_: unknown, r: Payment) => <StatusChip meta={PAYMENT_KIND[r.kind]} />,
    },
    {
      title: 'Usul',
      key: 'method',
      columnKey: 'method',
      width: 148,
      render: (_: unknown, r: Payment) => (
        <div>
          <div>{PAYMENT_METHOD[r.method]?.label ?? r.method}</div>
          {r.method === 'USD' ? (
            <div className="num" style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {fmtNum(r.usdAmount, 2)} $ × {fmtMoney(r.rate)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Tomon',
      key: 'party',
      columnKey: 'party',
      ellipsis: true,
      render: (_: unknown, r: Payment) => partyCell(r),
    },
    {
      title: "Summa (so'm)",
      key: 'amount',
      dataIndex: 'amount',
      columnKey: 'amount',
      align: 'right',
      width: 150,
      className: 'num',
      sortable: true,
      render: (_: unknown, r: Payment) => <MoneyCell value={r.amount} variant={amountVariant(r)} strong />,
    },
    {
      title: 'Taqsimot',
      key: 'alloc',
      columnKey: 'alloc',
      width: 140,
      render: (_: unknown, r: Payment) => <AllocCell p={r} />,
    },
    {
      title: 'Kassa',
      key: 'cashbox',
      columnKey: 'cashbox',
      width: 130,
      ellipsis: true,
      render: (_: unknown, r: Payment) => r.cashbox?.name ?? '—',
    },
    {
      title: 'Holat',
      key: 'state',
      columnKey: 'state',
      width: 140,
      render: (_: unknown, r: Payment) =>
        r.voidedAt ? (
          <div>
            <StatusChip meta={VOID_META} variant="filled" />
            {r.voidReason ? (
              <div
                title={r.voidReason}
                style={{
                  fontSize: 11,
                  color: token.colorTextTertiary,
                  marginTop: 2,
                  maxWidth: 128,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.voidReason}
              </div>
            ) : null}
          </div>
        ) : !r.reconciled ? (
          <StatusChip meta={UNRECONCILED} />
        ) : (
          <StatusChip meta={RECONCILED_META} />
        ),
    },
    {
      title: '',
      key: 'actions',
      columnKey: 'actions',
      width: 48,
      align: 'center',
      render: (_: unknown, r: Payment) => renderKebab(r),
    },
  ];

  // labeled per-row kebab (§1.4 — icon-only pairs are extinct). A plain render
  // function (not a nested component) so the Dropdown type stays stable per render.
  function renderKebab(p: Payment): ReactNode {
    const receiptGuarded = !!p.voidedAt || p.kind === 'TRANSPORT_DIRECT';
    const showSettle = canAllocate && ALLOCATABLE.has(p.kind) && !p.voidedAt && remainderOf(p) >= 1;

    const items: NonNullable<MenuProps['items']> = [
      { key: 'label', type: 'group', label: `TO'LOV ${fmtDate(p.date)} · ${fmtMoney(p.amount)} so'm` },
      { key: 'open', label: 'Ochish' },
    ];
    if (showSettle) items.push({ key: 'settle', label: 'Taqsimlash' });
    items.push({ key: 'receipt', label: 'Kvitansiya chop etish', disabled: receiptGuarded });
    if (canVoid && !p.voidedAt) {
      items.push({ type: 'divider' });
      items.push({ key: 'void', label: 'Bekor qilish', danger: true });
    }

    const onClick: MenuProps['onClick'] = (info) => {
      info.domEvent.stopPropagation();
      switch (info.key) {
        case 'open':
          openPeek(p.id);
          break;
        case 'settle':
          openSettle(p.id);
          break;
        case 'receipt':
          if (!receiptGuarded) navigate(`/print/receipt/${p.id}`);
          break;
        case 'void':
          openPeek(p.id); // void ritual (ReasonModal + impact) lives in the peek footer
          break;
      }
    };

    return (
      <Dropdown menu={{ items, onClick }} trigger={['click']} placement="bottomRight">
        <Button
          type="text"
          size="small"
          icon={<MoreOutlined />}
          aria-label={`${PAYMENT_KIND[p.kind].label} ${fmtDate(p.date)} amallari`}
          onClick={(e) => e.stopPropagation()}
        />
      </Dropdown>
    );
  }

  // ── pinned «Sahifa jami» — per-direction split over the visible page (02 §6) ──
  const summary = (pageData: readonly Payment[]) => {
    const live = pageData.filter((p) => !p.voidedAt);
    const kirim = live.filter((p) => IN_KINDS.has(p.kind)).reduce((s, p) => s + num(p.amount), 0);
    const chiqim = live.filter((p) => OUT_KINDS.has(p.kind)).reduce((s, p) => s + num(p.amount), 0);
    const transport = live
      .filter((p) => p.kind === 'TRANSPORT_DIRECT')
      .reduce((s, p) => s + num(p.amount), 0);
    const net = kirim - chiqim;

    const breakdown = (
      <span style={{ fontSize: 12, color: token.colorTextSecondary, display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
        {kirim > 0 ? (
          <span>
            Kirim <MoneyCell value={kirim} variant="in" signed />
          </span>
        ) : null}
        {chiqim > 0 ? (
          <span>
            · Chiqim <MoneyCell value={-chiqim} variant="neutral" signed />
          </span>
        ) : null}
        {transport > 0 ? (
          <span>
            · Kassadan tashqari <MoneyCell value={transport} variant="neutral" />
          </span>
        ) : null}
        {kirim === 0 && chiqim === 0 && transport === 0 ? <span>—</span> : null}
      </span>
    );

    return totalsRow({
      scope: 'page',
      label: 'Sahifa jami',
      labelColSpan: 4, // Sana · Turi · Usul · Tomon
      cells: [
        {
          index: 4,
          align: 'right',
          content: <MoneyCell value={net} variant={net >= 0 ? 'in' : 'neutral'} signed strong suffix="so'm" />,
        },
        { index: 5, colSpan: 4, align: 'left', strong: false, content: breakdown },
      ],
    });
  };

  return (
    <div>
      <PageHeader
        title="To'lovlar"
        subtitle="Barcha pul harakatlari — naqd va bank tranzaksiyalari"
        accent
        actions={actions}
      />

      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={view}
          onChange={(v) => uf.set({ view: v === 'register' ? 'register' : null })}
          options={[
            { value: 'journal', label: 'Tranzaksiyalar' },
            { value: 'register', label: "To'lov hujjatlari" },
          ]}
        />
      </div>

      {view === 'register' ? (
        <>
          <div style={{ marginBottom: 16 }}>
            <FilterBar
              schema={schema}
              searchKey="search"
              searchPlaceholder="Qidirish (izoh, mijoz, zavod)"
              savedViewsKey="/payments"
              savedViewsBuiltins={builtins}
              resultMeta={
                <span className="num" style={{ color: token.colorTextSecondary, fontSize: 13, whiteSpace: 'nowrap' }}>
                  Jami: {fmtNum(resultCount)} ta
                </span>
              }
            >
              {captionPills}
            </FilterBar>
          </div>

          <TableCard title="To'lovlar ro'yxati" loading={listQ.isFetching}>
            <DataTable<Payment>
              columns={columns}
              query={displayQuery}
              rowKey="id"
              peekable
              onRowOpen={(r) => openPeek(r.id)}
              onPeek={(r) => togglePeek(r.id)}
              summary={summary}
              ghostWhen={(r) => !!r.voidedAt}
              rowClassName={(r) => (pulseId && r.id === pulseId ? 'pulse-row' : '')}
              defaultPageSize={20}
              emptyText="Hali to'lov yo'q"
              emptyAction={
                canCreate ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openComposer('CLIENT_IN')}>
                    To'lov qabul qilish
                  </Button>
                ) : undefined
              }
              scroll={{ x: 1120 }}
            />
          </TableCard>
        </>
      ) : (
        <TransactionsJournal onOpenPayment={openPeek} />
      )}

      {/* docked money-document surface (§2) — void + SettleDrawer(?panel=taqsimlash) live inside */}
      <PaymentPeek
        paymentId={peekId}
        open={!!peekId}
        onClose={closePeek}
        rowIds={view === 'register' ? rowIds : undefined}
        activeId={peekId ?? undefined}
        onNavigate={navPeek}
      />

      {/* kind-first entry drawer (§3) — launched by the header intents / N / empty action */}
      <PaymentComposer
        open={!!composerKind}
        kind={composerKind ?? 'CLIENT_IN'}
        onClose={closeComposer}
        onSuccess={(p) => pulse(p.id)}
      />
    </div>
  );
}

// ── a removable caption pill for a client-derived scan window (03 §6) ──
function CaptionPill({ label, onClear }: { label: string; onClear: () => void }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 8px',
        borderRadius: token.borderRadiusSM,
        border: `1px solid ${token.colorWarningBorder}`,
        background: token.colorWarningBg,
        color: token.colorWarningText,
        fontSize: 13,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      <CloseOutlined
        aria-label="Filtrni olib tashlash"
        style={{ fontSize: 10, cursor: 'pointer' }}
        onClick={onClear}
      />
    </span>
  );
}
