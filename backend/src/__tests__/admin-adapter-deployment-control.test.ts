import { createHmac } from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';

jest.mock('../config', () => ({ DATABASE: { ENABLED: true }, MEMPOOL: { NETWORK: 'signet' }, CORE_RPC: { HOST: '127.0.0.1', PORT: 38332 } }));
jest.mock('../database', () => ({ query: jest.fn() }));
jest.mock('../api/backend-info', () => ({ getBackendInfo: () => ({}) }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({}));
jest.mock('../api/bitcoin/address-index', () => ({ $probeAddressIndex: jest.fn() }));
jest.mock('../api/blocks', () => ({ getCurrentBlockHeight: () => 1 }));
jest.mock('../api/capabilities', () => ({ $report: jest.fn() }));
jest.mock('../indexer', () => ({ reindex: jest.fn() }));
jest.mock('../tasks/pools-updater', () => ({}));
jest.mock('../tasks/price-updater', () => ({}));
jest.mock('../api/redis-cache', () => ({}));
jest.mock('../api/admin-adapter/admin-adapter.identity', () => ({ explorerEnvironment: () => 'test', releaseShaOrNull: () => null }));
const transitions: Array<{ runId: string; state: string; patch: unknown }> = [];
jest.mock('../api/admin-adapter/admin-adapter.runs', () => ({ __esModule: true, default: { transition: jest.fn(async (runId: string, state: string, patch: unknown) => { transitions.push({ runId, state, patch }); return {}; }) } }));

import {
  DEPLOYMENT_CONTROL_REASON,
  deploymentControlAvailability,
  explorerOperationDefinitions,
  findExplorerOperationDefinition,
} from '../api/admin-adapter/admin-adapter.catalog';
import {
  DEPLOYMENT_SIGNATURE_HEADER,
  DeploymentControlClient,
  DeploymentTransport,
  deploymentControlConfig,
  parseCapabilities,
  rollbackTargetFromJournal,
  signDeploymentRequest,
  verifyDeploymentSignature,
} from '../api/admin-adapter/deployment-control.client';
import { findExplorerOperation, useDeploymentControlClient } from '../api/admin-adapter/admin-adapter.operations';

const KEY = 'deployment-control-shared-key-with-enough-length';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const TARGET = 'explorer/test-host';

/** A loopback adapter that speaks the contract, verifies signatures and can be told how to behave. */
class FakeAdapterServer {
  public readonly server: http.Server;
  public requests: Array<{ method: string; path: string; body: unknown }> = [];
  public journal = [{ release: OLD, verifiedAt: '2026-09-10T00:00:00.000Z', operation: 'cutover' }, { release: NEW, verifiedAt: '2026-09-15T00:00:00.000Z', operation: 'cutover' }];
  public current: string | null = NEW;
  public supports = { restart: true, rollback: true };
  public jobs = new Map<string, Record<string, unknown>>();
  public idempotency = new Map<string, string>();
  public pollsUntilDone = 1;
  public hang = false;
  private ids = 0;

  constructor() {
    this.server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const path = request.url ?? '/';
        if (!verifyDeploymentSignature(Buffer.from(KEY), request.method ?? 'GET', path, body, request.headers[DEPLOYMENT_SIGNATURE_HEADER] as string | undefined)) {
          response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'bad signature' }));
          return;
        }
        if (this.hang) { return; }
        const parsed = body ? JSON.parse(body) : null;
        this.requests.push({ method: request.method ?? 'GET', path, body: parsed });
        const answer = this.route(request.method ?? 'GET', path, parsed);
        response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
      });
    });
  }

  private route(method: string, path: string, body: any): { status: number; body: unknown } {
    if (method === 'GET' && path === '/capabilities') {
      return { status: 200, body: { application: 'explorer', target: TARGET, currentRelease: this.current, journal: this.journal, supports: this.supports, reasons: { restart: null, rollback: null }, adapterVersion: 'fake/1', observedAt: new Date().toISOString() } };
    }
    if (method === 'POST' && (path === '/restart' || path === '/rollback')) {
      if (body.target !== TARGET) { return { status: 400, body: { error: 'wrong target' } }; }
      const replay = this.idempotency.get(body.idempotencyKey);
      if (replay) { return { status: 202, body: { jobId: replay, state: this.jobs.get(replay)!.state, replayed: true } }; }
      if (path === '/rollback' && body.release !== OLD) { return { status: 409, body: { error: 'not the journal target' } }; }
      const jobId = `job-${++this.ids}`;
      const after = path === '/rollback' ? OLD : this.current;
      this.jobs.set(jobId, { jobId, operation: path.slice(1), state: 'running', target: TARGET, releaseBefore: this.current, releaseAfter: null, requestedRelease: path === '/rollback' ? OLD : null, startedAt: new Date().toISOString(), finishedAt: null, error: null, evidence: ['gate: ok'], polls: 0, after });
      this.idempotency.set(body.idempotencyKey, jobId);
      return { status: 202, body: { jobId, state: 'running', replayed: false } };
    }
    const match = /^\/jobs\/(.+)$/.exec(path);
    if (method === 'GET' && match) {
      const job = this.jobs.get(match[1]);
      if (!job) { return { status: 404, body: { error: 'no such job' } }; }
      job.polls = (job.polls as number) + 1;
      if ((job.polls as number) >= this.pollsUntilDone && job.state === 'running') {
        job.state = 'succeeded';
        job.releaseAfter = job.after;
        job.finishedAt = new Date().toISOString();
        job.evidence = ['gate: ok', 'verify_live: gateway is answering', 'cutover complete'];
      }
      const { polls, after, ...view } = job;
      void polls; void after;
      return { status: 200, body: view };
    }
    return { status: 404, body: { error: 'no such route' } };
  }

  public async start(): Promise<string> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  public async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

function client(endpoint: string, transport?: DeploymentTransport): DeploymentControlClient {
  return new DeploymentControlClient(() => ({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: endpoint, EXPLORER_DEPLOYMENT_CONTROL_KEY: KEY }), transport);
}

describe('deployment control configuration and readiness', () => {
  it('is unconfigured without the endpoint and key, and a flag alone enables nothing', () => {
    expect(deploymentControlConfig({})).toBeNull();
    expect(deploymentControlConfig({ EXPLORER_DEPLOYMENT_CONTROL: 'enabled' })).toBeNull();
    expect(() => deploymentControlConfig({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: 'http://127.0.0.1:8790' })).toThrow(/must both be set/);
    expect(() => deploymentControlConfig({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: 'http://127.0.0.1:8790', EXPLORER_DEPLOYMENT_CONTROL_KEY: 'short' })).toThrow(/at least 32/);
    expect(() => deploymentControlConfig({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: 'http://10.0.0.5:8790', EXPLORER_DEPLOYMENT_CONTROL_KEY: KEY })).toThrow(/loopback/);
    expect(() => deploymentControlConfig({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: 'https://127.0.0.1:8790', EXPLORER_DEPLOYMENT_CONTROL_KEY: KEY })).toThrow(/loopback/);
    expect(deploymentControlConfig({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: 'http://127.0.0.1:8790', EXPLORER_DEPLOYMENT_CONTROL_KEY: KEY })?.endpoint).toEqual({ kind: 'http', host: '127.0.0.1', port: 8790 });
    expect(deploymentControlConfig({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: '/run/universe/deploy.sock', EXPLORER_DEPLOYMENT_CONTROL_KEY: KEY })?.endpoint).toEqual({ kind: 'socket', path: '/run/universe/deploy.sock' });

    for (const id of ['explorer.service.restart', 'explorer.release.rollback']) {
      const flagged = findExplorerOperationDefinition(id, { EXPLORER_DEPLOYMENT_CONTROL: 'enabled' });
      expect(flagged.availability).toBe('not_configured');
      expect(flagged.availabilityReason).toBe(DEPLOYMENT_CONTROL_REASON);
      const configured = findExplorerOperationDefinition(id, { EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: 'http://127.0.0.1:8790', EXPLORER_DEPLOYMENT_CONTROL_KEY: KEY });
      expect(configured.availability).toBe('unavailable');
      expect(configured.availabilityReason).toMatch(/has not answered its capability route/);
    }
  });

  it('enables an operation only from a capability document that supports it', () => {
    const ready = { state: 'ready' as const, reason: null, probedAt: new Date().toISOString(), capabilities: parseCapabilities({ application: 'explorer', target: TARGET, currentRelease: NEW, journal: [{ release: NEW, verifiedAt: '2026-09-15T00:00:00.000Z', operation: 'cutover' }], supports: { restart: true, rollback: true } }) };
    expect(deploymentControlAvailability('explorer.service.restart', ready)).toEqual({ availability: 'enabled', availabilityReason: null });
    expect(deploymentControlAvailability('explorer.release.rollback', ready).availability).toBe('unavailable');
    expect(deploymentControlAvailability('explorer.release.rollback', ready).availabilityReason).toMatch(/no previous verified release/);
    const unsupported = { ...ready, capabilities: { ...ready.capabilities, supports: { restart: false, rollback: false }, reasons: { restart: 'no current release', rollback: null } } };
    expect(deploymentControlAvailability('explorer.service.restart', unsupported)).toEqual({ availability: 'unavailable', availabilityReason: 'no current release' });
    const unreachable = { state: 'unreachable' as const, reason: 'refused', capabilities: null, probedAt: new Date().toISOString() };
    expect(deploymentControlAvailability('explorer.service.restart', unreachable)).toEqual({ availability: 'unavailable', availabilityReason: 'refused' });
    expect(explorerOperationDefinitions({}, ready).find(op => op.id === 'explorer.service.restart')?.availability).toBe('enabled');
  });

  it('derives the rollback target from the journal and refuses malformed capability documents', () => {
    const caps = parseCapabilities({ application: 'explorer', target: TARGET, currentRelease: NEW, journal: [{ release: OLD, verifiedAt: '2026-09-10T00:00:00.000Z', operation: 'cutover' }, { release: NEW, verifiedAt: '2026-09-15T00:00:00.000Z', operation: 'cutover' }], supports: { restart: true, rollback: true } });
    expect(rollbackTargetFromJournal(caps)?.release).toBe(OLD);
    expect(rollbackTargetFromJournal({ ...caps, journal: [caps.journal[1]] })).toBeNull();
    expect(() => parseCapabilities({ application: 'other', target: TARGET, journal: [], supports: {} })).toThrow(/does not understand/);
    expect(() => parseCapabilities({ application: 'explorer', target: TARGET, currentRelease: 'not a sha', journal: [], supports: {} })).toThrow(/not a commit sha/);
    expect(() => parseCapabilities({ application: 'explorer', target: TARGET, currentRelease: null, journal: [{ release: 'x' }], supports: {} })).toThrow(/journal is malformed/);
  });

  it('signs method, path and body with the shared key', () => {
    const signature = signDeploymentRequest(Buffer.from(KEY), 'POST', '/restart', '{"a":1}');
    expect(signature).toBe('sha256=' + createHmac('sha256', KEY).update('POST\n/restart\n{"a":1}').digest('hex'));
    expect(verifyDeploymentSignature(Buffer.from(KEY), 'POST', '/restart', '{"a":1}', signature)).toBe(true);
    expect(verifyDeploymentSignature(Buffer.from(KEY), 'POST', '/restart', '{"a":2}', signature)).toBe(false);
    expect(verifyDeploymentSignature(Buffer.from(KEY), 'POST', '/rollback', '{"a":1}', signature)).toBe(false);
    expect(verifyDeploymentSignature(Buffer.from(KEY), 'POST', '/restart', '{"a":1}', undefined)).toBe(false);
  });
});

describe('deployment control against a fake adapter server', () => {
  let adapter: FakeAdapterServer;
  let endpoint: string;
  const context = (runId: string, confirmation: string, idempotencyKey: string | null = null) => ({ runId, correlationId: 'corr', actor: 'test', reason: null, idempotencyKey, input: { confirmation } });

  beforeEach(async () => {
    adapter = new FakeAdapterServer();
    endpoint = await adapter.start();
    transitions.length = 0;
    useDeploymentControlClient(client(endpoint));
  });
  afterEach(async () => {
    useDeploymentControlClient(null);
    await adapter.stop();
  });

  it('previews from the adapter\'s capability document', async () => {
    const restart = await findExplorerOperation('explorer.service.restart').buildPreview({});
    expect(restart.available).toBe(true);
    expect(restart.preconditions[0]).toMatchObject({ id: 'deployment-control', satisfied: true });
    expect(restart.preconditions[0].detail).toContain(TARGET);
    expect(restart.effects[0]).toContain(NEW.slice(0, 12));
    const rollback = await findExplorerOperation('explorer.release.rollback').buildPreview({});
    expect(rollback.available).toBe(true);
    expect(rollback.effects[0]).toContain(`from release ${NEW.slice(0, 12)} to ${OLD.slice(0, 12)}`);
    expect(adapter.requests.filter(r => r.path === '/capabilities')).toHaveLength(2);
  });

  it('preview is unavailable with the adapter\'s own reason when it does not support the action, and with the transport fault when it is down', async () => {
    adapter.supports = { restart: false, rollback: false };
    const preview = await findExplorerOperation('explorer.service.restart').buildPreview({});
    expect(preview.available).toBe(false);
    expect(preview.unavailableReason).toMatch(/does not support a restart/);
    await adapter.stop();
    const down = await findExplorerOperation('explorer.service.restart').buildPreview({});
    expect(down.available).toBe(false);
    expect(down.unavailableReason).toMatch(/did not answer its capability route/);
    adapter = new FakeAdapterServer();
    endpoint = await adapter.start();
  });

  it('executes a restart: signed request, job id recorded on the run, readback with release before and after', async () => {
    const outcome = await findExplorerOperation('explorer.service.restart').execute(context('run-1', 'RESTART EXPLORER BACKEND', 'idem-1'));
    expect(outcome.verification.verified).toBe(true);
    expect(outcome.result).toMatchObject({ jobId: 'job-1', releaseBefore: NEW, releaseAfter: NEW, expectedRelease: NEW, jobState: 'succeeded', timedOut: false, adapterTarget: TARGET, replayedByAdapter: false });
    expect(outcome.verification.evidence).toEqual(expect.arrayContaining([expect.stringContaining('Adapter: cutover complete')]));
    const submit = adapter.requests.find(r => r.path === '/restart');
    expect(submit?.body).toEqual({ operationId: 'run-1', idempotencyKey: 'idem-1', target: TARGET });
    expect(transitions).toEqual([{ runId: 'run-1', state: 'RUNNING', patch: { progressPercent: 30, result: { jobId: 'job-1', adapterTarget: TARGET, releaseBefore: NEW, requestedRelease: null, replayedByAdapter: false } } }]);
  });

  it('refuses without the typed confirmation and never contacts the adapter', async () => {
    await expect(findExplorerOperation('explorer.service.restart').execute(context('run-x', 'restart please'))).rejects.toThrow(/typed confirmation/);
    await expect(findExplorerOperation('explorer.release.rollback').execute(context('run-y', ''))).rejects.toThrow(/typed confirmation/);
    expect(adapter.requests).toEqual([]);
  });

  it('replays a duplicate idempotent request as the same adapter job', async () => {
    await findExplorerOperation('explorer.service.restart').execute(context('run-1', 'RESTART EXPLORER BACKEND', 'idem-dup'));
    const again = await findExplorerOperation('explorer.service.restart').execute(context('run-2', 'RESTART EXPLORER BACKEND', 'idem-dup'));
    expect(again.result.jobId).toBe('job-1');
    expect(again.result.replayedByAdapter).toBe(true);
    expect(adapter.jobs.size).toBe(1);
  });

  it('rolls back to the journal target and verifies the serving release against it', async () => {
    const outcome = await findExplorerOperation('explorer.release.rollback').execute(context('run-3', 'ROLL BACK EXPLORER RELEASE', 'idem-3'));
    expect(outcome.verification.verified).toBe(true);
    expect(outcome.result).toMatchObject({ requestedRelease: OLD, expectedRelease: OLD, releaseBefore: NEW, releaseAfter: OLD });
    expect(adapter.requests.find(r => r.path === '/rollback')?.body).toMatchObject({ release: OLD, target: TARGET });
  });

  it('refuses a rollback when the journal has no previous verified release', async () => {
    adapter.journal = [adapter.journal[1]];
    const preview = await findExplorerOperation('explorer.release.rollback').buildPreview({});
    expect(preview.available).toBe(false);
    expect(preview.unavailableReason).toMatch(/no previous verified release/);
    await expect(findExplorerOperation('explorer.release.rollback').execute(context('run-4', 'ROLL BACK EXPLORER RELEASE'))).rejects.toThrow(/no previous verified release/);
    expect(adapter.requests.find(r => r.path === '/rollback')).toBeUndefined();
  });

  it('reports a job that outlives the wait as unverified with its id, never as done', async () => {
    adapter.pollsUntilDone = 1_000;
    let now = Date.now();
    const slow = new DeploymentControlClient(() => ({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: endpoint, EXPLORER_DEPLOYMENT_CONTROL_KEY: KEY }), undefined, () => now);
    const originalWait = slow.waitForJob.bind(slow);
    slow.waitForJob = (jobId, deadlineMs) => originalWait(jobId, deadlineMs, async () => { now += 400_000; });
    useDeploymentControlClient(slow);
    const outcome = await findExplorerOperation('explorer.service.restart').execute(context('run-5', 'RESTART EXPLORER BACKEND'));
    expect(outcome.verification.verified).toBe(false);
    expect(outcome.result).toMatchObject({ jobId: 'job-1', jobState: 'running', timedOut: true, releaseAfter: null });
    expect(outcome.summary).toMatch(/still running/);
  });

  it('fails the run when the adapter times out on the request itself', async () => {
    adapter.hang = true;
    const hanging = client(endpoint, (config, method, path, body) => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`The deployment adapter did not answer ${method} ${path} within 5000 ms.`), { code: 'timeout' })), 10)));
    useDeploymentControlClient(hanging);
    const preview = await findExplorerOperation('explorer.service.restart').buildPreview({});
    expect(preview.available).toBe(false);
    expect(preview.unavailableReason).toMatch(/did not answer/);
    await expect(findExplorerOperation('explorer.service.restart').execute(context('run-6', 'RESTART EXPLORER BACKEND'))).rejects.toThrow(/did not answer/);
  });

  it('fails the run when the adapter rejects the signature', async () => {
    const wrongKey = new DeploymentControlClient(() => ({ EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT: endpoint, EXPLORER_DEPLOYMENT_CONTROL_KEY: 'x'.repeat(48) }));
    useDeploymentControlClient(wrongKey);
    const preview = await findExplorerOperation('explorer.service.restart').buildPreview({});
    expect(preview.unavailableReason).toMatch(/HTTP 401/);
  });
});
