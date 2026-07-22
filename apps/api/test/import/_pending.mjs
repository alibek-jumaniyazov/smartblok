/**
 * Decide every PENDING client name of a staged batch, the way the owner does in the UI.
 *
 * The commit gate refuses while any client name is undecided — that is deliberate: a name
 * the matcher scores in the SUGGEST band (0.86–0.95) is a real question, not noise. The
 * reference workbook has one («накд клент» vs the daftar's «Нахт клент», 0.87), so every
 * upload→commit test has to answer it before it can commit.
 *
 * Accepting the suggestion is the honest default here: it is the same choice the owner
 * makes, and it keeps the tests exercising the real gate instead of bypassing it.
 *
 * @param api    (method, path, body, isForm) => Promise<json> — the caller's fetch helper
 * @param id     import batch id
 * @returns      the decisions taken, for the test to log
 */
export async function decidePendingClients(api, id) {
  const entities = await api('GET', `/import/${id}/entities`);
  const pending = entities.filter((e) => e.decision === 'PENDING');
  const taken = [];
  for (const e of pending) {
    const name = e.suggestion?.targetName ?? e.newName ?? e.sourceName;
    await api('POST', `/import/${id}/entities/${e.id}/resolve`, { name });
    taken.push({ from: e.sourceName, to: name, confidence: e.suggestion?.confidence ?? null });
  }
  return taken;
}
