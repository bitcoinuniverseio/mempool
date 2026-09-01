import { Application, NextFunction, Request, Response } from 'express';
import express from 'express';
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
import { adminAdapterGuard } from './admin-adapter.security';
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

/**
 * Every resource kind the Explorer can enumerate, built from live state.
 *
 * @asyncUnsafe Every caller is inside a route handler try/catch.
 */
async function collect(kind: AdminResourceKind, query: string, limit: number): Promise<AdminResource[]> {
  const needle = query.trim().toLowerCase();
  const matches = (text: string): boolean => !needle || text.toLowerCase().includes(needle);

  if (kind === 'run') {
    const runs = await runStore.list(limit);
    return runs
      .filter((run) => matches(`${run.runId} ${run.operationId} ${run.target}`))
      .map((run) =>
        resource({
          kind: 'run',
          id: run.runId,
          name: run.operationId,
          state:
            run.state === 'SUCCEEDED'
              ? 'healthy'
              : run.state === 'FAILED' || run.state === 'ROLLBACK_FAILED'
                ? 'unavailable'
                : run.state === 'NEEDS_REVIEW'
                  ? 'degraded'
                  : 'syncing',
          statusLabel: run.state,
          summary: run.reason,
          updatedAt: run.updatedAt,
          attributes: { target: run.target, actor: run.actor, correlationId: run.correlationId },
        }),
      );
  }

  if (kind === 'release') {
    const release = explorerRelease();
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
    // Keep the exact bytes so the signature is checked against what the sender
    // digested. Re-serialising a parsed object would break every signature.
    const parser = express.json({
      limit: '256kb',
      strict: true,
      verify: (request, _response, buffer) => {
        (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    });

    app.use(PREFIX, parser, adminAdapterGuard());

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
        fail(response, 500, 'RESOURCES_FAILED', 'The adapter could not list those resources.');
      }
    });

    app.get(`${PREFIX}/resources/:kind/:id`, async (request: Request, response: Response) => {
      const kind = String(request.params.kind);
      if (!(ADMIN_RESOURCE_KINDS as readonly string[]).includes(kind)) {
        fail(response, 400, 'UNKNOWN_RESOURCE_KIND', `Unknown resource kind ${kind}.`);
        return;
      }
      try {
        const id = String(request.params.id).slice(0, 300);
        const found = (await collect(kind as AdminResourceKind, '', 200)).find(
          (entry) => entry.id === id,
        );
        if (!found) {
          fail(response, 404, 'NOT_FOUND', 'No such resource.');
          return;
        }
        response.json({ ...adminEnvelope(), resource: found });
      } catch (e) {
        logger.err('[admin-adapter] resource failed: ' + (e instanceof Error ? e.message : e));
        fail(response, 500, 'RESOURCE_FAILED', 'The adapter could not read that resource.');
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
        fail(response, 500, 'SEARCH_FAILED', 'The adapter could not run that search.');
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
        const elevated = String(request.headers['x-bu-admin-elevated'] ?? '') === '1';
        if (adminRiskRequiresElevation(operation.risk) && !elevated) {
          // The control plane owns re-authentication. Refusing here as well
          // means a leaked service key cannot reach a high-risk operation.
          fail(
            response,
            403,
            'ELEVATION_REQUIRED',
            `${operation.name} needs an elevated action token and the request did not carry one.`,
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
        const { run, replayed } = await runStore.create({
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
        if (replayed) {
          response.json({ ...adminEnvelope(), run });
          return;
        }

        if (operation.lock) {
          await runStore.acquireLock(`${operation.lock}:${previewBody.target}`, run.runId);
        }
        await runStore.transition(run.runId, 'PRECHECK', {
          logs: [{ at: adminTimestamp(), level: 'info', message: 'Preconditions verified.' }],
        });
        await runStore.transition(run.runId, 'RUNNING', { progressPercent: 10 });

        try {
          const outcome = await operation.execute({
            runId: run.runId,
            correlationId,
            actor,
            reason: run.reason,
            idempotencyKey: run.idempotencyKey,
            input,
          });
          await runStore.transition(run.runId, 'VERIFYING', { progressPercent: 90 });
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
          );
          response.json({ ...adminEnvelope(), run: finished });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          const failed = await runStore.transition(run.runId, 'FAILED', {
            error: { class: 'operation_failed', message: message.slice(0, 700), retryable: true },
            logs: [{ at: adminTimestamp(), level: 'error', message: message.slice(0, 1000) }],
          });
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
        fail(response, 500, 'AUDIT_FAILED', 'The adapter could not read its audit records.');
      }
    });

    app.get(`${PREFIX}/events`, (request: Request, response: Response) => {
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Connection', 'keep-alive');
      response.flushHeaders?.();

      const send = (event: Record<string, unknown>): void => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // One frame every ten seconds carrying the facts that change fastest.
      // A stream that says nothing is indistinguishable from a dead one, so
      // this always sends something, even when nothing changed.
      const timer = setInterval(() => {
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
      }, 10_000);

      request.on('close', () => {
        clearInterval(timer);
      });
    });

    logger.info(
      `[admin-adapter] Explorer admin adapter mounted at ${PREFIX} (database ${config.DATABASE.ENABLED ? 'enabled' : 'disabled'}).`,
    );
  }
}

export default new AdminAdapterRoutes();
