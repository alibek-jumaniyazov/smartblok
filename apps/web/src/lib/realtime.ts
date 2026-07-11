// Live updates: one socket per session; every broadcast invalidates the
// matching react-query keys. Query key convention (MANDATORY for all pages):
// list/detail keys START with the entity name, e.g. ['orders'], ['orders', id],
// ['payments', filters] — so entity-level invalidation reaches everything.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';

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

let socket: Socket | null = null;

export function useRealtime(token: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) {
      socket?.disconnect();
      socket = null;
      return;
    }
    socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('change', (ev: { entity: string; action: string; id: string | null }) => {
      for (const key of ENTITY_KEYS[ev.entity] ?? [ev.entity]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    });
    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [token, qc]);
}
