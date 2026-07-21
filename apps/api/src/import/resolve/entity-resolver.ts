import { matchName, Match } from './matcher';
import { norm } from './normalize';
import { ImportEntityDecision, ImportEntityKind } from '@prisma/client';

/** A distinct raw name seen across the sheets, with where it appeared. */
export interface RawName {
  name: string;
  sampleRows: string[];
  occurrences: number;
}

/** A candidate the raw name could resolve to (an existing DB entity, or a sheet client). */
export interface Canonical {
  id: string | null; // null ⇒ not in the DB yet (will be CREATEd from a sheet)
  name: string;
}

export interface EntityDecision {
  kind: ImportEntityKind;
  sourceName: string;
  normalizedKey: string;
  occurrences: number;
  sampleRows: string[];
  decision: ImportEntityDecision; // LINK | CREATE | PENDING | SKIP
  targetId: string | null; // set when LINK to an existing DB entity
  targetName: string | null; // the canonical name it resolves to
  suggestion: { targetName: string; confidence: number; reason: string } | null;
}

/**
 * Resolve distinct raw client names against a canonical set (existing DB clients
 * on re-import, or the per-client sheet titles on the first import).
 *  - exact / high-confidence variant  → LINK (silent; writes a ClientAlias later)
 *  - subset / mid-confidence           → PENDING + suggestion (owner confirms once)
 *  - nothing close                     → CREATE a new client
 * Genuinely-different clients (Нахт клиент vs накд клент) never auto-LINK.
 */
export function resolveClients(raws: RawName[], canonicals: Canonical[]): EntityDecision[] {
  const names = canonicals.map((c) => c.name);
  const byName = new Map(canonicals.map((c) => [c.name, c]));

  return raws.map((raw): EntityDecision => {
    const key = norm(raw.name).key;
    const exactCanon = byName.get(raw.name) ?? canonicals.find((c) => norm(c.name).key === key);
    const base = {
      kind: ImportEntityKind.CLIENT,
      sourceName: raw.name,
      normalizedKey: key,
      occurrences: raw.occurrences,
      sampleRows: raw.sampleRows,
    };

    if (exactCanon) {
      return { ...base, decision: ImportEntityDecision.LINK, targetId: exactCanon.id, targetName: exactCanon.name, suggestion: null };
    }

    const m: Match = matchName(raw.name, names);
    if (m.verdict === 'auto' && m.best) {
      const c = byName.get(m.best)!;
      return { ...base, decision: ImportEntityDecision.LINK, targetId: c.id, targetName: c.name, suggestion: null };
    }
    if ((m.verdict === 'suggest' || m.verdict === 'ask') && m.best) {
      return {
        ...base,
        decision: ImportEntityDecision.PENDING,
        targetId: null,
        targetName: null,
        suggestion: { targetName: m.best, confidence: m.score, reason: m.verdict === 'suggest' ? 'yaqin nom' : 'ehtimoliy nom' },
      };
    }
    // nothing close ⇒ a genuinely new client
    return { ...base, decision: ImportEntityDecision.CREATE, targetId: null, targetName: raw.name, suggestion: null };
  });
}

/** Strip the leading «<agentNo>-» from a client block header → canonical client name. */
export function clientNameFromBlockHeader(title: string): string {
  return title.trim().replace(/^\d+\s*-\s*/, '').trim();
}

// ── plates & products (auto-created; no balance) ──

/**
 * Canonicalize a truck plate so «80 S 385 SB» and «80 С 385 СВ» are one vehicle.
 * Re-exported from common/plate so the importer, the manual Moshinalar CRUD and the
 * ad-hoc truck on an order all canonicalize identically (they used to diverge, which
 * split one physical truck into two rows with two ledgers).
 */
export { normalizePlate } from '../../common/plate';

/** Canonicalize a block size: «600х300х200» (Cyrillic х) → «600x300x200» (Latin x). */
export function normalizeSize(size: string): string {
  return size.toLowerCase().replace(/[х×]/g, 'x').replace(/\s+/g, '').trim();
}
