import { ForbiddenException } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  username: string;
  role: 'ADMIN' | 'ACCOUNTANT' | 'AGENT' | 'CASHIER';
  name: string;
  agentId: string | null;
}

/** Prisma where-fragment limiting AGENT users to their own agent's rows. */
export const agentScope = (user: RequestUser | undefined): { agentId?: string } =>
  user?.role === 'AGENT' && user.agentId ? { agentId: user.agentId } : {};

/** Same, for rows related through client ownership. */
export const clientAgentScope = (user: RequestUser | undefined): { client?: { agentId: string } } =>
  user?.role === 'AGENT' && user.agentId ? { client: { agentId: user.agentId } } : {};

/** Throws unless the record belongs to the AGENT user (other roles pass). */
export function assertOwnAgent(user: RequestUser | undefined, recordAgentId: string | null | undefined): void {
  if (!user || user.role !== 'AGENT') return;
  if (!user.agentId || recordAgentId !== user.agentId) {
    throw new ForbiddenException("Bu ma'lumot sizning agentingizga tegishli emas");
  }
}
