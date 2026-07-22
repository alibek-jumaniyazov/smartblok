import { norm } from './normalize';

/**
 * DAFTAR SCOPE — «Нахт клент» ikkita agentda ikki xil odam.
 *
 * In this template a client's identity is a BLOCK inside one agent's daftar, not a globally
 * unique name. Most names appear on exactly one sheet, so the name alone identifies the
 * client. But a generic bucket name — «Нахт клент» (naqd mijoz) — is kept by more than one
 * agent, and each agent's is a different person with a different balance.
 *
 * Folding those into one Client silently moved money between agents: on the reference
 * workbook Арслон's naqd client (8 000 soʼm in credit) landed in Сардор's daftar, so both
 * agents' «Ост» came out 8 000 off while the company total still looked perfect.
 *
 * So: a name kept by TWO OR MORE agents is qualified with the agent it belongs to
 * («Нахт клент (Арслон ога)»); a name kept by one agent is left exactly as the owner
 * wrote it. Nothing else in the file changes.
 */
export interface DaftarScope {
  /** true when this client name is kept by more than one agent */
  isShared(plainName: string): boolean;
  /** the client name to store, qualified by agent only when the name is shared */
  scopedName(plainName: string, agentRaw: string | null | undefined): string;
}

export interface DaftarBlock {
  clientRaw: string;
  agentName: string;
}

export function buildDaftarScope(blocks: DaftarBlock[]): DaftarScope {
  // client key → the agents whose daftar carries a block with that name
  const agentsFor = new Map<string, Map<string, string>>(); // clientKey → agentKey → agent display name
  for (const b of blocks) {
    const client = (b.clientRaw ?? '').trim();
    const agent = (b.agentName ?? '').trim();
    if (!client || !agent) continue;
    const key = norm(client).key;
    const inner = agentsFor.get(key) ?? new Map<string, string>();
    inner.set(norm(agent).key, agent);
    agentsFor.set(key, inner);
  }

  const isShared = (plainName: string): boolean => (agentsFor.get(norm(plainName ?? '').key)?.size ?? 0) > 1;

  const scopedName = (plainName: string, agentRaw: string | null | undefined): string => {
    const plain = (plainName ?? '').trim();
    if (!plain) return plain;
    const owners = agentsFor.get(norm(plain).key);
    if (!owners || owners.size <= 1) return plain;
    // Shared name: qualify with the daftar this row physically belongs to. With no agent
    // to go on we keep the bare name — one merged client is still better than inventing a
    // scope, and the ledger stays balanced either way.
    const agent = owners.get(norm((agentRaw ?? '').trim()).key);
    return agent ? `${plain} (${agent})` : plain;
  };

  return { isShared, scopedName };
}
