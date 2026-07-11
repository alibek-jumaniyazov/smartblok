import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { requireJwtSecret } from './jwt-secret';

/**
 * Live-update channel. Clients connect with their JWT
 * (io(url, { auth: { token } })) and are placed into rooms:
 *   role:ADMIN | role:ACCOUNTANT | role:CASHIER | role:AGENT
 *   agent:<agentId>            (AGENT users only)
 * Emission policy (RealtimeService): financial events go to ADMIN+ACCOUNTANT;
 * kassa events additionally to CASHIER; order/payment/pallet events that belong
 * to an agent's client also go to that agent's room. Payloads are thin
 * ({ entity, id, action }) — clients refetch what they display; amounts never
 * travel over the socket, so a room misconfiguration cannot leak balances.
 */
@WebSocketGateway({
  cors: { origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()) },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('no token');
      const payload = jwt.verify(token, requireJwtSecret()) as {
        sub: string;
        role: string;
        agentId?: string | null;
      };
      client.join(`role:${payload.role}`);
      if (payload.role === 'AGENT' && payload.agentId) {
        client.join(`agent:${payload.agentId}`);
      }
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      this.logger.warn(`socket ${client.id} rejected: bad/missing JWT`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // rooms clean up automatically
  }
}
