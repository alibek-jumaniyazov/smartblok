import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AGENT_KPI_SETTING_KEY, parseAgentKpiSettings, type AgentKpiSettings } from '../../agents/agent-kpi.calculator';

type Tx = Prisma.TransactionClient;
interface SettingSnapshot {
  before: { value: Prisma.JsonValue; updatedBy: string | null; updatedAt: string } | null;
  appliedAt: string;
  appliedBatchId?: string;
}

const ownerBatch = (value: Prisma.JsonValue): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value._importBatchId === 'string' ? value._importBatchId : null;
};

/** Part of the import transaction: preview rolls back settings along with its orders. */
export async function applyImportedKpiSettings(
  tx: Tx, batchId: string, input: AgentKpiSettings | undefined, updatedBy: string | null,
): Promise<AgentKpiSettings | undefined> {
  if (!input) return undefined;
  const value = parseAgentKpiSettings(input);
  await applySetting(tx, batchId, AGENT_KPI_SETTING_KEY, 'kpiSettingsImport', { ...value }, updatedBy);
  return value;
}

/** Current outstanding-pallet valuation; historical paid charges keep their own price. */
export async function applyImportedPalletPrice(
  tx: Tx, batchId: string, input: string | undefined, updatedBy: string | null,
): Promise<string | undefined> {
  if (input === undefined) return undefined;
  const price = new Prisma.Decimal(input);
  if (!price.isFinite() || price.lte(0) || price.decimalPlaces() > 2 || price.gt('999999999999')) {
    throw new BadRequestException('Poddon narxi musbat son bo‘lishi kerak (ko‘pi bilan 2 kasr xonasi)');
  }
  const amount = price.toFixed();
  await applySetting(tx, batchId, 'palletPriceDefault', 'palletPriceImport', { amount }, updatedBy);
  return amount;
}

async function applySetting(
  tx: Tx, batchId: string, key: string, statsKey: string,
  value: Record<string, string>, updatedBy: string | null,
): Promise<void> {
  // The advisory lock also covers the first import, when no settings row exists yet.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  const before = await tx.appSetting.findUnique({ where: { key } });
  const applied = await tx.appSetting.upsert({
    where: { key },
    // Provenance is private storage metadata; the public settings parser returns
    // only tax/share. A manual settings write clears this marker, even when its
    // value and millisecond timestamp happen to match the imported setting.
    create: { key, value: { ...value, _importBatchId: batchId }, updatedBy },
    update: { value: { ...value, _importBatchId: batchId }, updatedBy },
  });
  const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  const stats = (batch.stats ?? {}) as Record<string, Prisma.JsonValue>;
  await tx.importBatch.update({
    where: { id: batchId },
    data: { stats: {
      ...stats,
      [statsKey]: {
        before: before ? { value: before.value, updatedBy: before.updatedBy, updatedAt: before.updatedAt.toISOString() } : null,
        appliedAt: applied.updatedAt.toISOString(),
        appliedBatchId: batchId,
      },
    } as Prisma.InputJsonObject },
  });
}

/** Never overwrite a setting changed after this batch was committed. */
export async function restoreImportedKpiSettings(tx: Tx, stats: Prisma.JsonValue | null): Promise<void> {
  return restoreSetting(tx, stats, AGENT_KPI_SETTING_KEY, 'kpiSettingsImport');
}

export async function restoreImportedPalletPrice(tx: Tx, stats: Prisma.JsonValue | null): Promise<void> {
  return restoreSetting(tx, stats, 'palletPriceDefault', 'palletPriceImport');
}

async function restoreSetting(tx: Tx, stats: Prisma.JsonValue | null, key: string, statsKey: string): Promise<void> {
  const snapshot = (stats as Record<string, SettingSnapshot> | null)?.[statsKey];
  if (!snapshot) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  const current = await tx.appSetting.findUnique({ where: { key } });
  if (!current || current.updatedAt.toISOString() !== snapshot.appliedAt) return;
  if (snapshot.appliedBatchId && ownerBatch(current.value) !== snapshot.appliedBatchId) return;

  let before = snapshot.before;
  const visited = new Set<string>(snapshot.appliedBatchId ? [snapshot.appliedBatchId] : []);
  // Rolling back A while newer B is active must leave B in place. If B is later
  // rolled back, skip A's obsolete snapshot instead of resurrecting its settings.
  for (;;) {
    const id = before ? ownerBatch(before.value) : null;
    if (!id) break;
    if (visited.has(id)) return; // malformed/cyclic metadata: leave the live setting intact
    visited.add(id);
    const prior = await tx.importBatch.findUnique({ where: { id }, select: { status: true, stats: true } });
    if (!prior || prior.status !== 'ROLLED_BACK') break;
    const previous = (prior.stats as Record<string, SettingSnapshot> | null)?.[statsKey];
    if (!previous || previous.appliedBatchId !== id || previous.appliedAt !== before!.updatedAt) return;
    before = previous.before;
  }
  if (before) {
    await tx.appSetting.update({
      where: { key },
      data: {
        value: before.value === null ? Prisma.JsonNull : before.value,
        updatedBy: before.updatedBy,
        updatedAt: new Date(before.updatedAt),
      },
    });
  } else {
    await tx.appSetting.delete({ where: { key } });
  }
}
