/** KPI broadcasts must refresh every affected agent without sharing record IDs. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, Subject, throwError } from 'rxjs';
import { RealtimeInterceptor } from '../src/common/realtime.interceptor';
import { RealtimeEntity, RealtimeService } from '../src/common/realtime.service';
import { ENTITY_KEYS } from '../../web/src/lib/realtime';

type Emission = { rooms: string[]; topic: string; payload: any };
const emissions: Emission[] = [];
function target(rooms: string[]) {
  return {
    to: (room: string) => target([...rooms, room]),
    emit: (topic: string, payload: unknown) => { emissions.push({ rooms, topic, payload }); },
  };
}
const service = new RealtimeService({ server: { to: (room: string) => target([room]) } } as any);
const interceptor = new RealtimeInterceptor(service);
let checks = 0;
function eq(actual: unknown, expected: unknown, note: string) {
  assert.deepEqual(actual, expected, note); checks++;
}
function context(controller: string, handler: string, method = 'POST') {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, params: { id: 'private-record' } }) }),
    getClass: () => ({ name: controller }),
    getHandler: () => ({ name: handler }),
  } as unknown as ExecutionContext;
}

async function main() {
  for (const entity of ['order', 'payment', 'client', 'agent', 'agent-kpi', 'import'] as RealtimeEntity[]) {
    emissions.length = 0;
    service.emit({ entity, action: 'updated', id: 'private-record' });
    eq(emissions[0].rooms, ['role:ADMIN', 'role:ACCOUNTANT'], `${entity}: existing accounting rooms preserved`);
    eq(emissions[0].payload.id, 'private-record', `${entity}: accounting event preserves id`);
    eq(emissions[1].rooms, ['role:AGENT'], `${entity}: all agents receive a refresh`);
    eq(emissions[1].payload, {
      entity: 'agent-kpi', action: 'refresh', id: null, at: emissions[0].payload.at,
    }, `${entity}: agent refresh has no private record, agent id, or action`);
    for (const key of ['agents', 'agent-kpi']) {
      eq(ENTITY_KEYS[entity].includes(key), true, `${entity}: ${key} caches invalidated`);
    }
  }

  emissions.length = 0;
  service.emit({ entity: 'payment', action: 'post:create', id: 'payment-id', agentId: 'assigned-agent', cashier: true });
  eq(emissions[0].rooms, ['role:ADMIN', 'role:ACCOUNTANT', 'role:CASHIER'], 'cashier routing preserved');
  eq(emissions[1].rooms, ['agent:assigned-agent'], 'private event still goes to its assigned agent only');
  eq(emissions[1].payload.id, 'payment-id', 'assigned agent keeps existing private event');
  eq(emissions[2].rooms, ['role:AGENT'], 'anonymous KPI refresh also reaches other affected agents');
  emissions.length = 0;
  service.emit({ entity: 'kassa', action: 'post:create', cashier: true });
  eq(emissions.length, 1, 'unrelated cash mutations do not broadcast extra KPI events');

  for (const handler of ['upload', 'preview', 'patchRow', 'resolveIssue', 'resolveEntity']) {
    emissions.length = 0;
    await lastValueFrom(interceptor.intercept(context('ImportController', handler), { handle: () => of({ id: 'batch' }) }));
    eq(emissions.length, 0, `import ${handler} does not refresh financial data`);
  }
  for (const handler of ['commit', 'rollback']) {
    emissions.length = 0;
    await lastValueFrom(interceptor.intercept(context('ImportController', handler), { handle: () => of({ id: 'batch' }) }));
    eq(emissions[0].payload.entity, 'import', `import ${handler} invalidates imported data`);
    eq(emissions[0].rooms.includes('role:CASHIER'), true, `import ${handler} refreshes cashbooks`);
    eq(emissions[1].payload.id, null, `import ${handler} does not expose batch ID to agents`);
  }
  for (const handler of ['updateKpiSettings', 'create', 'update', 'remove']) {
    emissions.length = 0;
    await lastValueFrom(interceptor.intercept(context('AgentsController', handler, 'PUT'), { handle: () => of({ id: 'agent' }) }));
    eq(emissions[0].payload.entity, 'agent', `agent ${handler} invalidates agent reports`);
    eq(emissions[1].payload.entity, 'agent-kpi', `agent ${handler} refreshes all agent sessions`);
  }
  emissions.length = 0;
  await lastValueFrom(interceptor.intercept(context('AgentsController', 'report', 'GET'), { handle: () => of({}) }));
  eq(emissions.length, 0, 'read requests never emit changes');

  const pending = new Subject<unknown>();
  const result = lastValueFrom(interceptor.intercept(context('OrdersController', 'create'), { handle: () => pending }));
  eq(emissions.length, 0, 'pending mutation does not announce uncommitted data');
  pending.next({ id: 'committed-order' }); pending.complete();
  await result;
  eq(emissions[0].payload.id, 'committed-order', 'resolved mutation announces its committed result');
  emissions.length = 0;
  await assert.rejects(lastValueFrom(interceptor.intercept(context('ImportController', 'commit'), {
    handle: () => throwError(() => new Error('transaction rolled back')),
  })), /transaction rolled back/); checks++;
  eq(emissions.length, 0, 'failed/rolled back mutation never emits');
  eq(ENTITY_KEYS.import.includes('cashboxes'), true, 'import refreshes cashbox picker balances');
  eq(ENTITY_KEYS.import.includes('clients'), true, 'import refreshes client balances');
  eq(ENTITY_KEYS.import.includes('orders'), true, 'import refreshes order lists and details');
  for (const [controller, entity] of [['SettingsController', 'setting'], ['FactoriesController', 'factory'], ['PalletsController', 'pallet'], ['ExpensesController', 'expense']]) {
    emissions.length = 0;
    await lastValueFrom(interceptor.intercept(context(controller, 'update', 'PUT'), { handle: () => of({ id: 'private-record' }) }));
    eq(emissions[0].payload.entity, entity, `${entity}: admin refresh`);
    const refresh = emissions.find((e) => e.rooms.includes('role:AGENT'));
    eq(refresh?.payload.entity, 'balance', `${entity}: agent balance refresh`);
    eq(refresh?.payload.id, null, `${entity}: no other party ID disclosed`);
    eq(ENTITY_KEYS[entity].includes('debts'), true, `${entity}: dual debt refreshed`);
  }
  for (const entity of ['order', 'payment', 'bonus', 'pallet', 'expense', 'factory', 'setting', 'import']) {
    eq(ENTITY_KEYS[entity].includes('factory-report'), true, `${entity}: factory report current valuation refreshed`);
  }
  console.log(`Realtime KPI regression: ${checks} checks passed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
