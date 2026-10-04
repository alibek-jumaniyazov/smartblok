import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ImportBatchStatus, ImportEntityDecision, ImportEntityKind, ImportRowKind, ImportRowStatus, Prisma,
  type ImportBatch, type ImportRow, type ImportEntityMap,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/scoping';
import { TemplateMismatchError, WorkbookReader } from './parse/workbook.reader';
import { parseDeclaredTotals, parseMasterData } from './parse/master.parser';
import {
  parseClientPayments, parseFactoryPalletReturns, parseFactoryPayments,
  parsePalletReturns, parseShipments,
} from './parse/sheets.parser';
import { Dictionary } from './resolve/dictionary';
import { isWarehousePalletMovement } from './parse/pallet-kind';
import { norm } from './resolve/normalize';
import { InvalidCellError } from './parse/cells';
import { issueReviewContext, sourceLayout, type ReviewSnapshot } from './review-context';
import { runRules } from './rules/validate.service';
import type { Finding } from './rules/rule-registry';
import { IMPORT_RULES_SETTING_KEY, resolveRulesConfig } from './rules/config';
import { AiReviewService } from './rules/ai-review.service';
import { runCommit } from './commit/import-commit.service';
import { runRollback } from './commit/import-rollback.service';
import {
  clientPaymentToJson, factoryPalletReturnToJson, factoryPaymentToJson, jsonToClientPayment,
  jsonToFactoryPalletReturn, jsonToFactoryPayment, jsonToPalletReturn, jsonToShipment,
  palletReturnToJson, shipmentToJson,
} from './serialize';
import type {
  ClientPaymentRow, FactoryPalletReturnRow, FactoryPaymentRow, IncompleteRow, MasterData,
  PalletReturnRow, ParsedWorkbook, RowOrigin, ShipmentRow,
} from './parse/types';

const PLACEHOLDER_CLIENT = 'Nomaʼlum mijoz (import)';
const DEFAULT_PALLET_PRICE = '130000';
const J = (v: unknown) => v as Prisma.InputJsonValue;

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiReviewService) {}

  // ─────────────────────── yuklash → staging ───────────────────────

  async uploadAndStage(buffer: Buffer, filename: string, user: RequestUser) {
    if (buffer.subarray(0, 4).toString('hex') !== '504b0304') {
      throw new BadRequestException('Fayl Excel .xlsb yoki .xlsx (ZIP) formatida emas.');
    }

    let parsed: ParsedWorkbook;
    try {
      parsed = await parseWorkbook(buffer);
    } catch (e) {
      // Shablon mos kelmasa import BOSHLANMAYDI. Bu ataylab qattiq: eski shablonning
      // «Товар» varag'i ham «Агент»/«Клиент» sarlavhalariga ega, ya'ni noto'g'ri fayl
      // JIMGINA o'qilib, butunlay boshqa ustunlardan pul yasagan bo'lardi.
      if (e instanceof TemplateMismatchError || e instanceof InvalidCellError) {
        throw new BadRequestException(
          `Fayl kutilgan shablonga mos emas: ${e.message}. «Smartblok.xlsb» yoki unga mos .xlsx faylni yuklang.`,
        );
      }
      throw e;
    }

    const sourceHash = createHash('sha256').update(buffer).digest('hex');
    const dict = Dictionary.from(parsed.master);
    const cfg = await this.rulesConfig();
    const findings = runRules({ ...parsed, dict, cfg });
    const aiFindings = await this.ai.review({ ...parsed, dict, cfg }, findings);
    const allFindings = [...findings, ...aiFindings];

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          filename, sourceHash, status: ImportBatchStatus.DRAFT,
          rulesSnapshot: J(cfg), createdById: user.userId ?? null,
          // Справочник PARTIYADA saqlanadi: yuklangan fayl commit vaqtida allaqachon yo'q,
          // egasi esa savollarga keyinroq javob beradi — o'shanda ham paddon bazaviy narxi
          // va zavod nomlari o'sha faylnikidek qolishi kerak.
          stats: J({
            master: serializeMaster(parsed.master),
            incomplete: parsed.incomplete,
            declared: serializeDeclared(parsed.declared),
            sourceLayout: parsed.sourceLayout,
          }),
        },
      });

      let seq = 0;
      const rowIdByOrigin = new Map<string, string>();
      const stage = async (
        kind: ImportRowKind, origin: RowOrigin, parsedJson: object,
        resolvedClientName: string | null, fpParts: string[],
      ) => {
        const resolved = { ...parsedJson, resolvedClientName };
        const fingerprint = createHash('sha256').update(fpParts.join('|')).digest('hex');
        const row = await tx.importRow.create({
          data: {
            batchId: batch.id, kind, sheetName: origin.sheetName, excelRow: origin.excelRow, seq: seq++,
            rawJson: J(parsedJson), parsedJson: J(parsedJson), resolvedJson: J(resolved),
            fingerprint, groupKey: kind === ImportRowKind.SHIPMENT ? fpParts.slice(0, 3).join('|') : null,
            status: ImportRowStatus.PENDING,
          },
        });
        rowIdByOrigin.set(`${origin.sheetName}|${origin.excelRow}`, row.id);
      };

      const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? '';
      const canon = (raw: string) => dict.resolveClient(raw).canonical ?? (raw.trim() || PLACEHOLDER_CLIENT);

      for (const r of parsed.shipments) {
        await stage(ImportRowKind.SHIPMENT, r.origin, shipmentToJson(r), canon(r.clientRaw),
          ['ship', canon(r.clientRaw), day(r.date), r.truck, String(r.cube ?? '')]);
      }
      for (const p of parsed.clientPayments) {
        await stage(ImportRowKind.CLIENT_PAYMENT, p.origin, clientPaymentToJson(p), canon(p.clientRaw),
          ['pay', canon(p.clientRaw), day(p.date), p.totalDeclared?.toString() ?? '', String(p.palletQty ?? '')]);
      }
      for (const f of parsed.factoryPayments) {
        await stage(ImportRowKind.FACTORY_PAYMENT, f.origin, factoryPaymentToJson(f), null,
          ['fac', day(f.date), f.amount?.toString() ?? '', f.factoryRaw, String(f.origin.excelRow)]);
      }
      for (const p of parsed.palletReturns) {
        await stage(ImportRowKind.PALLET_RETURN, p.origin, palletReturnToJson(p), isWarehousePalletMovement(p) ? null : canon(p.clientRaw),
          ['pret', canon(p.clientRaw), day(p.date), String(p.qty ?? '')]);
      }
      for (const p of parsed.factoryPalletReturns) {
        await stage(ImportRowKind.FACTORY_PALLET_RETURN, p.origin, factoryPalletReturnToJson(p), null,
          ['fret', day(p.date), p.factoryRaw, String(p.qty ?? ''), String(p.origin.excelRow)]);
      }

      // ── ayniyat qarorlari ──
      // Yangi shablonda mijoz nomi справочникда yozilgan, ya'ni qaror KERAK EMAS: lug'atda
      // bor nom darhol LINK bo'ladi. PENDING faqat lug'atda umuman yo'q nom uchun qoladi —
      // va aynan o'sha egasidan javob talab qiladi.
      await tx.importEntityMap.createMany({
        data: clientEntityRows(batch.id, parsed, dict),
        skipDuplicates: true,
      });
      await tx.importEntityMap.createMany({
        data: dict.agents().map((name) => ({
          batchId: batch.id, kind: ImportEntityKind.AGENT, sourceName: name,
          normalizedKey: name.toLowerCase(), occurrences: 1, sampleRows: J([]),
          decision: ImportEntityDecision.CREATE, newName: name, suggestion: Prisma.JsonNull,
        })),
        skipDuplicates: true,
      });
      await tx.importEntityMap.createMany({
        data: dict.factories().map((name) => ({
          batchId: batch.id, kind: ImportEntityKind.FACTORY, sourceName: name,
          normalizedKey: name.toLowerCase(), occurrences: 1, sampleRows: J([]),
          decision: ImportEntityDecision.CREATE, newName: name, suggestion: Prisma.JsonNull,
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

  // ─────────────────────────── o'qish ───────────────────────────

  async getBatch(id: string) {
    const exists = await this.prisma.importBatch.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Import topilmadi');
    return this.summary(this.prisma, id);
  }
  async listRows(id: string, kind?: ImportRowKind) {
    return this.prisma.importRow.findMany({ where: { batchId: id, kind }, orderBy: { seq: 'asc' } });
  }
  async listIssues(id: string) {
    const [batch, issues, rows, entities] = await Promise.all([
      this.prisma.importBatch.findUniqueOrThrow({ where: { id } }),
      this.prisma.importIssue.findMany({ where: { batchId: id }, orderBy: [{ severity: 'asc' }, { ruleId: 'asc' }] }),
      this.prisma.importRow.findMany({ where: { batchId: id }, orderBy: { seq: 'asc' } }),
      this.prisma.importEntityMap.findMany({ where: { batchId: id } }),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Older versions allowed a blocker to be acknowledged without correcting it.
    // Show that unresolved input again without mutating the audit record on a GET.
    const actual = stagedBlockingFindings({ batch, rows, entities });
    return issues.map((issue) => ({
      ...issue,
      ...(issue.severity === 'BLOCK' && actual.some((finding) => {
        const row = issue.rowId ? byId.get(issue.rowId) : null;
        return finding.ruleId === issue.ruleId && (finding.field ?? null) === issue.field &&
          (!row || (finding.origin.sheetName === row.sheetName && finding.origin.excelRow === row.excelRow));
      }) ? { status: 'OPEN' } : {}),
      ...issueReviewContext(issue, issue.rowId ? byId.get(issue.rowId) ?? null : null, (batch.stats ?? {}) as ReviewSnapshot, entities),
    }));
  }
  async listEntities(id: string) {
    return this.prisma.importEntityMap.findMany({
      where: { batchId: id, kind: ImportEntityKind.CLIENT }, orderBy: { occurrences: 'desc' },
    });
  }

  // ─────────────────────────── tahrir ───────────────────────────

  async patchRow(id: string, rowId: string, patch: Record<string, unknown>) {
    return this.prisma.$transaction(async (tx) => {
      const state = await this.lockImportEdit(tx, id);
      const row = state.rows.find((r) => r.id === rowId);
      if (!row) throw new NotFoundException('Qator topilmadi');
      return this.applyRowCorrection(tx, state, row, patch);
    }, { timeout: 30_000 });
  }

  async resolveIssue(
    id: string, issueId: string,
    resolution: { status: 'ACCEPTED' | 'EDITED' | 'IGNORED'; value?: unknown },
    user: RequestUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const state = await this.lockImportEdit(tx, id);
      const issue = await tx.importIssue.findFirstOrThrow({ where: { id: issueId, batchId: id } });
      if (issue.severity === 'BLOCK' && resolution.status === 'IGNORED') {
        throw new BadRequestException('Majburiy xatoni e’tiborsiz qoldirib bo‘lmaydi. Qatordagi qiymatni to‘g‘rilang.');
      }
      const value = resolution.value !== undefined ? resolution.value : issue.suggestedValue;
      const row = state.rows.find((r) => r.id === issue.rowId);
      let findings = stagedBlockingFindings(state);
      if (resolution.status !== 'IGNORED' && value !== null && value !== undefined && row && issue.field) {
        await this.applyRowCorrection(tx, state, row, { [issue.field]: value }, user.userId);
        findings = stagedBlockingFindings(state);
      }
      if (issue.severity === 'BLOCK') {
        // Sheet-level settings require a corrected workbook. Row blockers can only
        // close after the same production validation rule stops reporting them.
        const remaining = findings.find((f) => f.ruleId === issue.ruleId && (f.field ?? null) === issue.field &&
          (!row || (f.origin.sheetName === row.sheetName && f.origin.excelRow === row.excelRow)));
        if (remaining) throw new BadRequestException(`${remaining.message} Haqiqiy qiymatni kiriting; tasdiqlashning o‘zi xatoni tuzatmaydi.`);
        if (!row) {
          throw new BadRequestException('Bu xatoni Excel faylida tuzatib, faylni qayta yuklang.');
        }
      }
      await this.syncBlockingIssues(tx, state, findings, user.userId);
      return tx.importIssue.update({
        where: { id: issueId },
        data: {
          status: resolution.status,
          resolvedValue: value === undefined || value === null ? Prisma.JsonNull : J(value),
          resolvedById: user.userId ?? null, resolvedAt: new Date(),
        },
      });
    }, { timeout: 30_000 });
  }

  /**
   * Lug'atda topilmagan nomni egasi hal qiladi: kanonik nomni tanlaydi/yozadi. Tanlangan nom
   * SHU nomni ishlatgan har bir staged qatorga bosiladi, so'ng qaror «hal qilingan» bo'ladi.
   */
  async resolveEntity(id: string, mapId: string, name: string) {
    const canonical = name.trim();
    if (!canonical) throw new BadRequestException('Mijoz nomi boʼsh boʼlishi mumkin emas');
    return this.prisma.$transaction(async (tx) => {
      const state = await this.lockImportEdit(tx, id);
      const map = state.entities.find((entry) => entry.id === mapId && entry.kind === ImportEntityKind.CLIENT);
      if (!map) throw new NotFoundException('Mijoz nomi topilmadi');
      const changed = new Set<string>();
      state.rows = state.rows.map((row) => {
        const resolved = row.resolvedJson as Record<string, unknown>;
        if (String(resolved.clientRaw ?? '') !== map.sourceName) return row;
        changed.add(row.id);
        return { ...row, resolvedJson: { ...resolved, resolvedClientName: canonical } as Prisma.JsonObject };
      });
      const saved = await tx.importEntityMap.update({
        where: { id: mapId }, data: { decision: ImportEntityDecision.CREATE, newName: canonical },
      });
      state.entities = state.entities.map((entry) => entry.id === mapId ? saved : entry);
      const findings = stagedBlockingFindings(state);
      for (const row of state.rows) {
        if (!changed.has(row.id)) continue;
        await tx.importRow.update({ where: { id: row.id }, data: {
          resolvedJson: J(row.resolvedJson), editedAt: new Date(),
          status: findings.some((f) => f.origin.sheetName === row.sheetName && f.origin.excelRow === row.excelRow)
            ? ImportRowStatus.PENDING : ImportRowStatus.READY,
        } });
      }
      await this.syncBlockingIssues(tx, state, findings);
      return saved;
    }, { timeout: 30_000 });
  }

  // ─────────────────────── preview / commit ───────────────────────

  async preview(id: string, mode: 'APPEND' | 'REPLACE' = 'APPEND') {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    if (
      batch.status === ImportBatchStatus.COMMITTED ||
      batch.status === ImportBatchStatus.COMMITTING ||
      batch.status === ImportBatchStatus.ROLLED_BACK
    ) {
      throw new ConflictException('Bu import allaqachon yuborilgan yoki qaytarilgan — preview yangilanmaydi');
    }
    const input = await this.buildCommitInput(id);
    const result = await runCommit(this.prisma, { ...input, wipeFirst: mode === 'REPLACE' }, { dryRun: true });
    const previewHash = createHash('sha256').update(JSON.stringify({ mode, result })).digest('hex');
    const saved = await this.prisma.importBatch.updateMany({
      where: {
        id, updatedAt: batch.updatedAt,
        status: { in: [ImportBatchStatus.DRAFT, ImportBatchStatus.READY, ImportBatchStatus.FAILED] },
      },
      data: { preview: J({ ...result, importMode: mode }), previewHash, previewAt: new Date(), status: ImportBatchStatus.READY },
    });
    if (!saved.count) throw new ConflictException('Hisoblash davomida import o‘zgardi — previewni qayta hisoblang');
    return { ...result, previewHash };
  }

  async commit(id: string, confirmToken: string, user: RequestUser, mode: 'APPEND' | 'REPLACE' = 'APPEND') {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    if (batch.status === ImportBatchStatus.COMMITTED) throw new ConflictException('Bu import allaqachon yuborilgan');
    if (!batch.previewHash || batch.previewHash !== confirmToken) {
      throw new ConflictException('Preview eskirgan — qayta ko‘rib chiqing (409)');
    }
    if ((batch.preview as { importMode?: string } | null)?.importMode !== mode) {
      throw new ConflictException('Import rejimi o‘zgargan — previewni qayta hisoblang');
    }
    const blockers = await this.prisma.importIssue.count({ where: { batchId: id, severity: 'BLOCK', status: 'OPEN' } });
    if (blockers > 0) throw new BadRequestException(`${blockers} ta to‘siq hal qilinmagan`);
    const unresolved = await this.prisma.importEntityMap.count({ where: { batchId: id, decision: ImportEntityDecision.PENDING } });
    if (unresolved > 0) throw new BadRequestException(`${unresolved} ta mijoz nomi aniqlanmagan`);

    const gate = await this.prisma.importBatch.updateMany({
      where: { id, previewHash: confirmToken, status: { in: [ImportBatchStatus.DRAFT, ImportBatchStatus.READY, ImportBatchStatus.FAILED] } },
      data: { status: ImportBatchStatus.COMMITTING },
    });
    if (gate.count === 0) throw new ConflictException('Import hozir yuborilmoqda yoki allaqachon yuborilgan');

    try {
      const input = await this.buildCommitInput(id, user.userId);
      const result = await runCommit(this.prisma, { ...input, wipeFirst: mode === 'REPLACE' }, { dryRun: false });
      await this.prisma.importBatch.update({
        where: { id },
        data: { status: ImportBatchStatus.COMMITTED, committedAt: new Date(), preview: J(result) },
      });
      return result;
    } catch (e) {
      await this.prisma.importBatch.update({
        where: { id },
        data: { status: ImportBatchStatus.FAILED, error: (e as Error).message, previewHash: null },
      });
      throw e;
    }
  }

  async rollback(id: string, user: RequestUser) {
    try {
      return await runRollback(this.prisma, id, user.userId ?? null);
    } catch (e) {
      throw new ConflictException((e as Error).message);
    }
  }

  // ─────────────────────────── ichki ───────────────────────────

  /**
   * Staged qatorlardan commit kirishini yig'adi.
   *
   * `seq` tartibi = staging tartibi = varaq/qator tartibi. Ataylab deterministik: FIFO
   * taqsimoti va zavod avansini yechish shu tartibga qarab ishlaydi, ya'ni bitta fayl
   * har safar bir xil natija berishi kerak.
   */
  private async buildCommitInput(id: string, createdById?: string | null) {
    const batch = await this.prisma.importBatch.findUniqueOrThrow({ where: { id } });
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id }, orderBy: { seq: 'asc' } });

    const shipments: ShipmentRow[] = [];
    const clientPayments: ClientPaymentRow[] = [];
    const factoryPayments: FactoryPaymentRow[] = [];
    const palletReturns: PalletReturnRow[] = [];
    const factoryPalletReturns: FactoryPalletReturnRow[] = [];
    const nameByOrigin = new Map<string, string>();

    for (const row of rows) {
      const resolved = row.resolvedJson as Record<string, unknown>;
      const cName = typeof resolved.resolvedClientName === 'string' ? resolved.resolvedClientName : null;
      if (cName) nameByOrigin.set(`${row.sheetName}|${row.excelRow}`, cName);
      switch (row.kind) {
        case ImportRowKind.SHIPMENT: shipments.push(jsonToShipment(resolved)); break;
        case ImportRowKind.CLIENT_PAYMENT: clientPayments.push(jsonToClientPayment(resolved)); break;
        case ImportRowKind.FACTORY_PAYMENT: factoryPayments.push(jsonToFactoryPayment(resolved)); break;
        case ImportRowKind.PALLET_RETURN: palletReturns.push(jsonToPalletReturn(resolved)); break;
        case ImportRowKind.FACTORY_PALLET_RETURN: factoryPalletReturns.push(jsonToFactoryPalletReturn(resolved)); break;
        default: break;
      }
    }

    // Справочник partiyaning O'ZIDA saqlangan (stats.master) — yuklangan fayl commit
    // vaqtida allaqachon yo'q.
    const master = (batch.stats as { master?: { settings?: { palletBasePrice?: string | null } } } | null)?.master ?? null;
    const agents = await this.prisma.importEntityMap.findMany({ where: { batchId: id, kind: ImportEntityKind.AGENT } });
    const factories = await this.prisma.importEntityMap.findMany({ where: { batchId: id, kind: ImportEntityKind.FACTORY } });
    const clients = await this.prisma.importEntityMap.findMany({ where: { batchId: id, kind: ImportEntityKind.CLIENT } });

    // Revalidate the actual resolved values. Closing an issue (or editing a row)
    // must never allow missing clients, invalid dates or quantities into the ledger.
    const snapshot = (batch.stats as any)?.master;
    const validatedMaster: MasterData = {
      settings: {
        palletBasePrice: new Prisma.Decimal(snapshot?.settings?.palletBasePrice ?? DEFAULT_PALLET_PRICE),
        taxPerM3: snapshot?.settings?.taxPerM3 == null ? null : new Prisma.Decimal(snapshot.settings.taxPerM3),
        agentKpiShare: snapshot?.settings?.agentKpiShare == null ? null : new Prisma.Decimal(snapshot.settings.agentKpiShare),
      },
      clients: [...(snapshot?.clientEntries ?? [])],
      agents: agents.map((a) => a.newName ?? a.sourceName),
      factories: factories.map((f) => f.newName ?? f.sourceName),
      payTypes: snapshot?.payTypes ?? ['Касса', 'Перечисления'],
    };
    const sourceDictionary = Dictionary.from(validatedMaster);
    const resolvedClient = <T extends { clientRaw: string; origin: RowOrigin }>(row: T): T => {
      const key = `${row.origin.sheetName}|${row.origin.excelRow}`;
      const chosen = nameByOrigin.get(key)?.trim();
      if (!chosen || chosen === PLACEHOLDER_CLIENT) return row;
      const name = sourceDictionary.resolveClient(chosen).canonical ?? chosen;
      nameByOrigin.set(key, name);
      if (!validatedMaster.clients.some((c) => c.officialName === name)) {
        validatedMaster.clients.push({ origin: row.origin, officialName: name, variants: [], legacyKey: '', agentName: '' });
      }
      return { ...row, clientRaw: name };
    };
    const resolvedShipments = shipments.map(resolvedClient);
    const resolvedPayments = clientPayments.map(resolvedClient);
    const resolvedReturns = palletReturns.map((row) => isWarehousePalletMovement(row) ? row : resolvedClient(row));
    const blocking = runRules({
      master: validatedMaster, shipments: resolvedShipments, clientPayments: resolvedPayments,
      factoryPayments, palletReturns: resolvedReturns, factoryPalletReturns,
      declared: { clientBalances: null, factories: [] }, incomplete: [],
      dict: Dictionary.from(validatedMaster), cfg: resolveRulesConfig(batch.rulesSnapshot as never),
    }).filter((finding) => finding.severity === 'BLOCK');
    if (blocking.length) throw new BadRequestException(blocking.map((f) => f.message).join('\n'));

    const agentNames = new Map(agents.map((a) => [norm(a.sourceName).key, a.newName ?? a.sourceName]));
    const factoryNames = new Map(factories.map((f) => [norm(f.sourceName).key, f.newName ?? f.sourceName]));
    const agentOfClient = new Map<string, string>(validatedMaster.clients
      .filter((c) => c.agentName.trim())
      .map((c) => [c.officialName, c.agentName]));
    for (const c of clients) {
      const agent = (c.suggestion as { agentName?: string } | null)?.agentName;
      const name = sourceDictionary.resolveClient(c.newName ?? c.sourceName).canonical ?? c.newName ?? c.sourceName;
      if (agent && !agentOfClient.has(name)) agentOfClient.set(name, agent);
    }

    return {
      batchId: id,
      filename: batch.filename,
      shipments, clientPayments, factoryPayments, palletReturns, factoryPalletReturns,
      createdById: createdById ?? null,
      resolveClient: (raw: string, o: RowOrigin) =>
        nameByOrigin.get(`${o.sheetName}|${o.excelRow}`) ?? (raw.trim() || PLACEHOLDER_CLIENT),
      agentForClient: (clientName: string) => agentOfClient.get(clientName) ?? null,
      resolveFactory: (raw: string) => factoryNames.get(norm(raw).key) ?? raw.trim(),
      resolveAgent: (raw: string) => agentNames.get(norm(raw).key) ?? (raw.trim() || null),
      palletBasePrice: new Prisma.Decimal(
        master?.settings?.palletBasePrice ? String(master.settings.palletBasePrice) : DEFAULT_PALLET_PRICE,
      ),
      ...(validatedMaster.settings.palletBasePrice !== null
        ? { palletSettingsPrice: validatedMaster.settings.palletBasePrice.toFixed() } : {}),
      ...(validatedMaster.settings.taxPerM3 !== null && validatedMaster.settings.agentKpiShare !== null
        ? { kpiSettings: {
          taxPerM3: validatedMaster.settings.taxPerM3.toFixed(),
          agentShare: validatedMaster.settings.agentKpiShare.toFixed(),
        } } : {}),
    };
  }

  private async lockImportEdit(tx: Prisma.TransactionClient, id: string): Promise<StagedValidationState> {
    // UPDATE takes the batch row lock shared with commit's gate. No row/issue
    // edit can race a commit, and a failed correction rolls this invalidation back.
    const gate = await tx.importBatch.updateMany({
      where: { id, status: { in: [ImportBatchStatus.DRAFT, ImportBatchStatus.READY, ImportBatchStatus.FAILED] } },
      data: { status: ImportBatchStatus.DRAFT, previewHash: null, preview: Prisma.DbNull, previewAt: null },
    });
    if (!gate.count) throw new ConflictException('Yuborilayotgan, yuborilgan yoki qaytarilgan importni tahrirlab bo‘lmaydi');
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id } });
    const rows = await tx.importRow.findMany({ where: { batchId: id }, orderBy: { seq: 'asc' } });
    const entities = await tx.importEntityMap.findMany({ where: { batchId: id } });
    return { batch, rows, entities };
  }

  private async applyRowCorrection(
    tx: Prisma.TransactionClient, state: StagedValidationState, row: ImportRow,
    patch: Record<string, unknown>, userId?: string | null,
  ) {
    validateRowPatch(row.resolvedJson as Record<string, unknown>, patch);
    if (typeof patch.clientRaw === 'string') {
      patch = { ...patch, clientRaw: patch.clientRaw.trim(), resolvedClientName: patch.clientRaw.trim() };
    }
    const before = new Set(stagedBlockingFindings(state).map(findingKey));
    const resolved = { ...(row.resolvedJson as object), ...patch };
    const nextRow = { ...row, resolvedJson: resolved as Prisma.JsonObject };
    const nextState = { ...state, rows: state.rows.map((r) => r.id === row.id ? nextRow : r) };
    const findings = stagedBlockingFindings(nextState);
    const sameRow = (f: Finding) => f.origin.sheetName === row.sheetName && f.origin.excelRow === row.excelRow;
    const invalid = findings.filter((f) =>
      (sameRow(f) && f.field && Object.prototype.hasOwnProperty.call(patch, f.field)) ||
      (!before.has(findingKey(f)) && (sameRow(f) || f.ruleId === 'PADDON_TUZATISH')),
    );
    if (invalid.length) throw new BadRequestException(invalid.map((f) => f.message).join('\n'));
    const saved = await tx.importRow.update({
      where: { id: row.id },
      data: {
        resolvedJson: J(resolved), editedAt: new Date(),
        status: findings.some(sameRow) ? ImportRowStatus.PENDING : ImportRowStatus.READY,
      },
    });
    state.rows = nextState.rows;
    await this.syncBlockingIssues(tx, state, findings, userId);
    return saved;
  }

  private async syncBlockingIssues(
    tx: Prisma.TransactionClient, state: StagedValidationState, findings: Finding[], userId?: string | null,
  ) {
    const issues = await tx.importIssue.findMany({ where: { batchId: state.batch.id, severity: 'BLOCK' } });
    const matched = new Set<string>();
    for (const issue of issues) {
      const row = state.rows.find((r) => r.id === issue.rowId);
      // Workbook-level settings have no editable row and remain actionable in the source.
      if (!row) continue;
      const finding = findings.find((f) => f.ruleId === issue.ruleId && (f.field ?? null) === issue.field &&
        f.origin.sheetName === row.sheetName && f.origin.excelRow === row.excelRow);
      if (finding) {
        matched.add(findingKey(finding));
        if (issue.status !== 'OPEN') await tx.importIssue.update({
          where: { id: issue.id }, data: {
            status: 'OPEN', resolvedValue: Prisma.JsonNull, resolvedById: null, resolvedAt: null,
          },
        });
      } else if (issue.status === 'OPEN') {
        const value = issue.field ? (row.resolvedJson as Record<string, unknown>)[issue.field] : null;
        await tx.importIssue.update({ where: { id: issue.id }, data: {
          status: 'EDITED', resolvedValue: value == null ? Prisma.JsonNull : J(value),
          resolvedById: userId ?? null, resolvedAt: new Date(),
        } });
      }
    }
    for (const finding of findings) {
      if (matched.has(findingKey(finding))) continue;
      const row = state.rows.find((r) => r.sheetName === finding.origin.sheetName && r.excelRow === finding.origin.excelRow);
      if (!row) continue;
      await tx.importIssue.create({ data: {
        batchId: state.batch.id, rowId: row.id, ruleId: finding.ruleId, severity: 'BLOCK',
        field: finding.field ?? null, message: finding.message,
        currentValue: finding.currentValue == null ? Prisma.JsonNull : J(finding.currentValue),
        suggestedValue: finding.suggestedValue == null ? Prisma.JsonNull : J(finding.suggestedValue),
      } });
    }
  }

  private async rulesConfig() {
    const s = await this.prisma.appSetting.findUnique({ where: { key: IMPORT_RULES_SETTING_KEY } }).catch(() => null);
    return resolveRulesConfig((s?.value as never) ?? null);
  }

  private async summary(db: PrismaService | Prisma.TransactionClient, id: string) {
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
    const rowsByKind = await db.importRow.groupBy({ by: ['kind'], where: { batchId: id }, _count: true });
    const issuesBySev = await db.importIssue.groupBy({ by: ['severity', 'status'], where: { batchId: id }, _count: true });
    const entitiesByDecision = await db.importEntityMap.groupBy({
      by: ['decision'], where: { batchId: id, kind: ImportEntityKind.CLIENT }, _count: true,
    });
    let openBlockers = issuesBySev.filter((g) => g.severity === 'BLOCK' && g.status === 'OPEN').reduce((a, g) => a + g._count, 0);
    const hasClosedBlockers = issuesBySev.some((g) => g.severity === 'BLOCK' && g.status !== 'OPEN');
    if (hasClosedBlockers || await db.importRow.count({ where: { batchId: id, editedAt: { not: null } } })) {
      const [rows, entities] = await Promise.all([
        db.importRow.findMany({ where: { batchId: id }, orderBy: { seq: 'asc' } }),
        db.importEntityMap.findMany({ where: { batchId: id } }),
      ]);
      openBlockers = Math.max(openBlockers, stagedBlockingFindings({ batch, rows, entities }).length);
    }
    const pendingEntities = entitiesByDecision.filter((g) => g.decision === 'PENDING').reduce((a, g) => a + g._count, 0);
    const priorCommittedImports = await db.importBatch.count({
      where: { status: ImportBatchStatus.COMMITTED, id: { not: id } },
    });
    const identicalCommittedImports = await db.importBatch.count({
      where: { status: ImportBatchStatus.COMMITTED, sourceHash: batch.sourceHash, id: { not: id } },
    });
    const stats = batch.stats as { incomplete?: IncompleteRow[] } | null;
    const settings = (batch.stats as ReviewSnapshot | null)?.master?.settings;
    return {
      batch: {
        id: batch.id, filename: batch.filename, status: batch.status, previewHash: batch.previewHash,
        preview: batch.preview, error: batch.error, createdAt: batch.createdAt,
      },
      rowsByKind: Object.fromEntries(rowsByKind.map((g) => [g.kind, g._count])),
      issuesBySeverity: issuesBySev,
      entitiesByDecision: Object.fromEntries(entitiesByDecision.map((g) => [g.decision, g._count])),
      /** to'ldirilmagani uchun import qilinmagan qatorlar — nomma-nom ko'rinadi */
      incompleteRows: stats?.incomplete ?? [],
      sourceSettings: {
        palletPriceDefault: settings?.palletBasePrice ?? null,
        taxPerM3: settings?.taxPerM3 ?? null,
        agentShare: settings?.agentKpiShare ?? null,
      },
      commitReady: openBlockers === 0 && pendingEntities === 0,
      previewFresh: !!batch.previewHash,
      openBlockers, pendingEntities, priorCommittedImports, identicalCommittedImports,
    };
  }
}

// ─────────────────────── yordamchi funksiyalar ───────────────────────

/** Butun faylni o'qiydi (parserlar mustaqil, shuning uchun bitta joyda birlashtiriladi). */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const wb = await WorkbookReader.fromBuffer(buffer);
  const master = parseMasterData(wb);
  const ships = parseShipments(wb);
  const pays = parseClientPayments(wb);
  const fpays = parseFactoryPayments(wb);
  const prets = parsePalletReturns(wb);
  const frets = parseFactoryPalletReturns(wb);
  return {
    master,
    sourceLayout: sourceLayout(wb),
    shipments: ships.rows,
    clientPayments: pays.rows,
    factoryPayments: fpays.rows,
    palletReturns: prets.rows,
    factoryPalletReturns: frets.rows,
    declared: parseDeclaredTotals(wb),
    incomplete: [
      ...ships.incomplete, ...pays.incomplete, ...fpays.incomplete,
      ...prets.incomplete, ...frets.incomplete,
    ],
  };
}

/**
 * Mijoz ayniyati qarorlari. Lug'atda topilgan nom darhol HAL QILINGAN (LINK/CREATE) — egasi
 * uni tasdiqlab o'tirmaydi. `suggestion` ichida agent ham olib yuriladi: commit uni shu
 * yerdan oladi, chunki commit vaqtida fayl allaqachon yo'q.
 */
function clientEntityRows(batchId: string, parsed: ParsedWorkbook, dict: Dictionary) {
  const agg = new Map<string, { n: number; rows: string[] }>();
  const add = (raw: string, tag: string) => {
    const t = raw.trim();
    if (!t) return;
    const e = agg.get(t) ?? { n: 0, rows: [] };
    e.n++;
    if (e.rows.length < 5) e.rows.push(tag);
    agg.set(t, e);
  };
  for (const r of parsed.shipments) add(r.clientRaw, `${r.origin.sheetName} r${r.origin.excelRow}`);
  for (const p of parsed.clientPayments) add(p.clientRaw, `${p.origin.sheetName} r${p.origin.excelRow}`);
  for (const p of parsed.palletReturns) if (!isWarehousePalletMovement(p)) add(p.clientRaw, `${p.origin.sheetName} r${p.origin.excelRow}`);

  return [...agg].map(([sourceName, e]) => {
    const r = dict.resolveClient(sourceName);
    return {
      batchId, kind: ImportEntityKind.CLIENT, sourceName,
      normalizedKey: (r.canonical ?? sourceName).toLowerCase(),
      occurrences: e.n, sampleRows: J(e.rows),
      decision: r.canonical ? ImportEntityDecision.CREATE : ImportEntityDecision.PENDING,
      targetId: null,
      newName: r.canonical,
      suggestion: J({ via: r.via, agentName: r.agentName, ...(r.suggestion ?? {}) }),
    };
  });
}

/** Справочник — Decimal'lar matnga (JSON'da `double` bo'lib tiyin suzib ketmasin). */
function serializeMaster(m: MasterData) {
  return {
    settings: {
      palletBasePrice: m.settings.palletBasePrice?.toFixed() ?? null,
      taxPerM3: m.settings.taxPerM3?.toFixed() ?? null,
      agentKpiShare: m.settings.agentKpiShare?.toFixed() ?? null,
    },
    clients: m.clients.length,
    clientEntries: m.clients,
    agents: m.agents,
    factories: m.factories,
    payTypes: m.payTypes,
  };
}

type StagedValidationState = { batch: ImportBatch; rows: ImportRow[]; entities: ImportEntityMap[] };

const findingKey = (f: Finding) => JSON.stringify([f.origin.sheetName, f.origin.excelRow, f.ruleId, f.field ?? null]);

/** Same resolved inputs as commit, including previous rows needed by signed pallet corrections. */
function stagedBlockingFindings({ batch, rows, entities }: StagedValidationState): Finding[] {
  const snapshot = (batch.stats as any)?.master;
  const master: MasterData = {
    settings: {
      palletBasePrice: new Prisma.Decimal(snapshot?.settings?.palletBasePrice ?? DEFAULT_PALLET_PRICE),
      taxPerM3: snapshot?.settings?.taxPerM3 == null ? null : new Prisma.Decimal(snapshot.settings.taxPerM3),
      agentKpiShare: snapshot?.settings?.agentKpiShare == null ? null : new Prisma.Decimal(snapshot.settings.agentKpiShare),
    },
    clients: [...(snapshot?.clientEntries ?? [])],
    agents: entities.filter((e) => e.kind === 'AGENT').map((e) => e.newName ?? e.sourceName),
    factories: entities.filter((e) => e.kind === 'FACTORY').map((e) => e.newName ?? e.sourceName),
    payTypes: snapshot?.payTypes ?? ['Касса', 'Перечисления'],
  };
  const dict = Dictionary.from(master);
  const shipments: ShipmentRow[] = [], clientPayments: ClientPaymentRow[] = [], factoryPayments: FactoryPaymentRow[] = [];
  const palletReturns: PalletReturnRow[] = [], factoryPalletReturns: FactoryPalletReturnRow[] = [];
  const named = <T extends { clientRaw: string; origin: RowOrigin }>(row: T, json: Record<string, unknown>): T => {
    const chosen = typeof json.resolvedClientName === 'string' ? json.resolvedClientName.trim() : '';
    if (!chosen || chosen === PLACEHOLDER_CLIENT) return row;
    const name = dict.resolveClient(chosen).canonical ?? chosen;
    if (!master.clients.some((c) => c.officialName === name)) {
      master.clients.push({ origin: row.origin, officialName: name, variants: [], legacyKey: '', agentName: '' });
    }
    return { ...row, clientRaw: name };
  };
  for (const row of rows) {
    const json = row.resolvedJson as Record<string, unknown>;
    switch (row.kind) {
      case ImportRowKind.SHIPMENT: shipments.push(named(jsonToShipment(json), json)); break;
      case ImportRowKind.CLIENT_PAYMENT: clientPayments.push(named(jsonToClientPayment(json), json)); break;
      case ImportRowKind.FACTORY_PAYMENT: factoryPayments.push(jsonToFactoryPayment(json)); break;
      case ImportRowKind.PALLET_RETURN: {
        const parsed = jsonToPalletReturn(json);
        palletReturns.push(isWarehousePalletMovement(parsed) ? parsed : named(parsed, json));
        break;
      }
      case ImportRowKind.FACTORY_PALLET_RETURN: factoryPalletReturns.push(jsonToFactoryPalletReturn(json)); break;
    }
  }
  return runRules({
    master, shipments, clientPayments, factoryPayments, palletReturns, factoryPalletReturns,
    dict: Dictionary.from(master), declared: { clientBalances: null, factories: [] }, incomplete: [],
    cfg: resolveRulesConfig(batch.rulesSnapshot as never),
  }).filter((f) => f.severity === 'BLOCK');
}

function validateRowPatch(current: Record<string, unknown>, patch: Record<string, unknown>) {
  const numbers = new Set(['cube', 'qty', 'palletQty']);
  const money = new Set(['costPrice', 'salePrice', 'palletPrice', 'transportCost', 'bank', 'cash', 'click', 'terminal', 'amount', 'unitCost']);
  for (const [field, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(current, field) || field === 'origin' || field.endsWith('Declared')) {
      throw new BadRequestException(`«${field}» maydonini tahrirlab bo‘lmaydi`);
    }
    if (numbers.has(field) || money.has(field)) {
      if (value === null || value === '') continue;
      if ((typeof value !== 'string' && typeof value !== 'number') || !/^-?\d+(\.\d+)?$/.test(String(value))) {
        throw new BadRequestException(`«${field}» son bo‘lishi kerak`);
      }
      continue;
    }
    if (typeof value !== 'string') throw new BadRequestException(`«${field}» matn bo‘lishi kerak`);
    if (['clientRaw', 'resolvedClientName', 'factoryRaw'].includes(field) && !value.trim()) {
      throw new BadRequestException(`«${field}» nomi bo‘sh bo‘lishi mumkin emas`);
    }
    if (field === 'date') {
      const date = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw new BadRequestException('Sana YYYY-MM-DD shaklida va haqiqiy kun bo‘lishi kerak');
      }
    }
  }
}

/** Egasining O'Z yig'indilari — Decimal'lar matnga, JSON'ga tushishi uchun. */
function serializeDeclared(d: ParsedWorkbook['declared']) {
  const s = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toString());
  return {
    clientBalances: d.clientBalances
      ? {
          ...d.clientBalances,
          sales: s(d.clientBalances.sales), paid: s(d.clientBalances.paid),
          goodsDebt: s(d.clientBalances.goodsDebt), palletsPaidMoney: s(d.clientBalances.palletsPaidMoney),
        }
      : null,
    factories: d.factories.map((f) => ({
      ...f, goods: s(f.goods), palletMoney: s(f.palletMoney),
      taken: s(f.taken), paid: s(f.paid), balance: s(f.balance),
    })),
  };
}
