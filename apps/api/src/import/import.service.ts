import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ImportBatchStatus, ImportEntityDecision, ImportEntityKind, ImportRowKind, ImportRowStatus, Prisma,
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
import { runRules } from './rules/validate.service';
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
      throw new BadRequestException('Fayl xlsx (ZIP) formatida emas.');
    }

    let parsed: ParsedWorkbook;
    try {
      parsed = await parseWorkbook(buffer);
    } catch (e) {
      // Shablon mos kelmasa import BOSHLANMAYDI. Bu ataylab qattiq: eski shablonning
      // «Товар» varag'i ham «Агент»/«Клиент» sarlavhalariga ega, ya'ni noto'g'ri fayl
      // JIMGINA o'qilib, butunlay boshqa ustunlardan pul yasagan bo'lardi.
      if (e instanceof TemplateMismatchError) {
        throw new BadRequestException(
          `Fayl kutilgan shablonga mos emas: ${e.message}. «Smart blok.xlsx» ning joriy shaklini yuklang.`,
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
        await stage(ImportRowKind.PALLET_RETURN, p.origin, palletReturnToJson(p), canon(p.clientRaw),
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
    return this.prisma.importIssue.findMany({ where: { batchId: id }, orderBy: [{ severity: 'asc' }, { ruleId: 'asc' }] });
  }
  async listEntities(id: string) {
    return this.prisma.importEntityMap.findMany({
      where: { batchId: id, kind: ImportEntityKind.CLIENT }, orderBy: { occurrences: 'desc' },
    });
  }

  // ─────────────────────────── tahrir ───────────────────────────

  async patchRow(id: string, rowId: string, patch: Record<string, unknown>) {
    const row = await this.prisma.importRow.findFirst({ where: { id: rowId, batchId: id } });
    if (!row) throw new NotFoundException('Qator topilmadi');
    const resolved = { ...(row.resolvedJson as object), ...patch };
    await this.invalidatePreview(id);
    return this.prisma.importRow.update({
      where: { id: rowId },
      data: { resolvedJson: J(resolved), status: ImportRowStatus.READY, editedAt: new Date() },
    });
  }

  async resolveIssue(
    id: string, issueId: string,
    resolution: { status: 'ACCEPTED' | 'EDITED' | 'IGNORED'; value?: unknown },
    user: RequestUser,
  ) {
    const issue = await this.prisma.importIssue.findFirstOrThrow({ where: { id: issueId, batchId: id } });
    await this.invalidatePreview(id);

    // Taklifni qabul qilish/tahrirlash qatorning O'ZINI tuzatadi — shunchaki savolni yopmaydi.
    if ((resolution.status === 'ACCEPTED' || resolution.status === 'EDITED') && issue.rowId && issue.field) {
      const value = resolution.value !== undefined ? resolution.value : issue.suggestedValue;
      if (value !== null && value !== undefined) {
        const row = await this.prisma.importRow.findUnique({ where: { id: issue.rowId } });
        if (row) {
          const patch: Record<string, unknown> = { [issue.field]: value };
          // Commit qatorni `resolvedClientName` bo'yicha mijozga yo'naltiradi, shuning uchun
          // mijozni nomlash IKKALA maydonni ham yangilashi shart — aks holda tuzatish
          // ekranda ko'rinadi-yu, daftarga yetib bormaydi.
          if (issue.field === 'clientRaw' && typeof value === 'string') patch.resolvedClientName = value;
          await this.prisma.importRow.update({
            where: { id: issue.rowId },
            data: { resolvedJson: J({ ...(row.resolvedJson as object), ...patch }), status: ImportRowStatus.READY, editedAt: new Date() },
          });
        }
      }
    }

    return this.prisma.importIssue.update({
      where: { id: issueId },
      data: {
        status: resolution.status,
        resolvedValue: resolution.value === undefined ? Prisma.JsonNull : J(resolution.value),
        resolvedById: user.userId ?? null, resolvedAt: new Date(),
      },
    });
  }

  /**
   * Lug'atda topilmagan nomni egasi hal qiladi: kanonik nomni tanlaydi/yozadi. Tanlangan nom
   * SHU nomni ishlatgan har bir staged qatorga bosiladi, so'ng qaror «hal qilingan» bo'ladi.
   */
  async resolveEntity(id: string, mapId: string, name: string) {
    const map = await this.prisma.importEntityMap.findFirst({ where: { id: mapId, batchId: id } });
    if (!map) throw new NotFoundException('Mijoz nomi topilmadi');
    const canonical = name.trim();
    if (!canonical) throw new BadRequestException('Mijoz nomi boʼsh boʼlishi mumkin emas');
    await this.invalidatePreview(id);

    const rows = await this.prisma.importRow.findMany({ where: { batchId: id } });
    for (const row of rows) {
      const rj = row.resolvedJson as Record<string, unknown>;
      if (String(rj.clientRaw ?? '') !== map.sourceName) continue;
      await this.prisma.importRow.update({
        where: { id: row.id },
        data: { resolvedJson: J({ ...rj, resolvedClientName: canonical }), status: ImportRowStatus.READY, editedAt: new Date() },
      });
    }

    return this.prisma.importEntityMap.update({
      where: { id: mapId },
      data: { decision: ImportEntityDecision.CREATE, newName: canonical },
    });
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
    const previewHash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    await this.prisma.importBatch.update({
      where: { id },
      data: { preview: J(result), previewHash, previewAt: new Date(), status: ImportBatchStatus.READY },
    });
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
    const unresolved = await this.prisma.importEntityMap.count({ where: { batchId: id, decision: ImportEntityDecision.PENDING } });
    if (unresolved > 0) throw new BadRequestException(`${unresolved} ta mijoz nomi aniqlanmagan`);

    const gate = await this.prisma.importBatch.updateMany({
      where: { id, status: { in: [ImportBatchStatus.DRAFT, ImportBatchStatus.READY, ImportBatchStatus.FAILED] } },
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

    const agentNames = new Map(agents.map((a) => [a.sourceName.toLowerCase(), a.newName ?? a.sourceName]));
    const factoryNames = new Map(factories.map((f) => [f.sourceName.toLowerCase(), f.newName ?? f.sourceName]));
    const agentOfClient = new Map<string, string>();
    for (const c of clients) {
      const agent = (c.suggestion as { agentName?: string } | null)?.agentName;
      if (agent) agentOfClient.set(c.newName ?? c.sourceName, agent);
    }

    return {
      batchId: id,
      filename: batch.filename,
      shipments, clientPayments, factoryPayments, palletReturns, factoryPalletReturns,
      createdById: createdById ?? null,
      resolveClient: (raw: string, o: RowOrigin) =>
        nameByOrigin.get(`${o.sheetName}|${o.excelRow}`) ?? (raw.trim() || PLACEHOLDER_CLIENT),
      agentForClient: (clientName: string) => agentOfClient.get(clientName) ?? null,
      resolveFactory: (raw: string) => factoryNames.get(raw.trim().toLowerCase()) ?? raw.trim(),
      resolveAgent: (raw: string) => agentNames.get(raw.trim().toLowerCase()) ?? (raw.trim() || null),
      palletBasePrice: new Prisma.Decimal(
        master?.settings?.palletBasePrice ? String(master.settings.palletBasePrice) : DEFAULT_PALLET_PRICE,
      ),
    };
  }

  private async invalidatePreview(id: string) {
    await this.prisma.importBatch.updateMany({
      where: { id, status: { in: [ImportBatchStatus.READY, ImportBatchStatus.FAILED] } },
      data: { status: ImportBatchStatus.DRAFT, previewHash: null },
    });
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
    const openBlockers = issuesBySev.filter((g) => g.severity === 'BLOCK' && g.status === 'OPEN').reduce((a, g) => a + g._count, 0);
    const pendingEntities = entitiesByDecision.filter((g) => g.decision === 'PENDING').reduce((a, g) => a + g._count, 0);
    const priorCommittedImports = await db.importBatch.count({
      where: { status: ImportBatchStatus.COMMITTED, id: { not: id } },
    });
    const stats = batch.stats as { incomplete?: IncompleteRow[] } | null;
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
      commitReady: openBlockers === 0 && pendingEntities === 0,
      previewFresh: !!batch.previewHash,
      openBlockers, pendingEntities, priorCommittedImports,
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
  for (const p of parsed.palletReturns) add(p.clientRaw, `${p.origin.sheetName} r${p.origin.excelRow}`);

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
      palletBasePrice: m.settings.palletBasePrice?.toString() ?? null,
      taxPerM3: m.settings.taxPerM3?.toString() ?? null,
      agentKpiShare: m.settings.agentKpiShare?.toString() ?? null,
    },
    clients: m.clients.length,
    agents: m.agents,
    factories: m.factories,
  };
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
