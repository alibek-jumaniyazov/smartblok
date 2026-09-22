/** Review edits must retain the workbook's official customer identity and agent. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportService, parseWorkbook } from '../../src/import/import.service';
import { clientPaymentToJson } from '../../src/import/serialize';

async function main() {
  const source = await parseWorkbook(readFileSync(join(__dirname, '../../../../docs/Smart blok.xlsb')));
  let chosen = '  Жасур Версал  '; // A known alternate spelling, deliberately with spaces.
  const payment = source.clientPayments[0];
  const db = {
    importBatch: { findUniqueOrThrow: async () => ({
      id: 'fixture', filename: 'Smart blok.xlsb', rulesSnapshot: null,
      stats: { master: { ...source.master, clientEntries: source.master.clients } },
    }) },
    importRow: { findMany: async () => [{
      kind: 'CLIENT_PAYMENT', sheetName: payment.origin.sheetName, excelRow: payment.origin.excelRow,
      resolvedJson: { ...clientPaymentToJson(payment), clientRaw: chosen, resolvedClientName: chosen },
    }] },
    importEntityMap: { findMany: async ({ where }: any) => {
      if (where.kind === 'AGENT') return source.master.agents.map((sourceName) => ({ sourceName }));
      if (where.kind === 'FACTORY') return source.master.factories.map((sourceName) => ({ sourceName }));
      // Even an old alias suggestion must not override the selected client's real agent.
      return [{ sourceName: chosen, newName: chosen, suggestion: { agentName: 'Жамол 22-22' } }];
    } },
  };
  const service = new ImportService(db as never, { review: async () => [] } as never);
  const build = () => (service as any).buildCommitInput('fixture');
  let input = await build();
  assert.equal(input.resolveClient(chosen, payment.origin), 'Жаср Версал');
  assert.equal(input.agentForClient('Жаср Версал'), 'Темур');
  chosen = 'jasr versal'; // Normalized Latin name also maps to the existing client.
  input = await build();
  assert.equal(input.resolveClient(chosen, payment.origin), 'Жаср Версал');
  assert.equal(input.agentForClient('Жаср Версал'), 'Темур');
  chosen = 'Yangi rasmiy mijoz'; // An explicit, genuinely new name remains possible.
  input = await build();
  assert.equal(input.resolveClient(chosen, payment.origin), chosen);
  console.log('Resolved customer identity regressions passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
