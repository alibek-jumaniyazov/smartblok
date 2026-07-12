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
import { requireCorsOrigins } from './cors-origins';
import { PrismaService } from '../prisma/prisma.service';

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
@WebSocketGateway({ cors: { origin: requireCorsOrigins() } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('no token');
      const payload = jwt.verify(token, requireJwtSecret()) as {
        sub: string;
        role: string;
        agentId?: string | null;
        tv?: number;
      };
      // re-validate against the DB like JwtStrategy does for HTTP: a deactivated user
      // or a bumped tokenVersion (forced logout / password change) must not keep a
      // live socket that leaks realtime events after their session was revoked.
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { role: true, agentId: true, active: true, tokenVersion: true },
      });
      if (!user || !user.active || user.tokenVersion !== (payload.tv ?? 0)) {
        throw new Error('session revoked');
      }
      client.join(`role:${user.role}`);
      if (user.role === 'AGENT' && user.agentId) {
        client.join(`agent:${user.agentId}`);
      }
      client.data.userId = payload.sub;
      client.data.role = user.role;
    } catch {
      this.logger.warn(`socket ${client.id} rejected: bad/missing/revoked JWT`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // rooms clean up automatically
  }
}
