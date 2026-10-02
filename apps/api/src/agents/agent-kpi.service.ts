import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { NOT_CANCELLED_SQL } from '../common/order-scope';
import { assertOwnAgent, RequestUser } from '../common/scoping';
import { tashkentDateStr } from '../common/tashkent-time';
import { PrismaService } from '../prisma/prisma.service';
import {
  AGENT_KPI_SETTING_KEY, AgentKpiAggregate, AgentKpiReport, AgentKpiSettings,
  assertAgentKpiMonth, buildAgentKpiReport, DEFAULT_AGENT_KPI_SETTINGS, parseAgentKpiSettings,
} from './agent-kpi.calculator';

@Injectable()
export class AgentKpiService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async getSettings(db: Prisma.TransactionClient = this.prisma): Promise<AgentKpiSettings> {
    const saved = await db.appSetting.findUnique({ where: { key: AGENT_KPI_SETTING_KEY } });
    return saved ? parseAgentKpiSettings(saved.value) : { ...DEFAULT_AGENT_KPI_SETTINGS };
  }

  async updateSettings(input: unknown, user: RequestUser): Promise<AgentKpiSettings> {
    if (user.role !== 'ADMIN') throw new ForbiddenException('KPI sozlamasini faqat administrator o\u2018zgartirishi mumkin');
    const next = parseAgentKpiSettings(input);
    return this.prisma.$transaction(async (tx) => {
      // The import/rollback paths take the same lock before changing this shared setting.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${AGENT_KPI_SETTING_KEY}))`;
      const before = await this.getSettings(tx);
      await tx.appSetting.upsert({
        where: { key: AGENT_KPI_SETTING_KEY },
        create: { key: AGENT_KPI_SETTING_KEY, value: { ...next }, updatedBy: user.userId },
        update: { value: { ...next }, updatedBy: user.userId },
      });
      await this.audit.log({ tx, userId: user.userId, action: AuditAction.UPDATE, entity: 'AppSetting',
        entityId: AGENT_KPI_SETTING_KEY, before: { value: before }, after: { value: next } });
      return next;
    });
  }

  async report(query: { month?: string; agentId?: string } = {}, user?: RequestUser): Promise<AgentKpiReport> {
    const month = query.month ?? tashkentDateStr(new Date()).slice(0, 7);
    assertAgentKpiMonth(month);
    let agentId = query.agentId ?? null;
    if (user?.role === 'AGENT') {
      if (!user.agentId) throw new ForbiddenException('Agent profili biriktirilmagan');
      assertOwnAgent(user, agentId ?? user.agentId);
      agentId = user.agentId;
    }
    // RepeatableRead keeps settings, agents and shipment totals on one consistent snapshot.
    return this.prisma.$transaction(async (tx) => {
      const settings = await this.getSettings(tx);
      const agents = await tx.agent.findMany({
        where: agentId ? { id: agentId } : {},
        select: { id: true, name: true, sortNo: true },
        orderBy: [{ sortNo: 'asc' }, { name: 'asc' }],
      });
      if (agentId && agents.length === 0) throw new NotFoundException('Agent topilmadi');
      const scope = agentId ? Prisma.sql`AND COALESCE(c."agentId", o."agentId") = ${agentId}` : Prisma.empty;
      // Pre-sum item volumes once per order: a split load must not multiply that
      // order's sale/cost/transport. Stored date is UTC; grouping uses Tashkent days.
      // Workbook U resolves the CURRENT client dictionary first, then the manual
      // shipment agent. Reassignment consequently changes historical KPI display.
      const rows = await tx.$queryRaw<(Omit<AgentKpiAggregate, 'ordersCount'> & { ordersCount: bigint })[]>`
        SELECT COALESCE(c."agentId", o."agentId") AS "agentId", to_char(o.date + interval '5 hours', 'YYYY-MM-DD') AS date,
               COUNT(*) AS "ordersCount", SUM(COALESCE(q.volume, 0)) AS "quantityM3",
               SUM(o."saleTotal" - o."costTotal" - o."transportCost") AS profit
        FROM "Order" o
        JOIN "Client" c ON c.id = o."clientId"
        LEFT JOIN LATERAL (
          SELECT SUM(COALESCE(i."actualQuantityM3", i."quantityM3")) AS volume
          FROM "OrderItem" i WHERE i."orderId" = o.id
        ) q ON TRUE
        WHERE ${NOT_CANCELLED_SQL} ${scope}
        GROUP BY COALESCE(c."agentId", o."agentId"), to_char(o.date + interval '5 hours', 'YYYY-MM-DD')
        ORDER BY date, "agentId"`;
      return buildAgentKpiReport(month, settings, agents, rows.map((r) => ({ ...r, ordersCount: Number(r.ordersCount) })), agentId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
