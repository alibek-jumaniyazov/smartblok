import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ImportBatchStatus, ImportEntityDecision, ImportEntityKind, ImportRowKind, ImportRowStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/scoping';
import { WorkbookReader } from './parse/workbook.reader';
import { parseJurnal, parseFactoryTransfers, parseFactoryDeclaredTotal, parseAgentSummary } from './parse/jurnal.parser';
import { parseAgentSheets } from './parse/agent-sheet.parser';
import { resolveClients, RawName } from './resolve/entity-resolver';
import { matchName } from './resolve/matcher';
import { norm } from './resolve/normalize';
import { runRules } from './rules/validate.service';
import { IMPORT_RULES_SETTING_KEY, resolveRulesConfig } from './rules/config';
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

    // The same workbook MAY be uploaded again — re-import is a first-class flow now. What
    // happens to the data is decided at commit (mode: APPEND adds on top · REPLACE swaps
    // out the previously imported data). sourceHash is still recorded for provenance.

    const shipments = parseJurnal(wb);
    const ledgers = parseAgentSheets(wb);
    const factoryPayments = parseFactoryTransfers(wb);
    const agentSummary = parseAgentSummary(wb);
    const clientPayments = ledgers.flatMap((l) => l.clients.flatMap((c) => c.payments));

    // Agents are the agent-sheet tab names — nothing hardcoded anymore. (Journal col C
    // spelling variants are reconciled by the AGENT_NOMI_FARQI rule, not by this set.)
    const agentKeys = new Set(ledgers.map((l) => norm(l.agentName).key));

    // Canonical client registry = the block headers of the agent sheets.
    const canon = [...new Map(
      ledgers.flatMap((l) => l.clients.map((c) => [norm(c.clientRaw).key, c.clientRaw] as const)),
    ).values()];

    // distinct client names (minus blanks & agent-names) → entity decisions
    const nameAgg = new Map<string, { n: number; rows: string[] }>();
    const addName = (name: string, tag: string) => {
      const t = name.trim();
      if (!t || agentKeys.has(norm(t).key)) return;
      const e = nameAgg.get(t) ?? { n: 0, rows: [] };
      e.n++; if (e.rows.length < 5) e.rows.push(tag);
      nameAgg.set(t, e);
    };
    shipments.forEach((r) => addName(r.clientRaw, `${r.origin.sheetName} r${r.origin.excelRow}`));
    clientPayments.forEach((p) => addName(p.clientRaw, `${p.origin.sheetName} r${p.origin.excelRow}`));
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
    const factoryDeclaredTotal = parseFactoryDeclaredTotal(wb);
    const ctx = { shipments, clientPayments, factoryPayments, ledgers, agentSummary, factoryDeclaredTotal, agentKeys, cfg };
    const findings = runRules(ctx);
    const aiFindings = await this.ai.review(ctx, findings);
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
          ['pay', norm(p.clientRaw).key, p.date?.toISOString().slice(0, 10) ?? '', p.total?.toString() ?? '', String(p.palletReturn ?? '')]);
      }
      for (const f of factoryPayments) {
        await stageRow(ImportRowKind.FACTORY_PAYMENT, f.origin, factoryPaymentToJson(f), null,
          ['fac', f.date?.toISOString().slice(0, 10) ?? '', f.amount?.toString() ?? '', String(f.origin.excelRow)]);
      }

      await tx.importEntityMap.createMany({
        data: decisions.map((d) => ({
          batchId: batch.id, kind: ImportEntityKind.CLIENT, sourceName: d.sourceName, normalizedKey: d.normalizedKey,
          occurrences: d.occurrences, sampleRows: J(d.sampleRows), decision: d.decision,
          targetId: d.targetId, newName: d.targetName, suggestion: d.suggestion ? J(d.suggestion) : Prisma.JsonNull,
        })),
        skipDuplicates: true,
      });

      // Agents come from the sheet tabs — record them as decided AGENT entities so the
      // commit can create them with their daftar number even before any row references them.
      await tx.importEntityMap.createMany({
        data: ledgers.map((l) => {
          const agentNo = l.clients.find((c) => c.agentNo != null)?.agentNo ?? null;
          return {
            batchId: batch.id, kind: ImportEntityKind.AGENT, sourceName: l.agentName,
            normalizedKey: norm(l.agentName).key, occurrences: l.clients.length,
            sampleRows: J(agentNo != null ? [`daftar №${agentNo}`] : []),
            decision: ImportEntityDecision.CREATE, targetId: null, newName: l.agentName,
            suggestion: Prisma.JsonNull,
          };
        }),
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
    return this.prisma.importEntityMap.findMany({ where: { batchId: id, kind: ImportEntityKind.CLIENT }, orderBy: { occurrences: 'desc' } });
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
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    // a preview after commit must NEVER resurrect the batch to READY — that would
    // re-enable the commit button and double every balance on the second send
    if (batch.status === ImportBatchStatus.COMMITTED || batch.status === ImportBatchStatus.COMMITTING || batch.status === ImportBatchStatus.ROLLED_BACK) {
      throw new ConflictException('Bu import allaqachon yuborilgan yoki qaytarilgan — preview yangilanmaydi');
    }
    const input = await this.buildCommitInput(id);
    const result = await runCommit(this.prisma, input, { dryRun: true });
    const previewHash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    await this.prisma.importBatch.update({ where: { id }, data: { preview: J(result), previewHash, previewAt: new Date(), status: ImportBatchStatus.READY } });
    return { ...result, previewHash };
  }

  async commit(id: string, confirmToken: string, user: RequestUser, mode: 'APPEND' | 'REPLACE' = 'APPEND') {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    if (batch.status === ImportBatchStatus.COMMITTED) throw new ConflictException('Bu import allaqachon yuborilgan');
    if (!batch.previewHash || batch.previewHash !== confirmToken) {
      throw new ConflictException('Preview eskirgan — qayta ko‘rib chiqing (409)');
    }
    const blockers = await this.prisma.importIssue.count({ where: { batchId: id, severity: 'BLOCK', status: 'OPEN' } });
    if (blockers > 0) throw new BadRequestException(`${blockers} ta to‘siq hal qilinmagan`);
    const unresolvedEntities = await this.prisma.importEntityMap.count({ where: { batchId: id, decision: ImportEntityDecision.PENDING } });
    if (unresolvedEntities > 0) throw new BadRequestException(`${unresolvedEntities} ta mijoz nomi aniqlanmagan`);
    // (No same-file twin gate: re-import is allowed; APPEND/REPLACE below decides the effect.)

    // atomic gate: only DRAFT/READY/FAILED may enter COMMITTING — a concurrent commit
    // (or a crash-stranded COMMITTING batch) must not double-post the whole import
    const gate = await this.prisma.importBatch.updateMany({
      where: { id, status: { in: [ImportBatchStatus.DRAFT, ImportBatchStatus.READY, ImportBatchStatus.FAILED] } },
      data: { status: ImportBatchStatus.COMMITTING },
    });
    if (gate.count === 0) throw new ConflictException('Import hozir yuborilmoqda yoki allaqachon yuborilgan');

    try {
      // REPLACE: swap out ALL previously imported data first — every other committed
      // import batch is rolled back by compensation (orders cancelled, payments/kassa
      // storno'd, ledger & pallets reversed). Manual (non-import) records are untouched.
      // A prior batch that has real downstream work refuses to roll back → 409, and the
      // batch below is marked FAILED (nothing of THIS file was written yet).
      if (mode === 'REPLACE') {
        const priors = await this.prisma.importBatch.findMany({
          where: { status: ImportBatchStatus.COMMITTED, id: { not: id } },
          orderBy: { committedAt: 'asc' },
          select: { id: true, filename: true },
        });
        for (const p of priors) {
          try {
            await runRollback(this.prisma, p.id, user.userId ?? null);
          } catch (e) {
            throw new ConflictException(
              `To‘liq almashtirish uchun avvalgi importni («${p.filename}») orqaga qaytarib bo‘lmadi: ${(e as Error).message}`,
            );
          }
        }
      }

      const input = await this.buildCommitInput(id, user.userId);
      const result = await runCommit(this.prisma, input, { dryRun: false });
      await this.prisma.importBatch.update({ where: { id }, data: { status: ImportBatchStatus.COMMITTED, committedAt: new Date(), preview: J(result) } });
      return result;
    } catch (e) {
      // previewHash is cleared so a later edit+retry can't reuse the stale confirm token
      await this.prisma.importBatch.update({ where: { id }, data: { status: ImportBatchStatus.FAILED, error: (e as Error).message, previewHash: null } });
      throw e;
    }
  }

  async rollback(id: string, user: RequestUser) {
    try {
      return await runRollback(this.prisma, id, user.userId ?? null);
    } catch (e) {
      // the refusal messages are owner-meaningful — surface them as 409, not a blank 500
      throw new ConflictException((e as Error).message);
    }
  }

  // ── helpers ──
  private async buildCommitInput(id: string, createdById?: string | null) {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id } });
    const agentEntities = await this.prisma.importEntityMap.findMany({ where: { batchId: id, kind: ImportEntityKind.AGENT } });
    const shipments: ShipmentRow[] = [];
    const clientPayments: ClientPaymentRow[] = [];
    const factoryPayments: FactoryPaymentRow[] = [];
    const nameByOrigin = new Map<string, string>();

    // Canonical agent names = the agent-sheet tabs (staged as AGENT entities). Journal
    // col C spelling variants are folded onto them by normalized key.
    const agentCanon = new Map(agentEntities.map((e) => [e.normalizedKey, e.sourceName] as const));

    // Each row carries the agent that owns the client. Ledger rows (payments live on the
    // agent's own sheet) are authoritative, journal rows only vote — so a ledger row
    // outweighs any number of conflicting journal spellings.
    const agentVotes = new Map<string, Map<string, number>>(); // client name → agent name → weight
    const voteAgent = (clientName: string, agentRaw: unknown, weight: number) => {
      const t = String(agentRaw ?? '').trim();
      if (!t) return;
      const agent = agentCanon.get(norm(t).key) ?? t;
      const inner = agentVotes.get(clientName) ?? new Map<string, number>();
      inner.set(agent, (inner.get(agent) ?? 0) + weight);
      agentVotes.set(clientName, inner);
    };

    // agent daftar number (block header prefix) — becomes Agent.sortNo on create
    const agentNoByName = new Map<string, number>();

    for (const row of rows) {
      const resolved = row.resolvedJson as Record<string, unknown>;
      const key = `${row.sheetName}|${row.excelRow}`;
      const cName = typeof resolved.resolvedClientName === 'string' ? resolved.resolvedClientName : null;
      const isLedgerRow = row.kind === ImportRowKind.CLIENT_PAYMENT;
      if (cName) {
        nameByOrigin.set(key, cName);
        voteAgent(cName, resolved.agentRaw, isLedgerRow ? 1000 : 1);
      }
      if (row.kind === ImportRowKind.SHIPMENT) shipments.push(jsonToShipment(resolved));
      else if (row.kind === ImportRowKind.CLIENT_PAYMENT) {
        const p = jsonToClientPayment(resolved);
        clientPayments.push(p);
        if (p.agentNo != null && p.agentRaw && !agentNoByName.has(p.agentRaw)) agentNoByName.set(p.agentRaw, p.agentNo);
      } else if (row.kind === ImportRowKind.FACTORY_PAYMENT) factoryPayments.push(jsonToFactoryPayment(resolved));
    }
    for (const e of agentEntities) {
      const m = /daftar №(\d+)/.exec(JSON.stringify(e.sampleRows ?? ''));
      if (m && !agentNoByName.has(e.sourceName)) agentNoByName.set(e.sourceName, Number(m[1]));
    }

    // winning agent per client (highest weight; deterministic tie-break by name)
    const agentByClient = new Map<string, string>();
    for (const [client, votes] of agentVotes) {
      const best = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (best) agentByClient.set(client, best[0]);
    }

    return {
      batchId: id, filename: batch.filename, factoryName: FACTORY_NAME,
      shipments, clientPayments, factoryPayments, createdById: createdById ?? null,
      resolveClient: (raw: string, o: RowOrigin) => nameByOrigin.get(`${o.sheetName}|${o.excelRow}`) ?? (raw || PLACEHOLDER_CLIENT),
      agentForClient: (clientName: string) => agentByClient.get(clientName) ?? null,
      agentSortNo: (agentName: string) => agentNoByName.get(agentName) ?? null,
    };
  }

  private async invalidatePreview(id: string) {
    // any edit stales the confirm token — including after a FAILED commit attempt
    await this.prisma.importBatch.updateMany({
      where: { id, status: { in: [ImportBatchStatus.READY, ImportBatchStatus.FAILED] } },
      data: { status: ImportBatchStatus.DRAFT, previewHash: null },
    });
  }

  private async rulesConfig() {
    const s = await this.prisma.appSetting.findUnique({ where: { key: IMPORT_RULES_SETTING_KEY } }).catch(() => null);
    return resolveRulesConfig((s?.value as any) ?? null);
  }

  private async summary(db: PrismaService | Prisma.TransactionClient, id: string) {
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    const rowsByKind = await db.importRow.groupBy({ by: ['kind'], where: { batchId: id }, _count: true });
    const issuesBySev = await db.importIssue.groupBy({ by: ['severity', 'status'], where: { batchId: id }, _count: true });
    const entitiesByDecision = await db.importEntityMap.groupBy({ by: ['decision'], where: { batchId: id, kind: ImportEntityKind.CLIENT }, _count: true });
    const openBlockers = issuesBySev.filter((g) => g.severity === 'BLOCK' && g.status === 'OPEN').reduce((a, g) => a + g._count, 0);
    const pendingEntities = entitiesByDecision.filter((g) => g.decision === 'PENDING').reduce((a, g) => a + g._count, 0);
    // how many OTHER committed imports a REPLACE would roll back (drives the commit UI)
    const priorCommittedImports = await db.importBatch.count({
      where: { status: ImportBatchStatus.COMMITTED, id: { not: id } },
    });
    return {
      batch: { id: batch.id, filename: batch.filename, status: batch.status, previewHash: batch.previewHash, preview: batch.preview, error: batch.error, createdAt: batch.createdAt },
      rowsByKind: Object.fromEntries(rowsByKind.map((g) => [g.kind, g._count])),
      issuesBySeverity: issuesBySev,
      entitiesByDecision: Object.fromEntries(entitiesByDecision.map((g) => [g.decision, g._count])),
      // Ready once the data is complete (no blockers, no undecided client names). The
      // dry-run preview is (re)computed automatically at commit time, so it no longer
      // gates the button — fixing an issue used to silently re-disable commit.
      commitReady: openBlockers === 0 && pendingEntities === 0,
      previewFresh: !!batch.previewHash,
      openBlockers, pendingEntities,
      priorCommittedImports,
    };
  }
}
