/**
 * The execute route's handling of the run lifecycle, with the run store
 * replaced by a recorder: which transitions it asks for, with which owner
 * token, and what it answers when the lock is held by another run.
 */
const store = {
  reconcileAbandonedRuns: jest.fn(),
  create: jest.fn(),
  acquireLock: jest.fn(),
  transition: jest.fn(),
  withHeartbeat: jest.fn(),
  get: jest.fn(),
  list: jest.fn(),
  auditEntries: jest.fn(),
  requestCancel: jest.fn(),
};
const operation = {
  id: 'explorer.capabilities.refresh',
  version: '1',
  name: 'Refresh capability probes',
  risk: 'SAFE',
  availability: 'enabled',
  availabilityReason: null,
  cancellable: false,
  rollbackSupported: false,
  lock: 'explorer:explorer.capabilities.refresh',
  buildPreview: jest.fn(),
  execute: jest.fn(),
};

jest.mock('../config', () => ({ __esModule: true, default: { DATABASE: { ENABLED: true }, REDIS: { ENABLED: false } } }));
jest.mock('../api/backend-info', () => ({ __esModule: true, default: { getBackendInfo: () => ({}) } }));
jest.mock('../api/blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: () => 0 } }));
jest.mock('../api/capabilities', () => ({ __esModule: true, default: {} }));
jest.mock('../api/mempool', () => ({ __esModule: true, default: { getMempool: () => ({}) } }));
jest.mock('../api/admin-adapter/admin-adapter.snapshot', () => ({ buildExplorerSnapshot: jest.fn(), capabilityLabel: () => '', capabilityState: () => 'unknown' }));
jest.mock('../api/admin-adapter/admin-adapter.operations', () => ({
  findExplorerOperation: () => operation,
  listExplorerOperations: () => [operation],
}));
jest.mock('../api/admin-adapter/admin-adapter.replay', () => ({ createAdminReplayStore: () => ({ kind: 'memory', claim: async () => 'claimed' }) }));
jest.mock('../api/admin-adapter/admin-adapter.runs', () => {
  class AdminRunNotFound extends Error {}
  class AdminRunConflict extends Error {}
  return { __esModule: true, default: store, AdminRunNotFound, AdminRunConflict };
});

import adminAdapterRoutes from '../api/admin-adapter/admin-adapter.routes';
import { AdminRunConflict } from '../api/admin-adapter/admin-adapter.runs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

function mountExecute(): (request: any, response: any) => Promise<void> {
  const routes: Record<string, any> = {};
  const app = {
    use: jest.fn(),
    get: (path: string, handler: any) => { routes[`GET ${path}`] = handler; },
    post: (path: string, handler: any) => { routes[`POST ${path}`] = handler; },
  };
  adminAdapterRoutes.initRoutes(app as any);
  return routes['POST /internal/admin/v1/operations/:operationId/execute'];
}

function respond(): { response: any; done: Promise<{ status: number; body: any }> } {
  const response: any = { locals: {}, status: jest.fn(), json: jest.fn() };
  let status = 200;
  response.status.mockImplementation((code: number) => { status = code; return response; });
  const done = new Promise<{ status: number; body: any }>((resolve) => {
    response.json.mockImplementation((body: any) => { resolve({ status, body }); return response; });
  });
  return { response, done };
}

function run(state: string, extra: Record<string, unknown> = {}) {
  return { runId: RUN_ID, state, reason: null, idempotencyKey: null, ...extra };
}

describe('admin execute route lifecycle', () => {
  let execute: (request: any, response: any) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    execute = mountExecute();
    operation.buildPreview.mockResolvedValue({ available: true, target: 'explorer/test/capabilities' });
    store.reconcileAbandonedRuns.mockResolvedValue({ reconciled: 0, remaining: 0, verified: true });
    store.create.mockResolvedValue({ run: run('QUEUED'), replayed: false, ownerToken: TOKEN });
    store.transition.mockImplementation(async (_runId: string, state: string) => run(state));
    store.withHeartbeat.mockImplementation(async (_runId: string, _token: string, work: () => Promise<unknown>) => work());
  });

  it('records a lock conflict as a FAILED run and answers 409 naming it', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    store.acquireLock.mockRejectedValue(new AdminRunConflict('Another operation (other) is already working on this target.'));
    const { response, done } = respond();
    await execute({ params: { operationId: operation.id }, headers: {}, body: { input: {} } }, response);
    const answer = await done;
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('RUN_CONFLICT');
    expect(answer.body.message).toContain(RUN_ID);
    expect(store.transition).toHaveBeenCalledTimes(1);
    expect(store.transition).toHaveBeenCalledWith(RUN_ID, 'FAILED', expect.objectContaining({
      error: expect.objectContaining({ class: 'lock_conflict', retryable: true }),
    }), TOKEN);
    expect(operation.execute).not.toHaveBeenCalled();
  });

  it('runs the operation under a heartbeat and finishes it with the owner token', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    store.acquireLock.mockResolvedValue(undefined);
    operation.execute.mockResolvedValue({ summary: 'ok', result: {}, verification: { verified: true, evidence: ['x'] } });
    const { response, done } = respond();
    await execute({ params: { operationId: operation.id }, headers: {}, body: { input: {} } }, response);
    const answer = await done;
    expect(answer.status).toBe(200);
    expect(answer.body.run.state).toBe('SUCCEEDED');
    expect(store.withHeartbeat).toHaveBeenCalledWith(RUN_ID, TOKEN, expect.any(Function));
    const states = store.transition.mock.calls.map((call) => [call[1], call[3]]);
    expect(states).toEqual([['PRECHECK', TOKEN], ['RUNNING', TOKEN], ['VERIFYING', TOKEN], ['SUCCEEDED', TOKEN]]);
  });

  it('marks a failed operation FAILED with its error under the owner token', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    store.acquireLock.mockResolvedValue(undefined);
    operation.execute.mockRejectedValue(new Error('The blocksPrices task failed: isolated task failure'));
    const { response, done } = respond();
    await execute({ params: { operationId: operation.id }, headers: {}, body: { input: {} } }, response);
    const answer = await done;
    expect(answer.body.run.state).toBe('FAILED');
    expect(store.transition).toHaveBeenLastCalledWith(RUN_ID, 'FAILED', expect.objectContaining({
      error: expect.objectContaining({ class: 'operation_failed', message: expect.stringContaining('isolated task failure') }),
    }), TOKEN);
  });
});
