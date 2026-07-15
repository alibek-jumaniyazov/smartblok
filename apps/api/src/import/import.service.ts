import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ImportBatchStatus, ImportEntityDecision, ImportEntityKind, ImportRowKind, ImportRowStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/scoping';
import { WorkbookReader } from './parse/workbook.reader';
import { parseTovar } from './parse/tovar.parser';
import { parseOplata } from './parse/oplata.parser';
import { parseOplataZavod } from './parse/oplata-zavod.parser';
import { clientNameFromSheetTitle, resolveClients, RawName } from './resolve/entity-resolver';
import { matchName } from './resolve/matcher';
import { norm } from './resolve/normalize';
import { runRules, countByRule } from './rules/validate.service';
import { DEFAULT_RULES_CONFIG, IMPORT_RULES_SETTING_KEY, resolveRulesConfig } from './rules/config';
import type { Finding } from './rules/rule-registry';
import { AiReviewService } from './rules/ai-review.service';
import { runCommit } from './commit/import-commit.service';
import { runRollback } from './commit/import-rollback.service';
import {
  clientPaymentToJson, factoryPaymentToJson, jsonToClientPayment, jsonToFactoryPayment,
  jsonToShipment, shipmentToJson,
} from './serialize';
import type { ShipmentRow, ClientPaymentRow, FactoryPaymentRow, RowOrigin } from './parse/types';

const FACTORY_NAME = 'Газоблок';
const PLACEHOLDER_CLIENT = 'Nomaʼlum mijoz (import)';
const AGENTS = ['Жамол 22-22', 'Зафар ога', 'Арслон ога', 'Шохрух ога', 'Темур', 'Темур ога', 'Сардор ога'];
const J = (v: unknown) => v as Prisma.InputJsonValue;

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiReviewService) {}

  // ── upload → stage ──
  async uploadAndStage(buffer: Buffer, filename: string, user: RequestUser) {
    if (buffer.subarray(0, 4).toString('hex') !== '504b0304') {
      throw new BadRequestException('Fayl xlsx (ZIP) formatida emas.');
    }
    const wb = await WorkbookReader.fromBuffer(buffer);
    const sourceHash = createHash('sha256').update(buffer).digest('hex');

    const shipments = parseTovar(wb);
    const clientPayments = parseOplata(wb);
    const factoryPayments = parseOplataZavod(wb);
    const canon = wb.clientSheetNames().map(clientNameFromSheetTitle);
    const agentKeys = new Set(AGENTS.map((a) => norm(a).key));

    // distinct client names (minus blanks & agent-names) → entity decisions
    const nameAgg = new Map<string, { n: number; rows: string[] }>();
    const addName = (name: string, tag: string) => {
      const t = name.trim();
      if (!t || agentKeys.has(norm(t).key)) return;
      const e = nameAgg.get(t) ?? { n: 0, rows: [] };
      e.n++; if (e.rows.length < 5) e.rows.push(tag);
      nameAgg.set(t, e);
    };
    shipments.forEach((r) => addName(r.clientRaw, `Товар r${r.origin.excelRow}`));
    clientPayments.forEach((p) => addName(p.clientRaw, `Оплата r${p.origin.excelRow}`));
    const raws: RawName[] = [...nameAgg].map(([name, e]) => ({ name, occurrences: e.n, sampleRows: e.rows }));
    const decisions = resolveClients(raws, canon.map((name) => ({ id: null, name })));

    // per-raw resolved canonical name (auto-link/suggest → canonical; else raw; blank → placeholder)
    const resolvedName = (raw: string): string => {
      const t = raw.trim();
      if (!t) return PLACEHOLDER_CLIENT;
      if (agentKeys.has(norm(t).key)) return t; // agent-as-client (a BLOCK issue drives correction)
      const m = matchName(t, canon);
      return m.best && m.verdict !== 'none' ? m.best : t;
    };

    const cfg = await this.rulesConfig();
    const findings = runRules({ shipments, clientPayments, factoryPayments, clientSheets: [], agentKeys, cfg });
    const aiFindings = await this.ai.review({ shipments, clientPayments, factoryPayments, clientSheets: [], agentKeys, cfg }, findings);
    const allFindings = [...findings, ...aiFindings];

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          filename, sourceHash, status: ImportBatchStatus.DRAFT,
          rulesSnapshot: J(cfg), createdById: user.userId ?? null,
        },
      });

      let seq = 0;
      const rowIdByOrigin = new Map<string, string>();
      const stageRow = async (kind: ImportRowKind, origin: RowOrigin, parsed: object, resolvedClientName: string | null, fpParts: string[]) => {
        const resolved = { ...parsed, resolvedClientName };
        const fingerprint = createHash('sha256').update(fpParts.join('|')).digest('hex');
        const groupKey = kind === ImportRowKind.SHIPMENT ? fpParts.slice(0, 3).join('|') : null;
        const row = await tx.importRow.create({
          data: {
            batchId: batch.id, kind, sheetName: origin.sheetName, excelRow: origin.excelRow, seq: seq++,
            rawJson: J(parsed), parsedJson: J(parsed), resolvedJson: J(resolved), fingerprint, groupKey,
            status: ImportRowStatus.PENDING,
          },
        });
        rowIdByOrigin.set(`${origin.sheetName}|${origin.excelRow}`, row.id);
      };

      for (const r of shipments) {
        await stageRow(ImportRowKind.SHIPMENT, r.origin, shipmentToJson(r), resolvedName(r.clientRaw),
          ['ship', norm(r.clientRaw).key, r.date?.toISOString().slice(0, 10) ?? '', r.truck, String(r.cube ?? '')]);
      }
      for (const p of clientPayments) {
        await stageRow(ImportRowKind.CLIENT_PAYMENT, p.origin, clientPaymentToJson(p), resolvedName(p.clientRaw),
          ['pay', norm(p.clientRaw).key, p.date?.toISOString().slice(0, 10) ?? '', p.total?.toString() ?? '']);
      }
      for (const f of factoryPayments) {
        await stageRow(ImportRowKind.FACTORY_PAYMENT, f.origin, factoryPaymentToJson(f), null,
          ['fac', f.date?.toISOString().slice(0, 10) ?? '', f.amount?.toString() ?? '', f.receiver]);
      }

      await tx.importEntityMap.createMany({
        data: decisions.map((d) => ({
          batchId: batch.id, kind: ImportEntityKind.CLIENT, sourceName: d.sourceName, normalizedKey: d.normalizedKey,
          occurrences: d.occurrences, sampleRows: J(d.sampleRows), decision: d.decision,
          targetId: d.targetId, newName: d.targetName, suggestion: d.suggestion ? J(d.suggestion) : Prisma.JsonNull,
        })),
        skipDuplicates: true,
      });

      for (const f of allFindings) {
        await tx.importIssue.create({
          data: {
            batchId: batch.id, rowId: rowIdByOrigin.get(`${f.origin.sheetName}|${f.origin.excelRow}`) ?? null,
            ruleId: f.ruleId, severity: f.severity, field: f.field ?? null, message: f.message,
            currentValue: f.currentValue === undefined ? Prisma.JsonNull : J(f.currentValue),
            suggestedValue: f.suggestedValue === undefined ? Prisma.JsonNull : J(f.suggestedValue),
          },
        });
      }

      return this.summary(tx, batch.id);
    }, { timeout: 120_000 });
  }

  // ── reads ──
  async getBatch(id: string) {
    return this.summary(this.prisma, id);
  }
  async listRows(id: string, kind?: ImportRowKind) {
    return this.prisma.importRow.findMany({ where: { batchId: id, kind }, orderBy: { seq: 'asc' } });
  }
  async listIssues(id: string) {
    return this.prisma.importIssue.findMany({ where: { batchId: id }, orderBy: [{ severity: 'asc' }, { ruleId: 'asc' }] });
  }
  async listEntities(id: string) {
    return this.prisma.importEntityMap.findMany({ where: { batchId: id }, orderBy: { occurrences: 'desc' } });
  }

  // ── edits ──
  async patchRow(id: string, rowId: string, patch: Record<string, unknown>) {
    const row = await this.prisma.importRow.findFirstOrThrow({ where: { id: rowId, batchId: id } }).catch(() => {
      throw new NotFoundException('Qator topilmadi');
    });
    const resolved = { ...(row.resolvedJson as object), ...patch };
    await this.invalidatePreview(id);
    return this.prisma.importRow.update({ where: { id: rowId }, data: { resolvedJson: J(resolved), status: ImportRowStatus.READY, editedAt: new Date() } });
  }
  async resolveIssue(id: string, issueId: string, resolution: { status: 'ACCEPTED' | 'EDITED' | 'IGNORED'; value?: unknown }, user: RequestUser) {
    const issue = await this.prisma.importIssue.findFirstOrThrow({ where: { id: issueId, batchId: id } });
    await this.invalidatePreview(id);

    // Accepting/editing a field-level suggestion actually CORRECTS the row data the
    // commit will use — not just marks the issue resolved. e.g. «Toʼgʼrilash» on a
    // TANNARX issue writes the corrected cost price into the row's resolvedJson.
    if ((resolution.status === 'ACCEPTED' || resolution.status === 'EDITED') && issue.rowId && issue.field) {
      const value = resolution.value !== undefined ? resolution.value : issue.suggestedValue;
      if (value !== null && value !== undefined) {
        const row = await this.prisma.importRow.findUnique({ where: { id: issue.rowId } });
        if (row) {
          const patch: Record<string, unknown> = { [issue.field]: value };
          // The commit routes each row to a client by `resolvedClientName` — so naming
          // the client (MIJOZ_YOQ / MIJOZ_AGENT_NOMI, field=clientRaw) must update BOTH
          // the raw cell and the resolved name, else the fix wouldn't reach the ledger.
          if (issue.field === 'clientRaw' && typeof value === 'string') patch.resolvedClientName = value;
          const resolved = { ...(row.resolvedJson as object), ...patch };
          await this.prisma.importRow.update({ where: { id: issue.rowId }, data: { resolvedJson: J(resolved), status: ImportRowStatus.READY, editedAt: new Date() } });
        }
      }
    }

    return this.prisma.importIssue.update({
      where: { id: issueId },
      data: { status: resolution.status, resolvedValue: resolution.value === undefined ? Prisma.JsonNull : J(resolution.value), resolvedById: user.userId ?? null, resolvedAt: new Date() },
    });
  }

  /**
   * Resolve a PENDING client-name (a spelling variant the matcher wasn't sure about).
   * The owner picks/types the correct canonical name; we (a) stamp that name onto every
   * staged row that used this raw name so the commit routes them to the right client,
   * and (b) mark the entity decided so it stops blocking the commit gate.
   */
  async resolveEntity(id: string, mapId: string, name: string) {
    const map = await this.prisma.importEntityMap.findFirst({ where: { id: mapId, batchId: id } });
    if (!map) throw new NotFoundException('Mijoz nomi topilmadi');
    const canonical = name.trim();
    if (!canonical) throw new BadRequestException('Mijoz nomi boʼsh boʼlishi mumkin emas');
    await this.invalidatePreview(id);

    // stamp the chosen name onto every row whose raw client name matches this entity
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id } });
    for (const row of rows) {
      const rj = row.resolvedJson as Record<string, unknown>;
      const raw = String(rj.clientRaw ?? '');
      if (raw && norm(raw).key === map.normalizedKey) {
        await this.prisma.importRow.update({
          where: { id: row.id },
          data: { resolvedJson: J({ ...rj, resolvedClientName: canonical }), status: ImportRowStatus.READY, editedAt: new Date() },
        });
      }
    }

    // decided → no longer PENDING (commit upserts the Client by name, so CREATE is safe
    // whether `canonical` is an existing client or a brand-new one)
    return this.prisma.importEntityMap.update({
      where: { id: mapId },
      data: { decision: ImportEntityDecision.CREATE, newName: canonical },
    });
  }

  // ── preview / commit ──
  async preview(id: string) {
    const input = await this.buildCommitInput(id);
    const result = await runCommit(this.prisma, input, { dryRun: true });
    const previewHash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    await this.prisma.importBatch.update({ where: { id }, data: { preview: J(result), previewHash, previewAt: new Date(), status: ImportBatchStatus.READY } });
    return { ...result, previewHash };
  }

  async commit(id: string, confirmToken: string, user: RequestUser) {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    if (batch.status === ImportBatchStatus.COMMITTED) throw new ConflictException('Bu import allaqachon yuborilgan');
    if (!batch.previewHash || batch.previewHash !== confirmToken) {
      throw new ConflictException('Preview eskirgan — qayta ko‘rib chiqing (409)');
    }
    const blockers = await this.prisma.importIssue.count({ where: { batchId: id, severity: 'BLOCK', status: 'OPEN' } });
    if (blockers > 0) throw new BadRequestException(`${blockers} ta to‘siq hal qilinmagan`);
    const unresolvedEntities = await this.prisma.importEntityMap.count({ where: { batchId: id, decision: ImportEntityDecision.PENDING } });
    if (unresolvedEntities > 0) throw new BadRequestException(`${unresolvedEntities} ta mijoz nomi aniqlanmagan`);

    await this.prisma.importBatch.update({ where: { id }, data: { status: ImportBatchStatus.COMMITTING } });
    const input = await this.buildCommitInput(id, user.userId);
    try {
      const result = await runCommit(this.prisma, input, { dryRun: false });
      await this.prisma.importBatch.update({ where: { id }, data: { status: ImportBatchStatus.COMMITTED, committedAt: new Date(), preview: J(result) } });
      return result;
    } catch (e) {
      await this.prisma.importBatch.update({ where: { id }, data: { status: ImportBatchStatus.FAILED, error: (e as Error).message } });
      throw e;
    }
  }

  async rollback(id: string, user: RequestUser) {
    const result = await runRollback(this.prisma, id, user.userId ?? null);
    return result;
  }

  // ── helpers ──
  private async buildCommitInput(id: string, createdById?: string | null) {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id } });
    const shipments: ShipmentRow[] = [];
    const clientPayments: ClientPaymentRow[] = [];
    const factoryPayments: FactoryPaymentRow[] = [];
    const nameByOrigin = new Map<string, string>();
    for (const row of rows) {
      const resolved = row.resolvedJson as Record<string, unknown>;
      const key = `${row.sheetName}|${row.excelRow}`;
      if (typeof resolved.resolvedClientName === 'string') nameByOrigin.set(key, resolved.resolvedClientName);
      if (row.kind === ImportRowKind.SHIPMENT) shipments.push(jsonToShipment(resolved));
      else if (row.kind === ImportRowKind.CLIENT_PAYMENT) clientPayments.push(jsonToClientPayment(resolved));
      else if (row.kind === ImportRowKind.FACTORY_PAYMENT) factoryPayments.push(jsonToFactoryPayment(resolved));
    }
    return {
      batchId: id, filename: batch.filename, factoryName: FACTORY_NAME,
      shipments, clientPayments, factoryPayments, createdById: createdById ?? null,
      resolveClient: (raw: string, o: RowOrigin) => nameByOrigin.get(`${o.sheetName}|${o.excelRow}`) ?? (raw || PLACEHOLDER_CLIENT),
    };
  }

  private async invalidatePreview(id: string) {
    await this.prisma.importBatch.updateMany({ where: { id, status: ImportBatchStatus.READY }, data: { status: ImportBatchStatus.DRAFT, previewHash: null } });
  }

  private async rulesConfig() {
    const s = await this.prisma.appSetting.findUnique({ where: { key: IMPORT_RULES_SETTING_KEY } }).catch(() => null);
    return resolveRulesConfig((s?.value as any) ?? null);
  }

  private async summary(db: PrismaService | Prisma.TransactionClient, id: string) {
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    const rowsByKind = await db.importRow.groupBy({ by: ['kind'], where: { batchId: id }, _count: true });
    const issuesBySev = await db.importIssue.groupBy({ by: ['severity', 'status'], where: { batchId: id }, _count: true });
    const entitiesByDecision = await db.importEntityMap.groupBy({ by: ['decision'], where: { batchId: id }, _count: true });
    const openBlockers = issuesBySev.filter((g) => g.severity === 'BLOCK' && g.status === 'OPEN').reduce((a, g) => a + g._count, 0);
    const pendingEntities = entitiesByDecision.filter((g) => g.decision === 'PENDING').reduce((a, g) => a + g._count, 0);
    return {
      batch: { id: batch.id, filename: batch.filename, status: batch.status, previewHash: batch.previewHash, preview: batch.preview, createdAt: batch.createdAt },
      rowsByKind: Object.fromEntries(rowsByKind.map((g) => [g.kind, g._count])),
      issuesBySeverity: issuesBySev,
      entitiesByDecision: Object.fromEntries(entitiesByDecision.map((g) => [g.decision, g._count])),
      // Ready once the data is complete (no blockers, no undecided client names). The
      // dry-run preview is (re)computed automatically at commit time, so it no longer
      // gates the button — fixing an issue used to silently re-disable commit.
      commitReady: openBlockers === 0 && pendingEntities === 0,
      previewFresh: !!batch.previewHash,
      openBlockers, pendingEntities,
    };
  }
}
