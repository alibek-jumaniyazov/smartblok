import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  ip?: string | null;
  /** pass the surrounding transaction client so the log commits/rolls back with the mutation */
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /** Inside a transaction: awaits and fails with it. Outside: fire-and-forget, never breaks the request. */
  async log(input: AuditInput): Promise<void> {
    const data = {
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
      note: input.note ?? null,
      ip: input.ip ?? null,
    };
    if (input.tx) {
      await input.tx.auditLog.create({ data });
      return;
    }
    try {
      await this.prisma.auditLog.create({ data });
    } catch (e) {
      this.logger.error(`audit write failed for ${input.entity}/${input.entityId}: ${e}`);
    }
  }
}
