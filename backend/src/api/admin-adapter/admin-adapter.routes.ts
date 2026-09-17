import { Application, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import type {
  AdminManifest,
  AdminResource,
  AdminResourceKind,
} from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import config from '../../config';
import logger from '../../logger';
import backendInfo from '../backend-info';
import blocks from '../blocks';
import capabilities from '../capabilities';
import memPool from '../mempool';
import { adminAdapterGuard, adminAdapterJsonParser, hasSignedAdminElevation } from './admin-adapter.security';
import { createAdminReplayStore } from './admin-adapter.replay';
import {
  adminEnvelope,
  adminTimestamp,
  explorerEnvironment,
  explorerNetwork,
  explorerRelease,
} from './admin-adapter.identity';
import {
  buildExplorerSnapshot,
  capabilityLabel,
  capabilityState,
} from './admin-adapter.snapshot';
import {
  findExplorerOperation,
  listExplorerOperations,
} from './admin-adapter.operations';
import runStore, { AdminRunConflict, AdminRunNotFound } from './admin-adapter.runs';
import { resumeDeploymentRuns } from './deployment-control.resume';

const {
  ADMIN_CONTROL_SUPPORTED_VERSIONS,
  ADMIN_RESOURCE_KINDS,
  adminRiskRequiresElevation,
} = adminControl as typeof import('@bitcoinuniverse/ecosystem-contracts/admin-control');

const PREFIX = '/internal/admin/v1';

function boundedLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(200, Math.trunc(parsed)));
}

function fail(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ code, message });
}

/**
 * A resource in the shared shape. Explorer resources are derived from live
 * runtime state, so `updatedAt` is the moment the value was read rather than
 * a stored row timestamp.
 */
function resource(input: {
  kind: AdminResourceKind;
  id: string;
  name: string;
  state: AdminResource['state'];
  statusLabel?: string | null;
  summary?: string | null;
  attributes?: AdminResource['attributes'];
  operations?: string[];
  related?: AdminResource['related'];
  updatedAt?: string | null;
}): AdminResource {
  return {
    kind: input.kind,
    id: input.id.slice(0, 300),
    application: 'explorer',
    environment: explorerEnvironment(),
    network: explorerNetwork(),
    name: input.name.slice(0, 300),
    state: input.state,
    statusLabel: input.statusLabel ?? null,
    summary: input.summary ?? null,
    createdAt: null,
    updatedAt: input.updatedAt ?? adminTimestamp(),
    sourceReleaseSha: explorerRelease().backendSha,
    attributes: input.attributes ?? {},
    operations: input.operations ?? [],
    related: input.related ?? [],
    timeline: [],
  };
}

/** @asyncUnsafe Every caller is inside a route handler try/catch. */
async function explorerManifest(): Promise<AdminManifest> {
  const report = await capabilities.$report();
  const network = explorerNetwork();
  return {
    ...adminEnvelope(),
    adapterName: 'explorer-admin-adapter',
    supportedContractVersions: [...ADMIN_CONTROL_SUPPORTED_VERSIONS],
    networks: network ? [network] : [],
    release: explorerRelease(),
    capabilities: Object.entries(report.features).map(([feature, entry]) => ({
      id: feature,
      label: capabilityLabel(feature),
      // A capability is only supported when it can actually answer. Enabled
      // and configured are not the same claim as ready.
      supported: entry.state === 'ready',
      reason:
        entry.state === 'ready'
          ? null
          : (entry.degradedReason ?? `The capability reports state ${entry.state}.`),
    })),
    resourceKinds: ['service', 'dependency', 'indexer', 'node', 'database', 'run', 'release'],
    operationCount: listExplorerOperations().length,
  };
}

function runResource(run: Awaited<ReturnType<typeof runStore.get>>): AdminResource {
  return resource({
    kind: 'run',
    id: run.runId,
    name: run.operationId,
    state: run.state === 'SUCCEEDED' ? 'healthy'
      : run.state === 'FAILED' || run.state === 'ROLLBACK_FAILED' ? 'unavailable'
      : run.state === 'NEEDS_REVIEW' ? 'degraded' : 'syncing',
    statusLabel: run.state,
    summary: run.reason,
    updatedAt: run.updatedAt,
    attributes: { target: run.target, actor: run.actor, correlationId: run.correlationId },
  });
}

/**
 * Every resource kind the Explorer can enumerate, built from live state.
 *
 * @asyncUnsafe Every caller is inside a route handler try/catch.
 */
async function collect(kind: AdminResourceKind, query: string, limit: number): Promise<AdminResource[]> {
  const needle = query.trim().toLowerCase().slice(0, 200);
  const matches = (text: string): boolean => !needle || text.toLowerCase().includes(needle);

  if (kind === 'run') {
    const runs = await runStore.list(limit, needle);
    return runs
      .filter((run) => matches(`${run.runId} ${run.operationId} ${run.target}`))
      .map(runResource);
  }

  if (kind === 'release') {
    const release = explorerRelease();
    if (!matches(`${release.backendSha} ${release.frontendSha} ${release.version} Explorer`)) return [];
    return [
      resource({
        kind: 'release',
        id: release.backendSha ?? 'unknown',
        name: `Explorer ${release.version ?? 'release'}`,
        state: release.backendSha === null ? 'unknown' : 'healthy',
        summary:
          release.backendSha === null
            ? 'This build did not record a commit hash, so its release identity cannot be proven.'
            : null,
        attributes: {
          backendSha: release.backendSha,
          frontendSha: release.frontendSha,
          version: release.version,
          repository: release.repository,
        },
        operations: ['explorer.release.verify'],
      }),
    ];
  }

  const snapshot = await buildExplorerSnapshot();
  const pools =
    kind === 'service'
      ? snapshot.components
      : kind === 'dependency'
        ? snapshot.dependencies
        : kind === 'indexer'
          ? snapshot.indexers
          : kind === 'node' || kind === 'database'
            ? snapshot.dependencies.filter((entry) => entry.kind === kind)
            : [];
  return pools
    .filter((entry) => matches(`${entry.id} ${entry.name}`))
    .slice(0, limit)
    .map((entry) =>
      resource({
        kind: entry.kind,
        id: entry.id,
        name: entry.name,
        state: entry.state,
        summary: entry.reason,
        updatedAt: entry.lastCheckedAt,
        operations: entry.operations,
        attributes: {
          ...entry.metrics,
          chainTip: entry.chainTip,
          indexedTip: entry.indexedTip,
          lagBlocks: entry.lagBlocks,
          lagSeconds: entry.lagSeconds,
        },
      }),
    );
}

/**
 * The Explorer's private adapter for the unified Control Center.
 *
 * Mounted only after the guard, and never reachable from a browser: the guard
 * refuses anything that did not arrive over a private path with a valid
 * signature, and the response headers strip the public wildcard CORS origin.
 */
class AdminAdapterRoutes {
  public initRoutes(app: Application): void {
    // Also support standalone registration; the full app captures these bytes
    // before its general parsers consume the request stream.
    app.use(PREFIX, adminAdapterJsonParser(), adminAdapterGuard(createAdminReplayStore()));

    app.get(`${PREFIX}/manifest`, async (_request: Request, response: Response) => {
      try {
        response.json(await explorerManifest());
      } catch (e) {
        logger.err('[admin-adapter] manifest failed: ' + (e instanceof Error ? e.message : e));
        fail(response, 500, 'MANIFEST_FAILED', 'The adapter could not build its manifest.');
      }
    });

    app.get(`${PREFIX}/snapshot`, async (_request: Request, response: Response) => {
      try {
        response.json(await buildExplorerSnapshot());
      } catch (e) {
        logger.err('[admin-adapter] snapshot failed: ' + (e instanceof Error ? e.message : e));
        fail(response, 500, 'SNAPSHOT_FAILED', 'The adapter could not build a snapshot.');
      }
    });

    app.get(`${PREFIX}/resources`, async (request: Request, response: Response) => {
      const kind = String(request.query.kind ?? '');
      if (!(ADMIN_RESOURCE_KINDS as readonly string[]).includes(kind)) {
        fail(response, 400, 'UNKNOWN_RESOURCE_KIND', `Unknown resource kind ${kind}.`);
        return;
      }
      const limit = boundedLimit(request.query.limit);
      try {
        const items = await collect(kind as AdminResourceKind, String(request.query.q ?? ''), limit);
        response.json({
          ...adminEnvelope(),
          kind,
          items,
          page: { limit, total: items.length, nextCursor: null, truncated: items.length >= limit },
        });
      } catch (e) {
        logger.err('[admin-adapter] resources failed: ' + (e instanceof Error ? e.message : e));
        fail(response, 503, 'RESOURCES_FAILED', 'The adapter could not list those resources.');
      }
    });

    app.get(`${PREFIX}/resources/:kind/:id`, async (request: Request, response: Response) => {
      const kind = String(request.params.kind);
      if (!(ADMIN_RESOURCE_KINDS as readonly string[]).includes(kind)) {
        fail(response, 400, 'UNKNOWN_RESOURCE_KIND', `Unknown resource kind ${kind}.`);
        return;
      }
      try {
        const id = String(request.params.id);
        if (id.length > 300) {
          fail(response, 400, 'INVALID_RESOURCE_ID', 'Resource id exceeds the limit.');
          return;
        }
        const found = kind === 'run' ? runResource(await runStore.get(id)) : (await collect(kind as AdminResourceKind, '', 200)).find(
          (entry) => entry.id === id,
        );
        if (!found) {
          fail(response, 404, 'NOT_FOUND', 'No such resource.');
          return;
        }
        response.json({ ...adminEnvelope(), resource: found });
      } catch (e) {
        if (e instanceof AdminRunNotFound) {
          fail(response, 404, 'NOT_FOUND', 'No such resource.');
          return;
        }
        logger.err('[admin-adapter] resource failed: ' + (e instanceof Error ? e.message : e));
        fail(response, 503, 'RESOURCE_FAILED', 'The adapter could not read that resource.');
      }
    });

    app.get(`${PREFIX}/search`, async (request: Request, response: Response) => {
      const query = String(request.query.q ?? '').slice(0, 200);
      const limit = boundedLimit(request.query.limit, 25);
      try {
        const items: AdminResource[] = [];
        for (const kind of ['service', 'dependency', 'indexer', 'run', 'release'] as AdminResourceKind[]) {
          if (items.length >= limit) {
            break;
          }
          items.push(...(await collect(kind, query, limit - items.length)));
        }
        response.json({
          ...adminEnvelope(),
          query,
          items: items.slice(0, limit),
          truncated: items.length >= limit,
        });
      } catch (e) {
        logger.err('[admin-adapter] search failed: ' + (e instanceof Error ? e.message : e));
        fail(response, 503, 'SEARCH_FAILED', 'The adapter could not run that search.');
      }
    });

    app.get(`${PREFIX}/operations`, (_request: Request, response: Response) => {
      const items = listExplorerOperations().map((operation) => {
        const { buildPreview, execute, ...definition } = operation;
        return definition;
      });
      response.json({ ...adminEnvelope(), items });
    });

    app.post(`${PREFIX}/operations/:operationId/preview`, async (request: Request, response: Response) => {
      try {
        const operation = findExplorerOperation(String(request.params.operationId).slice(0, 160));
        const input = (request.body?.input ?? request.body ?? {}) as Record<string, unknown>;
        const body = await operation.buildPreview(input);
        response.json({
          ...adminEnvelope(),
          operationId: operation.id,
          operationVersion: operation.version,
          risk: operation.risk,
          ...body,
        });
      } catch (e) {
        fail(response, 422, 'PREVIEW_FAILED', e instanceof Error ? e.message : 'Preview failed.');
      }
    });

    app.post(`${PREFIX}/operations/:operationId/execute`, async (request: Request, response: Response) => {
      let operationId = '';
      try {
        operationId = String(request.params.operationId).slice(0, 160);
        const operation = findExplorerOperation(operationId);
        const elevated = hasSignedAdminElevation(response);
        if (adminRiskRequiresElevation(operation.risk) && !elevated) {
          // Permission checks and reauthentication belong to the control plane.
          // Its elevation claim must be inside the signed request body.
          fail(
            response,
            403,
            'ELEVATION_REQUIRED',
            `${operation.name} requires adminAuthorization.elevated=true in the signed JSON request body.`,
          );
          return;
        }
        if (operation.availability !== 'enabled') {
          fail(
            response,
            409,
            'OPERATION_UNAVAILABLE',
            operation.availabilityReason ?? `${operation.name} is not available in this deployment.`,
          );
          return;
        }

        const input = (request.body?.input ?? request.body ?? {}) as Record<string, unknown>;
        const previewBody = await operation.buildPreview(input);
        if (!previewBody.available) {
          fail(
            response,
            409,
            'PRECONDITION_NOT_MET',
            previewBody.unavailableReason ?? `${operation.name} cannot run right now.`,
          );
          return;
        }

        await runStore.reconcileAbandonedRuns();
        const correlationId =
          String(request.headers['x-bu-admin-correlation-id'] ?? '').slice(0, 128) || randomUUID();
        const actor = String(request.headers['x-bu-admin-actor'] ?? '').slice(0, 200) || 'control-center';
        const { run, replayed, ownerToken } = await runStore.create({
          operationId: operation.id,
          operationVersion: operation.version,
          target: previewBody.target,
          actor,
          reason: String(request.headers['x-bu-admin-reason'] ?? '').slice(0, 500) || null,
          correlationId,
          idempotencyKey: String(request.headers['idempotency-key'] ?? '').slice(0, 200) || null,
          cancellable: operation.cancellable,
          rollbackSupported: operation.rollbackSupported,
          redactedInput: input,
        });
        if (replayed || ownerToken === null) {
          response.json({ ...adminEnvelope(), run });
          return;
        }

        if (operation.lock) {
          try {
            await runStore.acquireLock(`${operation.lock}:${previewBody.target}`, run.runId);
          } catch (e) {
            // The run was already inserted QUEUED. Leave a terminal, inspectable
            // record rather than a row that waits forever for a lock it lost.
            const message = e instanceof Error ? e.message : String(e);
            await runStore.transition(run.runId, 'FAILED', {
              error: { class: 'lock_conflict', message: message.slice(0, 700), retryable: true },
              logs: [{ at: adminTimestamp(), level: 'error', message: message.slice(0, 1000) }],
            }, ownerToken);
            throw e instanceof AdminRunConflict
              ? new AdminRunConflict(`${message} Run ${run.runId} was recorded as FAILED.`)
              : e;
          }
        }
        await runStore.transition(run.runId, 'PRECHECK', {
          logs: [{ at: adminTimestamp(), level: 'info', message: 'Preconditions verified.' }],
        }, ownerToken);
        await runStore.transition(run.runId, 'RUNNING', { progressPercent: 10 }, ownerToken);

        try {
          const outcome = await runStore.withHeartbeat(run.runId, ownerToken, () => operation.execute({
            runId: run.runId,
            correlationId,
            actor,
            reason: run.reason,
            idempotencyKey: run.idempotencyKey,
            input,
          }));
          await runStore.transition(run.runId, 'VERIFYING', { progressPercent: 90 }, ownerToken);
          const finished = await runStore.transition(
            run.runId,
            outcome.verification.verified ? 'SUCCEEDED' : 'NEEDS_REVIEW',
            {
              progressPercent: 100,
              result: outcome.result,
              verification: outcome.verification,
              logs: [
                { at: adminTimestamp(), level: 'info', message: outcome.summary },
                ...(outcome.verification.verified
                  ? []
                  : [
                      {
                        at: adminTimestamp(),
                        level: 'warn' as const,
                        message:
                          'The operation finished but its postcondition could not be verified, so the outcome is unknown rather than successful.',
                      },
                    ]),
              ],
            },
            ownerToken,
          );
          response.json({ ...adminEnvelope(), run: finished });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          const failed = await runStore.transition(run.runId, 'FAILED', {
            error: { class: 'operation_failed', message: message.slice(0, 700), retryable: true },
            logs: [{ at: adminTimestamp(), level: 'error', message: message.slice(0, 1000) }],
          }, ownerToken);
          response.json({ ...adminEnvelope(), run: failed });
        }
      } catch (e) {
        if (e instanceof AdminRunConflict) {
          fail(response, 409, 'RUN_CONFLICT', e.message);
          return;
        }
        logger.err(`[admin-adapter] execute ${operationId} failed: ` + (e instanceof Error ? e.message : e));
        fail(response, 422, 'EXECUTE_FAILED', e instanceof Error ? e.message : 'Execution failed.');
      }
    });

    app.get(`${PREFIX}/runs/:runId`, async (request: Request, response: Response) => {
      try {
        const run = await runStore.get(String(request.params.runId).slice(0, 128));
        response.json({ ...adminEnvelope(), run });
      } catch (e) {
        if (e instanceof AdminRunNotFound) {
          fail(response, 404, 'NOT_FOUND', 'No such operation run.');
          return;
        }
        fail(response, 500, 'RUN_FAILED', 'The adapter could not read that run.');
      }
    });

    app.post(`${PREFIX}/runs/:runId/cancel`, async (request: Request, response: Response) => {
      try {
        const run = await runStore.requestCancel(String(request.params.runId).slice(0, 128));
        response.json({ ...adminEnvelope(), run });
      } catch (e) {
        if (e instanceof AdminRunNotFound) {
          fail(response, 404, 'NOT_FOUND', 'No such operation run.');
          return;
        }
        fail(response, 409, 'CANCEL_REFUSED', e instanceof Error ? e.message : 'Cancellation refused.');
      }
    });

    app.get(`${PREFIX}/audit`, async (request: Request, response: Response) => {
      const limit = boundedLimit(request.query.limit);
      const offset = Math.max(0, Math.trunc(Number(request.query.offset ?? 0)) || 0);
      try {
        const runs = await runStore.auditEntries(limit, offset);
        response.json({
          ...adminEnvelope(),
          items: runs.map((run) => ({
            id: run.runId,
            at: run.queuedAt,
            application: 'explorer' as const,
            actor: run.actor,
            action: run.operationId,
            target: run.target,
            outcome:
              run.state === 'SUCCEEDED'
                ? ('succeeded' as const)
                : run.state === 'FAILED'
                  ? ('failed' as const)
                  : run.state === 'CANCELLED'
                    ? ('cancelled' as const)
                    : run.state === 'NEEDS_REVIEW'
                      ? ('needs_review' as const)
                      : ('started' as const),
            risk: null,
            correlationId: run.correlationId,
            reason: run.reason,
            detail: run.result,
          })),
          page: { limit, total: null, nextCursor: null, truncated: runs.length >= limit },
        });
      } catch (e) {
        logger.err('[admin-adapter] audit failed: ' + (e instanceof Error ? e.message : e));
        fail(response, 503, 'AUDIT_FAILED', 'The adapter could not read its audit records.');
      }
    });

    let activeStreams = 0;
    app.get(`${PREFIX}/events`, (request: Request, response: Response) => {
      if (activeStreams >= 32) {
        fail(response, 503, 'STREAM_CAPACITY', 'Admin event stream capacity reached.');
        return;
      }
      activeStreams++;
      let closed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        activeStreams--;
        if (timer !== undefined) clearInterval(timer);
        request.removeListener('close', cleanup);
        response.removeListener('close', cleanup);
        response.removeListener('error', cleanup);
      };
      const stop = (): void => {
        cleanup();
        try { if (!response.destroyed && !response.writableEnded) response.end(); } catch { /* Socket already closed. */ }
      };
      request.on('close', cleanup);
      response.on('close', cleanup);
      response.on('error', cleanup);
      try {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Connection', 'keep-alive');
        response.flushHeaders?.();
      } catch { stop(); return; }

      const send = (event: Record<string, unknown>): void => {
        if (closed) return;
        try {
          if (response.destroyed || response.writableEnded || !response.write(`data: ${JSON.stringify(event)}\n\n`)) stop();
        } catch { stop(); }
      };

      // One frame every ten seconds carrying the facts that change fastest.
      // A stream that says nothing is indistinguishable from a dead one, so
      // this always sends something, even when nothing changed.
      timer = setInterval(() => {
        if (closed) return;
        try {
          const sync = backendInfo.getBackendInfo().chainSync;
          send({
            id: randomUUID(),
            at: adminTimestamp(),
            application: 'explorer',
            kind: 'explorer.tick',
            severity: 'info',
            message: `Explorer at height ${blocks.getCurrentBlockHeight()} with ${Object.keys(memPool.getMempool()).length} mempool transactions.`,
            resourceKind: null,
            resourceId: null,
            correlationId: null,
            data: {
              blockHeight: blocks.getCurrentBlockHeight(),
              mempoolTransactions: Object.keys(memPool.getMempool()).length,
              nodeBlocks: sync?.blocks ?? null,
              nodeHeaders: sync?.headers ?? null,
            },
          });
        } catch { stop(); }
      }, 10_000);
    });

    logger.info(
      `[admin-adapter] Explorer admin adapter mounted at ${PREFIX} (database ${config.DATABASE.ENABLED ? 'enabled' : 'disabled'}).`,
    );
    // A restart run is cut short by the restart it asked for; the process
    // that comes up closes it from the adapter job it recorded.
    // (The boundary tests load this module in a bare VM without timers.)
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        resumeDeploymentRuns().catch((e) => logger.warn('[admin-adapter] deployment run resume failed: ' + (e instanceof Error ? e.message : String(e))));
      }, 5_000).unref();
    }
  }
}

export default new AdminAdapterRoutes();
