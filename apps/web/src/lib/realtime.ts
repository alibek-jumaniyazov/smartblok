// Live updates + honest realtime connection state. One socket per session.
//
// Public API (backward compatible — this file is live plumbing for the whole app):
//   useRealtime(token)      — mounts the socket, wires the coalesced invalidation
//                             (unchanged signature; still the app-wide invalidator)
//   useRealtimeStatus()     — { status, lastEventAt } for LiveBadge + KPI-band
//                             «HH:mm holatiga» suffix (02 §9, 03 §1.2)
//   getRealtimeStatus()     — non-hook snapshot (imperative / main.tsx reads)
//   subscribeRealtime(cb)   — low-level store subscription
//
// Query-key convention (LOCKED contract, 02 §9): list/detail keys START with the
// entity name — ['orders'], ['orders', id], ['payments', filters] — so entity-
// level invalidation reaches everything. Socket `change` events are COALESCED per
// entity key family inside a 2s window before invalidation (the refetch-storm fix).
import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';

/** 02 §9 realtime-bursts law: collapse a storm of change events into one refetch. */
const COALESCE_MS = 2000;

const ENTITY_KEYS: Record<string, string[]> = {
  order: ['orders', 'dashboard', 'debts', 'clients', 'pallets', 'reports'],
  payment: ['payments', 'orders', 'dashboard', 'debts', 'clients', 'kassa', 'factories', 'vehicles', 'reports'],
  kassa: ['kassa', 'dashboard'],
  expense: ['expenses', 'kassa', 'dashboard'],
  bonus: ['bonus', 'factories', 'kassa', 'dashboard'],
  pallet: ['pallets', 'clients', 'factories', 'dashboard'],
  client: ['clients', 'debts'],
  dashboard: ['dashboard'],
};

// ─────────────── realtime connection-state store ───────────────
// A tiny module-level store fed by socket connect/disconnect/reconnect + `change`
// events, read via useSyncExternalStore so any number of LiveBadges stay in sync.

export type RealtimeStatus = 'live' | 'connecting' | 'offline';

export interface RealtimeState {
  /** honest socket state for the LiveBadge dot (never decorative). */
  status: RealtimeStatus;
  /** ms epoch of the last `change` received; null until the first one. */
  lastEventAt: number | null;
}

let state: RealtimeState = { status: 'offline', lastEventAt: null };
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Stable reference between changes — required for useSyncExternalStore.
function getSnapshot(): RealtimeState {
  return state;
}

function patchState(patch: Partial<RealtimeState>): void {
  const next: RealtimeState = { ...state, ...patch };
  if (next.status === state.status && next.lastEventAt === state.lastEventAt) return;
  state = next;
  applyRefetchPolicy(next.status);
  for (const l of listeners) l();
}

/** Non-hook snapshot for imperative reads (e.g. main.tsx wiring, tests). */
export function getRealtimeStatus(): RealtimeState {
  return state;
}

/** Low-level store subscription (returns an unsubscribe). */
export function subscribeRealtime(cb: () => void): () => void {
  return subscribe(cb);
}

/**
 * LiveBadge / KPI-band suffix source. Re-renders on connect / disconnect /
 * reconnect and on every `change` (lastEventAt bumps) — but NOT per coalesced
 * invalidation, which is throttled separately below.
 */
export function useRealtimeStatus(): RealtimeState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─────────────── socket + coalesced invalidation ───────────────

let socket: Socket | null = null;
let queryClient: QueryClient | null = null;
const pendingKeys = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Open a 2s coalescing window on the first pending event; later events pile in. */
function scheduleFlush(): void {
  if (flushTimer) return; // one flush per window — bursts collapse into it
  flushTimer = setTimeout(flush, COALESCE_MS);
}

function flush(): void {
  flushTimer = null;
  const qc = queryClient;
  const keys = [...pendingKeys];
  pendingKeys.clear();
  if (!qc) return;
  for (const key of keys) qc.invalidateQueries({ queryKey: [key] });
}

/**
 * Offline safety net (02 §9): while the socket is down, stale numbers refetch on
 * window focus so nothing renders silently stale. Restored to false once live.
 * Only the single `refetchOnWindowFocus` default is touched — everything else in
 * the QueryClient config is preserved. main.tsx may also read useRealtimeStatus
 * to show the «HH:mm holatiga» suffix; the badge and this net share one source.
 */
function applyRefetchPolicy(status: RealtimeStatus): void {
  const qc = queryClient;
  if (!qc) return;
  const defaults = qc.getDefaultOptions();
  qc.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, refetchOnWindowFocus: status !== 'live' },
  });
}

function teardown(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingKeys.clear();
  if (socket) {
    socket.off(); // drop handlers first so the manual disconnect can't flip status
    socket.io.off();
    socket.disconnect();
    socket = null;
  }
  patchState({ status: 'offline' });
}

export function useRealtime(token: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    queryClient = qc;

    if (!token) {
      teardown();
      return;
    }

    patchState({ status: 'connecting' });
    const s = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socket = s;

    // socket-level lifecycle
    s.on('connect', () => patchState({ status: 'live' }));
    s.on('disconnect', () => patchState({ status: 'connecting' })); // manager will retry

    // manager-level reconnect: first attempt reads as «Ulanmoqda…», a sustained
    // outage settles to «Oflayn» (still invisibly retrying) — honest either way.
    s.io.on('reconnect_attempt', (attempt: number) =>
      patchState({ status: attempt >= 2 ? 'offline' : 'connecting' }),
    );
    s.io.on('reconnect', () => patchState({ status: 'live' }));

    // the app-wide invalidator: coalesce per entity key family, then flush once
    s.on('change', (ev: { entity: string; action: string; id: string | null }) => {
      patchState({ status: 'live', lastEventAt: Date.now() });
      for (const key of ENTITY_KEYS[ev.entity] ?? [ev.entity]) pendingKeys.add(key);
      scheduleFlush();
    });

    return () => {
      teardown();
    };
  }, [token, qc]);
}
