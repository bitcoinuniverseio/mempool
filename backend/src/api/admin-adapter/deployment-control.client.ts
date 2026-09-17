import { createHmac, timingSafeEqual } from 'crypto';
import * as http from 'http';
import logger from '../../logger';

/**
 * The owned deployment adapter, as this process sees it.
 *
 * Restart and rollback are not things a backend can do to itself: the process
 * that would carry them out is the one being replaced. They belong to a
 * small adapter on the host (scripts/universe/deployment-control-adapter.mjs)
 * that wraps the release tooling's health-checked cutover. This client is
 * the whole of what the Explorer knows about it.
 *
 * Contract (every response is JSON):
 *
 *   GET  /capabilities           -> DeploymentCapabilities
 *   POST /restart                -> DeploymentJobAccepted    body: DeploymentRequest
 *   POST /rollback               -> DeploymentJobAccepted    body: DeploymentRequest + release
 *   GET  /jobs/:jobId            -> DeploymentJob
 *
 * Every request carries `X-Deployment-Signature: sha256=<hex>` where the hex
 * is HMAC-SHA256 over `${method}\n${path}\n${body}` with the shared key from
 * EXPLORER_DEPLOYMENT_CONTROL_KEY. The endpoint is EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT:
 * a loopback http:// URL or the absolute path of a unix socket. Nothing else
 * is accepted, so the adapter can never be a remote host.
 *
 * A rollback target is never a request input. It is the previous verified
 * release in the adapter's own journal, read here from the capability
 * document and sent back to the adapter, which checks it against the same
 * journal.
 */

export const DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE = 'EXPLORER_DEPLOYMENT_CONTROL_ENDPOINT';
export const DEPLOYMENT_CONTROL_KEY_VARIABLE = 'EXPLORER_DEPLOYMENT_CONTROL_KEY';
export const DEPLOYMENT_SIGNATURE_HEADER = 'x-deployment-signature';

export const DEPLOYMENT_CONTROL_LIMITS = {
  requestTimeoutMs: 5_000,
  capabilityCacheMs: 30_000,
  pollIntervalMs: 2_000,
  responseBytes: 256 * 1024,
  keyMinLength: 32,
} as const;

export interface DeploymentJournalEntry {
  release: string;
  verifiedAt: string;
  operation: 'cutover' | 'rollback' | 'record';
}

export interface DeploymentCapabilities {
  application: string;
  target: string;
  currentRelease: string | null;
  journal: DeploymentJournalEntry[];
  supports: { restart: boolean; rollback: boolean };
  reasons: { restart: string | null; rollback: string | null };
  adapterVersion: string;
  observedAt: string;
}

export interface DeploymentRequest {
  operationId: string;
  idempotencyKey: string;
  target: string;
  release?: string;
}

export interface DeploymentJobAccepted {
  jobId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  replayed: boolean;
}

export interface DeploymentJob {
  jobId: string;
  operation: 'restart' | 'rollback';
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  target: string;
  releaseBefore: string | null;
  releaseAfter: string | null;
  requestedRelease: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  evidence: string[];
}

export type DeploymentControlState =
  | { state: 'unconfigured'; reason: string; capabilities: null; probedAt: null }
  | { state: 'unprobed'; reason: string; capabilities: null; probedAt: null }
  | { state: 'unreachable'; reason: string; capabilities: null; probedAt: string }
  | { state: 'ready'; reason: null; capabilities: DeploymentCapabilities; probedAt: string };

export class DeploymentControlError extends Error {
  constructor(public readonly code: 'unconfigured' | 'unreachable' | 'rejected' | 'timeout' | 'protocol', message: string) {
    super(message);
  }
}

export interface DeploymentControlConfig {
  endpoint: { kind: 'http'; host: string; port: number } | { kind: 'socket'; path: string };
  key: Buffer;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** null when the endpoint or key is absent; throws when one is present but unusable. */
export function deploymentControlConfig(environment: Record<string, string | undefined> = process.env): DeploymentControlConfig | null {
  const endpoint = String(environment[DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE] ?? '').trim();
  const key = String(environment[DEPLOYMENT_CONTROL_KEY_VARIABLE] ?? '').trim();
  if (!endpoint && !key) { return null; }
  if (!endpoint || !key) {
    throw new DeploymentControlError('unconfigured', `${DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE} and ${DEPLOYMENT_CONTROL_KEY_VARIABLE} must both be set.`);
  }
  if (key.length < DEPLOYMENT_CONTROL_LIMITS.keyMinLength) {
    throw new DeploymentControlError('unconfigured', `${DEPLOYMENT_CONTROL_KEY_VARIABLE} must be at least ${DEPLOYMENT_CONTROL_LIMITS.keyMinLength} characters.`);
  }
  if (endpoint.startsWith('/')) {
    return { endpoint: { kind: 'socket', path: endpoint }, key: Buffer.from(key, 'utf8') };
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DeploymentControlError('unconfigured', `${DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE} must be a loopback http:// URL or an absolute unix socket path.`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new DeploymentControlError('unconfigured', `${DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE} must be a plain loopback http:// origin such as http://127.0.0.1:8790.`);
  }
  return { endpoint: { kind: 'http', host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : 80 }, key: Buffer.from(key, 'utf8') };
}

export function signDeploymentRequest(key: Buffer, method: string, path: string, body: string): string {
  return 'sha256=' + createHmac('sha256', key).update(`${method.toUpperCase()}\n${path}\n${body}`).digest('hex');
}

export function verifyDeploymentSignature(key: Buffer, method: string, path: string, body: string, header: string | undefined): boolean {
  const expected = Buffer.from(signDeploymentRequest(key, method, path, body));
  const presented = Buffer.from(String(header ?? ''));
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

const RELEASE_SHA = /^[0-9a-f]{7,64}$/;

function isJournalEntry(value: unknown): value is DeploymentJournalEntry {
  const entry = value as DeploymentJournalEntry;
  return !!entry && typeof entry === 'object' && RELEASE_SHA.test(String(entry.release)) && typeof entry.verifiedAt === 'string' && !Number.isNaN(Date.parse(entry.verifiedAt)) && ['cutover', 'rollback', 'record'].includes(entry.operation);
}

export function parseCapabilities(value: unknown): DeploymentCapabilities {
  const doc = value as DeploymentCapabilities;
  if (!doc || typeof doc !== 'object' || doc.application !== 'explorer' || typeof doc.target !== 'string' || !doc.target || !Array.isArray(doc.journal) || !doc.supports || typeof doc.supports !== 'object') {
    throw new DeploymentControlError('protocol', 'The deployment adapter answered its capability route with a document this Explorer does not understand.');
  }
  if (doc.currentRelease !== null && !RELEASE_SHA.test(String(doc.currentRelease))) {
    throw new DeploymentControlError('protocol', 'The deployment adapter reported a current release that is not a commit sha.');
  }
  if (!doc.journal.every(isJournalEntry) || doc.journal.length > 500) {
    throw new DeploymentControlError('protocol', 'The deployment adapter journal is malformed.');
  }
  return {
    application: 'explorer',
    target: doc.target.slice(0, 200),
    currentRelease: doc.currentRelease,
    journal: doc.journal.map(entry => ({ release: entry.release, verifiedAt: entry.verifiedAt, operation: entry.operation })),
    supports: { restart: doc.supports.restart === true, rollback: doc.supports.rollback === true },
    reasons: { restart: typeof doc.reasons?.restart === 'string' ? doc.reasons.restart : null, rollback: typeof doc.reasons?.rollback === 'string' ? doc.reasons.rollback : null },
    adapterVersion: String(doc.adapterVersion ?? 'unknown').slice(0, 64),
    observedAt: typeof doc.observedAt === 'string' ? doc.observedAt : new Date().toISOString(),
  };
}

/**
 * The previous verified release: the newest journal entry whose release is
 * not the one serving now. Derived, never supplied.
 */
export function rollbackTargetFromJournal(capabilities: DeploymentCapabilities): DeploymentJournalEntry | null {
  const ordered = [...capabilities.journal].sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt));
  return ordered.find(entry => entry.release !== capabilities.currentRelease) ?? null;
}

export function parseJob(value: unknown): DeploymentJob {
  const job = value as DeploymentJob;
  if (!job || typeof job !== 'object' || typeof job.jobId !== 'string' || !['restart', 'rollback'].includes(job.operation) || !['queued', 'running', 'succeeded', 'failed'].includes(job.state)) {
    throw new DeploymentControlError('protocol', 'The deployment adapter answered a job read with a document this Explorer does not understand.');
  }
  const sha = (v: unknown): string | null => (v === null || v === undefined ? null : RELEASE_SHA.test(String(v)) ? String(v) : null);
  return {
    jobId: job.jobId.slice(0, 128),
    operation: job.operation,
    state: job.state,
    target: String(job.target ?? '').slice(0, 200),
    releaseBefore: sha(job.releaseBefore),
    releaseAfter: sha(job.releaseAfter),
    requestedRelease: sha(job.requestedRelease),
    startedAt: typeof job.startedAt === 'string' ? job.startedAt : null,
    finishedAt: typeof job.finishedAt === 'string' ? job.finishedAt : null,
    error: typeof job.error === 'string' ? job.error.slice(0, 1000) : null,
    evidence: Array.isArray(job.evidence) ? job.evidence.filter((e): e is string => typeof e === 'string').slice(0, 50).map(e => e.slice(0, 500)) : [],
  };
}

export interface DeploymentTransport {
  (config: DeploymentControlConfig, method: 'GET' | 'POST', path: string, body: string, timeoutMs: number): Promise<{ status: number; body: string }>;
}

/** The one place a socket to the adapter is opened. */
export const httpDeploymentTransport: DeploymentTransport = (config, method, path, body, timeoutMs) => new Promise((resolve, reject) => {
  const request = http.request({
    ...(config.endpoint.kind === 'socket' ? { socketPath: config.endpoint.path } : { host: config.endpoint.host, port: config.endpoint.port }),
    method,
    path,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      [DEPLOYMENT_SIGNATURE_HEADER]: signDeploymentRequest(config.key, method, path, body),
    },
    timeout: timeoutMs,
  }, response => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > DEPLOYMENT_CONTROL_LIMITS.responseBytes) { request.destroy(new DeploymentControlError('protocol', 'The deployment adapter response is too large.')); return; }
      chunks.push(chunk);
    });
    response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    response.on('error', reject);
  });
  request.on('timeout', () => request.destroy(new DeploymentControlError('timeout', `The deployment adapter did not answer ${method} ${path} within ${timeoutMs} ms.`)));
  request.on('error', error => reject(error instanceof DeploymentControlError ? error : new DeploymentControlError('unreachable', `The deployment adapter could not be reached: ${error.message}`)));
  request.end(body);
});

export class DeploymentControlClient {
  private snapshot: DeploymentControlState;
  private inflight: Promise<DeploymentControlState> | null = null;

  constructor(
    private readonly environment: () => Record<string, string | undefined> = () => process.env,
    private readonly transport: DeploymentTransport = httpDeploymentTransport,
    private readonly now: () => number = Date.now,
  ) {
    this.snapshot = this.initialState();
  }

  private initialState(): DeploymentControlState {
    try {
      const config = deploymentControlConfig(this.environment());
      if (!config) {
        return { state: 'unconfigured', reason: `Host-level deployment control is not configured for this process. An operator has to run the owned deployment adapter on this host and set ${DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE} and ${DEPLOYMENT_CONTROL_KEY_VARIABLE} before the Control Center can restart or roll back this Explorer.`, capabilities: null, probedAt: null };
      }
      return { state: 'unprobed', reason: 'The deployment adapter is configured but has not answered its capability route yet.', capabilities: null, probedAt: null };
    } catch (e) {
      return { state: 'unconfigured', reason: e instanceof Error ? e.message : String(e), capabilities: null, probedAt: null };
    }
  }

  /** What is known right now, without a network round trip. A stale or unprobed state starts a probe in the background. */
  public known(): DeploymentControlState {
    const current = this.initialState();
    if (current.state === 'unconfigured') {
      this.snapshot = current;
      return current;
    }
    const stale = this.snapshot.probedAt === null || this.now() - Date.parse(this.snapshot.probedAt) > DEPLOYMENT_CONTROL_LIMITS.capabilityCacheMs;
    if (stale) {
      this.probe().catch(() => undefined);
    }
    return this.snapshot;
  }

  /** @asyncUnsafe A rejection never escapes: every outcome becomes a state. */
  private async request(method: 'GET' | 'POST', path: string, body: unknown = ''): Promise<unknown> {
    const config = deploymentControlConfig(this.environment());
    if (!config) { throw new DeploymentControlError('unconfigured', this.initialState().reason ?? 'unconfigured'); }
    const text = body === '' ? '' : JSON.stringify(body);
    const response = await this.transport(config, method, path, text, DEPLOYMENT_CONTROL_LIMITS.requestTimeoutMs);
    let parsed: unknown;
    try {
      parsed = response.body ? JSON.parse(response.body) : null;
    } catch {
      throw new DeploymentControlError('protocol', `The deployment adapter answered ${method} ${path} with a body that is not JSON.`);
    }
    if (response.status < 200 || response.status >= 300) {
      const message = (parsed as { error?: unknown })?.error;
      throw new DeploymentControlError('rejected', `The deployment adapter refused ${method} ${path} (HTTP ${response.status}): ${typeof message === 'string' ? message : 'no reason given'}.`);
    }
    return parsed;
  }

  /** A fresh capability read; the result also becomes the cached state. @asyncUnsafe Errors become an unreachable state. */
  public async probe(): Promise<DeploymentControlState> {
    if (this.inflight) { return this.inflight; }
    this.inflight = (async (): Promise<DeploymentControlState> => {
      const probedAt = new Date(this.now()).toISOString();
      try {
        const capabilities = parseCapabilities(await this.request('GET', '/capabilities'));
        this.snapshot = { state: 'ready', reason: null, capabilities, probedAt };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        if (e instanceof DeploymentControlError && e.code === 'unconfigured') {
          this.snapshot = { state: 'unconfigured', reason, capabilities: null, probedAt: null };
        } else {
          this.snapshot = { state: 'unreachable', reason: 'The deployment adapter did not answer its capability route: ' + reason, capabilities: null, probedAt };
          logger.debug('[admin-adapter] deployment adapter capability probe failed: ' + reason);
        }
      } finally {
        this.inflight = null;
      }
      return this.snapshot;
    })();
    return this.inflight;
  }

  /** @asyncUnsafe The operation handler turns a rejection into a failed run. */
  public async submit(operation: 'restart' | 'rollback', request: DeploymentRequest): Promise<DeploymentJobAccepted> {
    const accepted = await this.request('POST', `/${operation}`, request) as DeploymentJobAccepted;
    if (!accepted || typeof accepted.jobId !== 'string' || !accepted.jobId) {
      throw new DeploymentControlError('protocol', `The deployment adapter accepted ${operation} without a job id.`);
    }
    return { jobId: accepted.jobId.slice(0, 128), state: accepted.state, replayed: accepted.replayed === true };
  }

  /** @asyncUnsafe The operation handler turns a rejection into a failed run. */
  public async job(jobId: string): Promise<DeploymentJob> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) { throw new DeploymentControlError('protocol', 'Invalid job id.'); }
    return parseJob(await this.request('GET', `/jobs/${jobId}`));
  }

  /**
   * Polls a job until it is terminal or the deadline passes. The deadline
   * is a bound on waiting, not on the adapter: a job still running when it
   * passes is reported as such, with its id, so it can be read again later.
   * @asyncUnsafe The operation handler turns a rejection into a failed run.
   */
  public async waitForJob(jobId: string, deadlineMs: number, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<{ job: DeploymentJob; timedOut: boolean }> {
    const deadline = this.now() + deadlineMs;
    for (;;) {
      const job = await this.job(jobId);
      if (job.state === 'succeeded' || job.state === 'failed') { return { job, timedOut: false }; }
      if (this.now() >= deadline) { return { job, timedOut: true }; }
      await sleep(Math.min(DEPLOYMENT_CONTROL_LIMITS.pollIntervalMs, Math.max(0, deadline - this.now())));
    }
  }
}

export const deploymentControlClient = new DeploymentControlClient();
