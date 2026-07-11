// The worklist engine (03 §6) — the finite, countable queues that go to zero,
// implemented as react-query hooks. Each hook returns a WorklistResult
// { count, sum?, top3, drillTo, window? } for a WorklistCard; the two
// aggregators (useOwnerWorklists / useAgentWorklists) return them severity-
// ordered for the InboxRail.
//
// HONESTY GOVERNANCE (03 §6, binding): a queue count comes from a SERVER FILTER
// or a BOUNDED, VISIBLY-LABELED client scan — never a faked badge. Every
// client-derived queue carries a `window` label; a scan that hit its page cap
// carries a `note`. Endpoints are verified against apps/api (see screens/money.md
// §0 and orders.md §0) — no endpoint here is invented.
//
// Query keys are ENTITY-NAME-FIRST (locked contract with lib/realtime.ts): the
// realtime invalidator maps order/payment/client/etc. change events onto the
// ['orders' | 'payments' | 'debts' | 'clients' | 'vehicles', …] key families, so
// every queue self-refreshes on the (2s-coalesced) socket bursts.
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { asItems, endpoints } from './api';
import { num } from './format';
import { useAuth } from '../auth/AuthContext';
import type { Money, Order, Paged, Payment, Vehicle } from './types';

// ── shared queue vocabulary ────────────────────────────────────────────────

/** Severity fixes the InboxRail order (danger → violet → warning → neutral). */
export type QueueSeverity = 'danger' | 'violet' | 'warning' | 'neutral';

/** MoneyCell-compatible subset (kept local so lib/ never imports components/). */
export type WorklistMoneyVariant = 'neutral' | 'in' | 'owedToUs' | 'weOwe';

/** A single top-3 preview row: party · figure · age, click opens the record. */
export interface WorklistPreview {
  id: string;
  /** primary identity line (party / order no · party) */
  title: string;
  /** secondary meta — age / count / status word (never colour-only) */
  meta?: string;
  /** money figure (server decimal string or computed number) */
  amount?: Money | number;
  moneyVariant?: WorklistMoneyVariant;
  /** in-kind figure (dona) when the queue is pallet-shaped */
  qty?: number;
  /** where a click on this row goes — the record itself */
  to: string;
}

/** One queue, ready for a WorklistCard. */
export interface WorklistResult {
  /** stable queue id (matches the `chip=` recipe where one exists) */
  key: string;
  /** Uzbek card title (canonical glossary, 03 §12) */
  title: string;
  severity: QueueSeverity;
  count: number;
  /** Σ where the queue is money-shaped (computed number); omitted otherwise */
  sum?: number;
  /** Σ where the queue is in-kind (dona) */
  sumQty?: number;
  top3: WorklistPreview[];
  /** «Hammasi →» filtered register URL */
  drillTo: string;
  /** client-derived scan window label (03 §6); omitted for pure server filters */
  window?: string;
  /** honest-degradation note (e.g. the scan hit its page cap) */
  note?: string;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

interface QueueOptions {
  enabled?: boolean;
}

// ── window helpers (Tashkent-local calendar days, 02 §7) ────────────────────

const monthStart = (): string => dayjs().startOf('month').format('YYYY-MM-DD');
const daysAgo = (n: number): string => dayjs().subtract(n, 'day').format('YYYY-MM-DD');

/** Bounded page size for every client-derived scan (pagination cap is 200). */
const SCAN_PAGE = 200;
/** Detail-fan-out cap for the unpriced scan (orders.md §5: bounded ≤200). */
const UNPRICED_SCAN_CAP = 150;

// ── server row shapes (endpoints return `any`/`Paged<any>` for these) ───────

interface DebtClientRow {
  id: string;
  name: string;
  phone?: string | null;
  agent?: { id: string; name: string } | null;
  region?: { id: string; name: string } | null;
  paymentTermDays?: number | null;
  creditLimit?: Money | null;
  balance: Money;
  palletBalance: number;
  hasOverdueOrders: boolean;
  overdueOrdersCount: number;
  overdueOrdersTotal: Money;
  dueWithinWindow: boolean;
}
interface DebtClientsResponse {
  items: DebtClientRow[];
  total: number;
  days: number;
  expectedCollections: Money;
}

// ── tiny builders ───────────────────────────────────────────────────────────

const capNote = (total: number, scanned: number): string | undefined =>
  total > scanned ? `Oyna katta — birinchi ${scanned} ta ko'rildi` : undefined;

const partyName = (p: Payment): string =>
  p.client?.name ?? p.factory?.name ?? p.vehicle?.name ?? 'Nomaʼlum';

// ────────────────────────────────────────────────────────────────────────────
// Shared debts/clients scan — feeds #1 (overdue) and #9 (near-limit) from ONE
// fetch (identical query key ⇒ react-query dedupes to a single request).
// ────────────────────────────────────────────────────────────────────────────

function useDebtClientsScan(enabled: boolean): UseQueryResult<DebtClientsResponse> {
  return useQuery<DebtClientsResponse>({
    queryKey: ['debts', 'worklist', 'clients-scan', SCAN_PAGE],
    enabled,
    staleTime: 30_000,
    queryFn: async () =>
      (await endpoints.debtsClients({ pageSize: SCAN_PAGE })) as unknown as DebtClientsResponse,
  });
}

// ── #1 Muddati o'tgan qarzlar — danger — A B G(own) ─────────────────────────
// GET /debts/clients, rows with server-computed `hasOverdueOrders` (03 §6 #1).

export function useOverdueDebtsQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const q = useDebtClientsScan(enabled);
  const rows = (q.data?.items ?? []).filter((r) => r.hasOverdueOrders);
  rows.sort((a, b) => num(b.overdueOrdersTotal) - num(a.overdueOrdersTotal));
  const sum = rows.reduce((a, r) => a + num(r.overdueOrdersTotal), 0);
  const top3: WorklistPreview[] = rows.slice(0, 3).map((r) => ({
    id: r.id,
    title: r.name,
    meta: `${r.overdueOrdersCount} ta muddati oʼtgan`,
    amount: r.overdueOrdersTotal,
    moneyVariant: 'owedToUs',
    to: `/clients/${r.id}`,
  }));
  return {
    key: 'overdue',
    title: "Muddati oʼtgan qarzlar",
    severity: 'danger',
    count: rows.length,
    sum,
    top3,
    drillTo: '/debts?tab=mijozlar&chip=overdue',
    note: capNote(q.data?.total ?? 0, q.data?.items.length ?? 0),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #2 Tekshirilmagan to'lovlar — violet — A B ──────────────────────────────
// GET /payments?reconciled=false (server filter). Count is server-exact via
// `total`; Σ / top-3 come from the fetched window (money.md §5.2, D3 → violet).

export function useUnreconciledQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const q = useQuery<Paged<Payment>>({
    queryKey: ['payments', 'worklist', 'reconciled-false', SCAN_PAGE],
    enabled,
    staleTime: 30_000,
    queryFn: () => endpoints.payments({ reconciled: false, pageSize: SCAN_PAGE }),
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const sum = items.reduce((a, p) => a + num(p.amount), 0);
  const top3: WorklistPreview[] = items.slice(0, 3).map((p) => ({
    id: p.id,
    title: partyName(p),
    meta: dayjs(p.date).format('DD.MM.YYYY'),
    amount: p.amount,
    moneyVariant: 'neutral',
    to: `/payments/${p.id}`,
  }));
  return {
    key: 'reconciled-false',
    title: "Tekshirilmagan toʼlovlar",
    severity: 'violet',
    count: total, // server-exact
    sum, // window sum (see note when capped)
    top3,
    drillTo: '/payments?reconciled=false',
    note: total > items.length ? `Σ oyna ichida — birinchi ${items.length} ta` : undefined,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #3 Transport aniqlanmagan — violet — A B ────────────────────────────────
// Orders with transportPaidStatus=UNKNOWN over a visible window (default Shu oy).

export function useTransportUnknownQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const from = monthStart();
  const q = useQuery<Paged<Order>>({
    queryKey: ['orders', 'worklist', 'transport-unknown', from],
    enabled,
    staleTime: 30_000,
    queryFn: () => endpoints.orders({ dateFrom: from, pageSize: SCAN_PAGE }),
  });
  const rows = (q.data?.items ?? []).filter((o) => o.transportPaidStatus === 'UNKNOWN');
  const sum = rows.reduce((a, o) => a + num(o.transportCost), 0);
  const top3: WorklistPreview[] = rows.slice(0, 3).map((o) => ({
    id: o.id,
    title: `${o.orderNo}${o.client ? ' · ' + o.client.name : ''}`,
    meta: dayjs(o.date).format('DD.MM.YYYY'),
    amount: o.transportCost,
    moneyVariant: 'neutral',
    to: `/orders/${o.id}`,
  }));
  return {
    key: 'transport-unknown',
    title: 'Transport aniqlanmagan',
    severity: 'violet',
    count: rows.length,
    sum,
    top3,
    drillTo: '/orders?chip=transport-unknown',
    window: 'Shu oy',
    note: capNote(q.data?.total ?? 0, q.data?.items.length ?? 0),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #4 Taqsimlanmagan to'lovlar — warning — A B ─────────────────────────────
// Non-voided allocatable payments whose remainder (amount − Σ active
// allocations) ≥ 1. The list payload embeds active allocations (money.md fact
// 0.2) so the per-row remainder is EXACT; only count/sum across pages is scanned.

const ALLOCATABLE = new Set(['CLIENT_IN', 'FACTORY_OUT', 'VEHICLE_OUT', 'TRANSPORT_DIRECT']);

export function useUnallocatedQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const from = monthStart();
  const q = useQuery<Paged<Payment>>({
    queryKey: ['payments', 'worklist', 'alloc-open', from],
    enabled,
    staleTime: 30_000,
    queryFn: () => endpoints.payments({ dateFrom: from, pageSize: SCAN_PAGE }),
  });
  const rows = (q.data?.items ?? [])
    .filter((p) => !p.voidedAt && ALLOCATABLE.has(p.kind))
    .map((p) => {
      const allocated = (p.allocations ?? []).reduce((a, al) => a + num(al.amount), 0);
      return { p, remainder: num(p.amount) - allocated };
    })
    .filter((r) => r.remainder >= 1)
    .sort((a, b) => b.remainder - a.remainder);
  const sum = rows.reduce((a, r) => a + r.remainder, 0);
  const top3: WorklistPreview[] = rows.slice(0, 3).map(({ p, remainder }) => ({
    id: p.id,
    title: partyName(p),
    meta: dayjs(p.date).format('DD.MM.YYYY'),
    amount: remainder,
    moneyVariant: 'weOwe',
    to: `/payments/${p.id}`,
  }));
  return {
    key: 'alloc-open',
    title: "Taqsimlanmagan toʼlovlar",
    severity: 'warning',
    count: rows.length,
    sum,
    top3,
    drillTo: '/payments?chip=alloc-open',
    window: 'Shu oy',
    note: capNote(q.data?.total ?? 0, q.data?.items.length ?? 0),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #5 Narxlanmagan buyurtmalar — warning — A B ─────────────────────────────
// Order list rows carry NO item data (money.md §0.9), so the honest resolution
// (orders.md §128) is a bounded windowed scan: page the window, then per-order
// GET /orders/:id (≤UNPRICED_SCAN_CAP) testing items.some(pricePending).

interface UnpricedScan {
  unpriced: Order[];
  tested: number;
  total: number;
}

export function useUnpricedOrdersQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const from = daysAgo(30);
  const q = useQuery<UnpricedScan>({
    queryKey: ['orders', 'worklist', 'unpriced', from],
    enabled,
    staleTime: 60_000, // heaviest queue — refetch sparingly
    queryFn: async () => {
      const page = await endpoints.orders({ dateFrom: from, pageSize: SCAN_PAGE });
      const candidates = page.items
        .filter((o) => o.status !== 'CANCELLED')
        .slice(0, UNPRICED_SCAN_CAP);
      const details = await Promise.all(
        candidates.map((o) => endpoints.order(o.id).catch(() => null)),
      );
      const unpriced = details.filter(
        (o): o is Order => !!o && !!o.items?.some((it) => it.pricePending),
      );
      return { unpriced, tested: candidates.length, total: page.total };
    },
  });
  const rows = q.data?.unpriced ?? [];
  const tested = q.data?.tested ?? 0;
  const top3: WorklistPreview[] = rows.slice(0, 3).map((o) => ({
    id: o.id,
    title: `${o.orderNo}${o.client ? ' · ' + o.client.name : ''}`,
    meta: `${o.items?.filter((it) => it.pricePending).length ?? 0} ta pozitsiya narxlanmagan`,
    to: `/orders/${o.id}`,
  }));
  return {
    key: 'unpriced',
    title: 'Narxlanmagan buyurtmalar',
    severity: 'warning',
    count: rows.length,
    top3,
    drillTo: '/orders?chip=unpriced',
    window: `oxirgi 30 kun · ${tested} ta buyurtma tekshirildi`,
    note:
      (q.data?.total ?? 0) > UNPRICED_SCAN_CAP
        ? `Oyna katta — birinchi ${UNPRICED_SCAN_CAP} ta tekshirildi`
        : undefined,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #6 Moshina biriktirilmagan — warning — A B ──────────────────────────────
// status=CONFIRMED (server filter) with vehicleId=null (row-derivable) — blocked
// from LOADING. Count-only (logistics blocker, not a money figure).

export function useNoVehicleQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const q = useQuery<Paged<Order>>({
    queryKey: ['orders', 'worklist', 'no-vehicle'],
    enabled,
    staleTime: 30_000,
    queryFn: () => endpoints.orders({ status: 'CONFIRMED', pageSize: SCAN_PAGE }),
  });
  const rows = (q.data?.items ?? []).filter((o) => !o.vehicleId);
  const top3: WorklistPreview[] = rows.slice(0, 3).map((o) => ({
    id: o.id,
    title: `${o.orderNo}${o.client ? ' · ' + o.client.name : ''}`,
    meta: dayjs(o.date).format('DD.MM.YYYY'),
    to: `/orders/${o.id}`,
  }));
  return {
    key: 'novehicle',
    title: 'Moshina biriktirilmagan',
    severity: 'warning',
    count: rows.length,
    top3,
    drillTo: '/orders?status=CONFIRMED&chip=novehicle',
    note: capNote(q.data?.total ?? 0, q.data?.items.length ?? 0),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #7 Tannarx qotirilmagan (>7 kun) — warning — A B ────────────────────────
// COMPLETED orders older than 7 days (server dateTo bound) with costStatus≠FINAL.
// dateTo=7 days ago keeps the freshly-overdue ones on page 1 (desc order).

export function useCostOpenQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const to = daysAgo(7);
  const q = useQuery<Paged<Order>>({
    queryKey: ['orders', 'worklist', 'cost-open', to],
    enabled,
    staleTime: 30_000,
    queryFn: () => endpoints.orders({ status: 'COMPLETED', dateTo: to, pageSize: SCAN_PAGE }),
  });
  const rows = (q.data?.items ?? []).filter((o) => o.costStatus !== 'FINAL');
  const sum = rows.reduce((a, o) => a + num(o.costTotal), 0);
  const top3: WorklistPreview[] = rows.slice(0, 3).map((o) => {
    const age = dayjs().diff(dayjs(o.completedAt ?? o.date), 'day');
    return {
      id: o.id,
      title: `${o.orderNo}${o.factory ? ' · ' + o.factory.name : ''}`,
      meta: `${age} kun`,
      amount: o.costTotal,
      moneyVariant: 'weOwe',
      to: `/orders/${o.id}`,
    };
  });
  return {
    key: 'cost-open',
    title: 'Tannarx qotirilmagan',
    severity: 'warning',
    count: rows.length,
    sum,
    top3,
    drillTo: '/orders?status=COMPLETED&chip=cost-open',
    window: '7 kundan oshgan',
    note: capNote(q.data?.total ?? 0, q.data?.items.length ?? 0),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #8 Shofyorlarga qarz — warning — A B ────────────────────────────────────
// Vehicles with negative balance (list payload; <0 ⇒ dealer owes the driver).

export function useDriverDebtQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const q = useQuery<Vehicle[] | Paged<Vehicle>>({
    queryKey: ['vehicles', 'worklist', 'owed'],
    enabled,
    staleTime: 30_000,
    queryFn: () => endpoints.vehicles(),
  });
  const all = asItems(q.data);
  const total = Array.isArray(q.data) ? all.length : (q.data?.total ?? all.length);
  const rows = all
    .filter((v) => num(v.balance) < 0)
    .sort((a, b) => num(a.balance) - num(b.balance));
  const sum = rows.reduce((a, v) => a + Math.abs(num(v.balance)), 0);
  const top3: WorklistPreview[] = rows.slice(0, 3).map((v) => ({
    id: v.id,
    title: v.plate ? `${v.name} · ${v.plate}` : v.name,
    meta: v.driver ?? undefined,
    amount: Math.abs(num(v.balance)),
    moneyVariant: 'weOwe',
    to: `/vehicles/${v.id}`,
  }));
  return {
    key: 'owed',
    title: 'Shofyorlarga qarz',
    severity: 'warning',
    count: rows.length,
    sum,
    top3,
    drillTo: '/vehicles?chip=owed',
    note: capNote(total, all.length),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #9 Limit chegarasida — neutral — A B ────────────────────────────────────
// debts/clients rows where balance ≥ 80% of a real (>0) creditLimit.

export function useNearLimitQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const q = useDebtClientsScan(enabled);
  const rows = (q.data?.items ?? [])
    .map((r) => {
      const limit = r.creditLimit == null ? 0 : num(r.creditLimit);
      const bal = num(r.balance);
      return { r, limit, bal, pct: limit > 0 ? bal / limit : 0 };
    })
    .filter((x) => x.limit > 0 && x.bal >= 0.8 * x.limit)
    .sort((a, b) => b.pct - a.pct);
  const sum = rows.reduce((a, x) => a + x.bal, 0);
  const top3: WorklistPreview[] = rows.slice(0, 3).map(({ r, bal, pct }) => ({
    id: r.id,
    title: r.name,
    meta: `${Math.round(pct * 100)}% band`,
    amount: bal,
    moneyVariant: 'owedToUs',
    to: `/clients/${r.id}`,
  }));
  return {
    key: 'near-limit',
    title: 'Limit chegarasida',
    severity: 'neutral',
    count: rows.length,
    sum,
    top3,
    drillTo: '/clients?chip=near-limit',
    note: capNote(q.data?.total ?? 0, q.data?.items.length ?? 0),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── #10 Yo'ldagi buyurtmalar — neutral (info) — A B / G(own) ─────────────────
// CONFIRMED + LOADING + DELIVERING via 3 parallel status queries (03 §6 #10).
// Count is server-exact (sum of the three totals); surfaces the invisible
// ordersInFlight KPI. Count-only info card.

const INFLIGHT: readonly Order['status'][] = ['CONFIRMED', 'LOADING', 'DELIVERING'];

interface InFlightScan {
  rows: Order[];
  count: number;
}

export function useInFlightQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const q = useQuery<InFlightScan>({
    queryKey: ['orders', 'worklist', 'inflight'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const pages = await Promise.all(
        INFLIGHT.map((status) => endpoints.orders({ status, pageSize: 50 })),
      );
      const count = pages.reduce((a, p) => a + p.total, 0);
      // preview closest-to-delivery first: DELIVERING → LOADING → CONFIRMED
      const rows = [...pages[2].items, ...pages[1].items, ...pages[0].items];
      return { rows, count };
    },
  });
  const rows = q.data?.rows ?? [];
  const top3: WorklistPreview[] = rows.slice(0, 3).map((o) => ({
    id: o.id,
    title: `${o.orderNo}${o.client ? ' · ' + o.client.name : ''}`,
    meta: STATUS_WORD[o.status] ?? o.status,
    to: `/orders/${o.id}`,
  }));
  return {
    key: 'inflight',
    title: "Yoʼldagi buyurtmalar",
    severity: 'neutral',
    count: q.data?.count ?? 0,
    top3,
    drillTo: '/orders?chip=inflight',
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

const STATUS_WORD: Partial<Record<Order['status'], string>> = {
  CONFIRMED: 'Tasdiqlangan',
  LOADING: 'Yuklanmoqda',
  DELIVERING: 'Yetkazilmoqda',
};

// ── #11 Bugun muddati kelganlar (agent) — warning — G ───────────────────────
// Own debts rows due within the window (days=7, server-scoped, dueWithinWindow).

export function useAgentDueSoonQueue(opts?: QueueOptions): WorklistResult {
  const enabled = opts?.enabled ?? true;
  const q = useQuery<DebtClientsResponse>({
    queryKey: ['debts', 'worklist', 'due-soon', 7],
    enabled,
    staleTime: 30_000,
    queryFn: async () =>
      (await endpoints.debtsClients({ days: 7, pageSize: SCAN_PAGE })) as unknown as DebtClientsResponse,
  });
  const rows = (q.data?.items ?? []).filter((r) => r.dueWithinWindow && num(r.balance) > 0);
  rows.sort((a, b) => num(b.balance) - num(a.balance));
  const sum = rows.reduce((a, r) => a + num(r.balance), 0);
  const top3: WorklistPreview[] = rows.slice(0, 3).map((r) => ({
    id: r.id,
    title: r.name,
    meta: 'muddati yaqin',
    amount: r.balance,
    moneyVariant: 'owedToUs',
    to: `/clients/${r.id}`,
  }));
  return {
    key: 'due-soon',
    title: 'Bugun muddati kelganlar',
    severity: 'warning',
    count: rows.length,
    sum,
    top3,
    drillTo: '/debts?days=7',
    window: '7 kun',
    note: capNote(q.data?.total ?? 0, q.data?.items.length ?? 0),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

// ── severity ordering (fixed, not configurable — 03 §6 / 04 §3.4) ───────────

const SEVERITY_RANK: Record<QueueSeverity, number> = {
  danger: 0,
  violet: 1,
  warning: 2,
  neutral: 3,
};

/** Stable severity sort — input order is preserved within a severity tier. */
export function orderBySeverity(queues: WorklistResult[]): WorklistResult[] {
  return queues
    .map((q, i) => ({ q, i }))
    .sort((a, b) => SEVERITY_RANK[a.q.severity] - SEVERITY_RANK[b.q.severity] || a.i - b.i)
    .map((x) => x.q);
}

// ── aggregators for the two cockpits (03 §4) ────────────────────────────────
// Each aggregator is a single cockpit's hook: it calls every queue hook
// unconditionally (rules-of-hooks), gates fetching by role via `enabled`, and
// returns the severity-ordered rail. A page renders exactly one aggregator (the
// A/B «Ish stoli» vs the AGENT cockpit are separate components).

/** A/B «Ish stoli» rail: queues #1–#10, severity-ordered. */
export function useOwnerWorklists(): WorklistResult[] {
  const { user } = useAuth();
  const enabled = user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';

  const overdue = useOverdueDebtsQueue({ enabled });
  const reconciled = useUnreconciledQueue({ enabled });
  const transportUnknown = useTransportUnknownQueue({ enabled });
  const allocOpen = useUnallocatedQueue({ enabled });
  const unpriced = useUnpricedOrdersQueue({ enabled });
  const noVehicle = useNoVehicleQueue({ enabled });
  const costOpen = useCostOpenQueue({ enabled });
  const owedDrivers = useDriverDebtQueue({ enabled });
  const nearLimit = useNearLimitQueue({ enabled });
  const inflight = useInFlightQueue({ enabled });

  return useMemo(
    () =>
      enabled
        ? orderBySeverity([
            overdue,
            reconciled,
            transportUnknown,
            allocOpen,
            unpriced,
            noVehicle,
            costOpen,
            owedDrivers,
            nearLimit,
            inflight,
          ])
        : [],
    [
      enabled,
      overdue,
      reconciled,
      transportUnknown,
      allocOpen,
      unpriced,
      noVehicle,
      costOpen,
      owedDrivers,
      nearLimit,
      inflight,
    ],
  );
}

/** AGENT cockpit rail: own overdue (#1), due-soon (#11), in-flight (#10). */
export function useAgentWorklists(): WorklistResult[] {
  const { user } = useAuth();
  const enabled = user?.role === 'AGENT';

  const overdue = useOverdueDebtsQueue({ enabled });
  const dueSoon = useAgentDueSoonQueue({ enabled });
  const inflight = useInFlightQueue({ enabled });

  return useMemo(
    () => (enabled ? orderBySeverity([overdue, dueSoon, inflight]) : []),
    [enabled, overdue, dueSoon, inflight],
  );
}
