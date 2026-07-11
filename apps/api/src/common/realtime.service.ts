import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

export type RealtimeEntity =
  | 'order'
  | 'payment'
  | 'kassa'
  | 'expense'
  | 'bonus'
  | 'pallet'
  | 'client'
  | 'dashboard';

export interface RealtimeEvent {
  entity: RealtimeEntity;
  action: string; // created | updated | status | cancelled | voided | allocated | ...
  id?: string;
  /** route a copy to this agent's room (event concerns one of their clients) */
  agentId?: string | null;
  /** additionally notify cashiers (kassa-affecting events) */
  cashier?: boolean;
}

/**
 * Fire-and-forget emission, called by services AFTER their transaction commits
 * (never from inside — a rollback must not have broadcast anything).
 * Thin payloads only; clients react by refetching their queries.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  emit(event: RealtimeEvent): void {
    try {
      const server = this.gateway.server;
      if (!server) return; // gateway not initialized (e.g. unit context)
      const payload = { entity: event.entity, action: event.action, id: event.id ?? null, at: Date.now() };
      const rooms = server.to('role:ADMIN').to('role:ACCOUNTANT');
      (event.cashier ? rooms.to('role:CASHIER') : rooms).emit('change', payload);
      if (event.agentId) {
        server.to(`agent:${event.agentId}`).emit('change', payload);
      }
    } catch (e) {
      this.logger.error(`realtime emit failed: ${e}`); // never break the request
    }
  }
}
