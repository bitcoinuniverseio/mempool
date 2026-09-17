import type {
  AdminOperationDefinition,
  AdminOperationPreview,
} from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import config from '../../config';
import DB from '../../database';
import backendInfo from '../backend-info';
import bitcoinClient from '../bitcoin/bitcoin-client';
import { $probeAddressIndex } from '../bitcoin/address-index';
import blocks from '../blocks';
import capabilities from '../capabilities';
import indexer from '../../indexer';
import memPool from '../mempool';
import poolsUpdater from '../../tasks/pools-updater';
import priceUpdater from '../../tasks/price-updater';
import redisCache from '../redis-cache';
import {
  ALLOWED_INDEXER_TASKS,
  DEPLOYMENT_CONTROL_REASON,
  type AllowedIndexerTask,
  deploymentControlAvailability,
  deploymentControlConfigured,
  explorerOperationDefinitions,
  findExplorerOperationDefinition,
} from './admin-adapter.catalog';
import {
  DEPLOYMENT_CONTROL_LIMITS,
  deploymentControlClient,
  rollbackTargetFromJournal,
  type DeploymentCapabilities,
  type DeploymentControlClient,
  type DeploymentControlState,
  type DeploymentRequest,
} from './deployment-control.client';
import { explorerEnvironment, releaseShaOrNull } from './admin-adapter.identity';
import runStore from './admin-adapter.runs';

/**
 * Reads back what an indexing task is supposed to have persisted, so a run
 * is only called complete when the rows say so. Every query error is returned,
 * never swallowed, because an unreadable checkpoint proves nothing.
 *
 * @asyncUnsafe The caller wraps the readback in try/catch.
 */
async function readIndexerCheckpoint(task: AllowedIndexerTask): Promise<{ remaining: number; indexedTip: number | null }> {
  if (task === 'blocksPrices') {
    const [remainingRows]: any[] = await DB.query(
      'SELECT COUNT(*) AS remaining FROM blocks LEFT JOIN blocks_prices ON blocks.height = blocks_prices.height LEFT JOIN prices ON blocks_prices.price_id = prices.id WHERE blocks_prices.height IS NULL OR prices.id IS NULL',
    );
    const [tipRows]: any[] = await DB.query('SELECT MAX(height) AS tip FROM blocks_prices');
    return {
      remaining: Number(remainingRows[0]?.remaining ?? 0),
      indexedTip: tipRows[0]?.tip === null || tipRows[0]?.tip === undefined ? null : Number(tipRows[0].tip),
    };
  }
  const [remainingRows]: any[] = await DB.query(
    'SELECT COUNT(*) AS remaining FROM blocks WHERE (utxoset_size IS NULL OR total_input_amt IS NULL) AND stale = 0',
  );
  const [tipRows]: any[] = await DB.query(
    'SELECT MAX(height) AS tip FROM blocks WHERE utxoset_size IS NOT NULL AND total_input_amt IS NOT NULL AND stale = 0',
  );
  return {
    remaining: Number(remainingRows[0]?.remaining ?? 0),
    indexedTip: tipRows[0]?.tip === null || tipRows[0]?.tip === undefined ? null : Number(tipRows[0].tip),
  };
}

/**
 * The handlers behind the catalog.
 *
 * Each one calls exactly one internal path that already exists in this
 * process. The descriptors live in `admin-adapter.catalog.ts` so the whole
 * mutable surface can be reviewed without loading any of this.
 */

export interface ExplorerExecutionContext {
  runId: string;
  correlationId: string;
  actor: string;
  reason: string | null;
  idempotencyKey: string | null;
  input: Record<string, unknown>;
}

export interface ExplorerHandlerResult {
  summary: string;
  result: Record<string, string | number | boolean | null | string[]>;
  verification: { verified: boolean; evidence: string[] };
}

export type PreviewBody = Omit<
  AdminOperationPreview,
  | 'schemaVersion'
  | 'contractVersion'
  | 'application'
  | 'environment'
  | 'generatedAt'
  | 'operationId'
  | 'operationVersion'
  | 'risk'
>;

export interface ExplorerOperation extends AdminOperationDefinition {
  buildPreview(input: Record<string, unknown>): Promise<PreviewBody>;
  execute(context: ExplorerExecutionContext): Promise<ExplorerHandlerResult>;
}

interface Handler {
  buildPreview(input: Record<string, unknown>): Promise<PreviewBody>;
  execute(context: ExplorerExecutionContext): Promise<ExplorerHandlerResult>;
}

function satisfied(id: string, label: string, detail: string | null = null) {
  return { id, label, satisfied: true, detail };
}

function unsatisfied(id: string, label: string, detail: string) {
  return { id, label, satisfied: false, detail };
}

function preview(input: {
  target: string;
  preconditions?: PreviewBody['preconditions'];
  effects: string[];
  expectedPostconditions: string[];
  warnings?: string[];
  users?: string | null;
  publicServices?: string | null;
  durationSeconds?: number | null;
  reversible: boolean;
  redactedInput?: PreviewBody['redactedInput'];
}): PreviewBody {
  const preconditions = input.preconditions ?? [];
  const blocked = preconditions.find((entry) => !entry.satisfied);
  return {
    available: !blocked,
    unavailableReason: blocked ? `${blocked.label}: ${blocked.detail ?? 'not met'}` : null,
    previewToken: null,
    expiresAt: null,
    target: input.target,
    preconditions,
    effects: input.effects,
    expectedPostconditions: input.expectedPostconditions,
    warnings: input.warnings ?? [],
    impact: {
      users: input.users ?? null,
      publicServices: input.publicServices ?? null,
      estimatedDurationSeconds: input.durationSeconds ?? null,
      estimatedStorageBytes: null,
      reversible: input.reversible,
    },
    redactedInput: input.redactedInput ?? {},
  };
}

function target(suffix: string): string {
  return `explorer/${explorerEnvironment()}/${suffix}`;
}

function databasePrecondition() {
  return config.DATABASE.ENABLED === true
    ? satisfied('database', 'The explorer database is enabled')
    : unsatisfied(
        'database',
        'The explorer database is enabled',
        'Operations need the database to keep a durable run record, and it is switched off in this deployment.',
      );
}

/** Test seam: the adapter client the deployment operations talk to. */
let controlClient: DeploymentControlClient = deploymentControlClient;
export function useDeploymentControlClient(client: DeploymentControlClient | null): void {
  controlClient = client ?? deploymentControlClient;
}

/**
 * The adapter's own answer, fresh, is the precondition. It is not a flag:
 * an operator who sets the endpoint without running the adapter gets the
 * unreachable reason, and an adapter whose capability document does not
 * support the action gets that adapter's reason.
 */
function deploymentControlPrecondition(operationId: string, control: DeploymentControlState) {
  const { availability, availabilityReason } = deploymentControlAvailability(operationId, control);
  return availability === 'enabled'
    ? satisfied(
        'deployment-control',
        'The deployment adapter answers and supports this operation',
        control.state === 'ready'
          ? `Adapter ${control.capabilities.adapterVersion} on target ${control.capabilities.target}, current release ${control.capabilities.currentRelease ?? 'unknown'}.`
          : null,
      )
    : unsatisfied('deployment-control', 'The deployment adapter answers and supports this operation', availabilityReason ?? DEPLOYMENT_CONTROL_REASON);
}

/** @asyncSafe probe never rejects; every outcome is a state, and a thrown one is reported as unreachable. */
async function probeControl(): Promise<DeploymentControlState> {
  try {
    return await controlClient.probe();
  } catch (e) {
    return { state: 'unreachable', reason: 'The deployment adapter did not answer its capability route: ' + (e instanceof Error ? e.message : String(e)), capabilities: null, probedAt: new Date().toISOString() };
  }
}

function releaseLabel(sha: string | null): string {
  return sha ? sha.slice(0, 12) : 'unknown';
}

/**
 * Submits one job to the adapter and drives it to a terminal state.
 *
 * The job id and the release serving before the request are written to the
 * run before the job is awaited, because a restart replaces this very
 * process: if the wait is cut short, the run still names the job that can
 * be read back from the adapter. A wait that reaches the operation's bound
 * reports the job as still running, never as done.
 * @asyncUnsafe The route turns a rejection into a FAILED run.
 */
async function driveDeployment(
  operation: 'restart' | 'rollback',
  operationId: string,
  context: ExplorerExecutionContext,
  timeoutSeconds: number,
): Promise<ExplorerHandlerResult> {
  const control = await probeControl();
  const precondition = deploymentControlPrecondition(operationId, control);
  if (!precondition.satisfied || control.state !== 'ready') {
    throw new Error(precondition.detail ?? DEPLOYMENT_CONTROL_REASON);
  }
  const capabilities: DeploymentCapabilities = control.capabilities;
  const request: DeploymentRequest = {
    operationId: context.runId,
    idempotencyKey: context.idempotencyKey ?? context.runId,
    target: capabilities.target,
  };
  let expectedRelease = capabilities.currentRelease;
  if (operation === 'rollback') {
    const journalTarget = rollbackTargetFromJournal(capabilities);
    if (!journalTarget) {
      throw new Error('The deployment adapter journal holds no previous verified release to roll back to.');
    }
    request.release = journalTarget.release;
    expectedRelease = journalTarget.release;
  }
  const startedAt = Date.now();
  const accepted = await controlClient.submit(operation, request);
  const partial = {
    jobId: accepted.jobId,
    adapterTarget: capabilities.target,
    releaseBefore: capabilities.currentRelease,
    requestedRelease: request.release ?? null,
    replayedByAdapter: accepted.replayed,
  };
  await runStore.transition(context.runId, 'RUNNING', { progressPercent: 30, result: partial });

  const budgetMs = Math.max(DEPLOYMENT_CONTROL_LIMITS.pollIntervalMs, timeoutSeconds * 1000 - (Date.now() - startedAt));
  const { job, timedOut } = await controlClient.waitForJob(accepted.jobId, budgetMs);
  const evidence = [
    `Adapter job ${job.jobId} (${job.operation}) on ${job.target || capabilities.target} is ${job.state}.`,
    `Release before: ${releaseLabel(job.releaseBefore ?? capabilities.currentRelease)}; after: ${releaseLabel(job.releaseAfter)}; expected: ${releaseLabel(expectedRelease)}.`,
    ...job.evidence.map((line) => 'Adapter: ' + line),
  ];
  const result = {
    ...partial,
    jobState: job.state,
    releaseAfter: job.releaseAfter,
    expectedRelease,
    jobStartedAt: job.startedAt,
    jobFinishedAt: job.finishedAt,
    jobError: job.error,
    waitedMs: Date.now() - startedAt,
    timedOut,
  };
  if (timedOut) {
    return {
      summary: `The adapter job ${job.jobId} was still ${job.state} after ${timeoutSeconds}s; read it back from the adapter before treating the ${operation} as done.`,
      result,
      verification: { verified: false, evidence: [...evidence, 'The wait reached the operation bound before the job reached a terminal state.'] },
    };
  }
  if (job.state === 'failed') {
    throw new Error(`The deployment adapter reported the ${operation} job ${job.jobId} failed: ${job.error ?? 'no reason given'}.`);
  }
  const verified = job.state === 'succeeded' && job.releaseAfter !== null && job.releaseAfter === expectedRelease;
  return {
    summary: verified
      ? `The ${operation} completed: release ${releaseLabel(job.releaseAfter)} is serving after the adapter's health-checked cutover.`
      : `The adapter reported the ${operation} job succeeded but the serving release (${releaseLabel(job.releaseAfter)}) does not match the expected ${releaseLabel(expectedRelease)}.`,
    result,
    verification: { verified, evidence },
  };
}

const HANDLERS: Record<string, Handler> = {
  'explorer.capabilities.refresh': {
    async buildPreview() {
      return preview({
        target: target('capabilities'),
        preconditions: [satisfied('always-available', 'Capability probes are always available')],
        effects: ['Runs one probe per capability and rewrites the cached report.'],
        expectedPostconditions: ['The capability report carries a timestamp newer than the request.'],
        reversible: true,
      });
    },
    async execute() {
      const before = Date.now();
      // Dropping the cache is what makes this a probe rather than a read.
      (capabilities as unknown as { cached: unknown }).cached = null;
      const report = await capabilities.$report();
      const features = Object.keys(report.features);
      const notReady = features.filter((feature) => report.features[feature].state !== 'ready');
      return {
        summary: `Reprobed ${features.length} capabilities. ${notReady.length} are not ready.`,
        result: { features: features.length, notReady, generatedAt: report.generatedAt },
        verification: {
          verified: new Date(report.generatedAt).getTime() >= before,
          evidence: [`The capability report is stamped ${report.generatedAt}.`],
        },
      };
    },
  },

  'explorer.dependencies.recheck': {
    async buildPreview() {
      return preview({
        target: target('dependencies'),
        preconditions: [satisfied('always-available', 'Dependency probes are always available')],
        effects: ['Opens one probe request per configured dependency.'],
        expectedPostconditions: ['Each configured dependency has a fresh reachability result.'],
        reversible: true,
      });
    },
    async execute() {
      const result: ExplorerHandlerResult['result'] = {};
      try {
        result.bitcoinCoreHeight = await bitcoinClient.getBlockCount();
      } catch {
        result.bitcoinCoreHeight = null;
      }
      if (config.DATABASE.ENABLED) {
        try {
          await DB.query('SELECT 1');
          result.database = 'answered';
        } catch {
          result.database = 'did not answer';
        }
      } else {
        result.database = 'disabled';
      }
      result.redis = config.REDIS.ENABLED
        ? (redisCache as unknown as { connected?: boolean }).connected === true
          ? 'connected'
          : 'not connected'
        : 'disabled';
      const answered = Object.values(result).filter(
        (value) => value !== null && value !== 'did not answer' && value !== 'not connected',
      ).length;
      return {
        summary: `${answered} of ${Object.keys(result).length} dependencies answered.`,
        result,
        verification: {
          verified: true,
          evidence: ['Every configured dependency was probed with a real request.'],
        },
      };
    },
  },

  'explorer.address-index.probe': {
    async buildPreview() {
      return preview({
        target: target('address-index'),
        preconditions: [
          capabilities.addressLookupEnabled()
            ? satisfied('address-index', 'An address index is configured')
            : unsatisfied(
                'address-index',
                'An address index is configured',
                'This deployment has no address index, so there is nothing to probe.',
              ),
        ],
        effects: ['Issues one address query and one UTXO query.'],
        expectedPostconditions: ['The address capability carries a fresh probe result.'],
        reversible: true,
      });
    },
    async execute() {
      const chainSync = backendInfo.getBackendInfo().chainSync;
      const chainTip = typeof chainSync?.blocks === 'number' ? chainSync.blocks : null;
      let probe: Awaited<ReturnType<typeof $probeAddressIndex>>;
      try {
        probe = await $probeAddressIndex(chainTip);
      } catch {
        // The probe is written not to throw, so reaching here means something
        // outside it did. Report that, rather than failing the whole run with
        // an error the operator cannot act on.
        const unproven: ExplorerHandlerResult = {
          summary: 'The address index probe could not be run.',
          result: {
            configured: false,
            reachable: false,
            summaryAnswered: false,
            utxoAnswered: false,
            indexedTip: null,
            bitcoinCoreTip: chainTip,
          },
          verification: {
            verified: false,
            evidence: ['The probe itself failed, so nothing about the index was proven.'],
          },
        };
        return unproven;
      }
      const usable = probe.reachable && probe.summaryAnswered && probe.utxoAnswered;
      return {
        summary: usable
          ? 'The address index answered both an address query and a UTXO query.'
          : 'The address index did not return a usable answer.',
        result: {
          configured: probe.configured,
          reachable: probe.reachable,
          summaryAnswered: probe.summaryAnswered,
          utxoAnswered: probe.utxoAnswered,
          indexedTip: probe.indexedTip ?? null,
          bitcoinCoreTip: chainTip,
        },
        verification: {
          verified: usable,
          evidence: usable
            ? ['Both an address query and a UTXO query returned a usable document.']
            : ['The probe ran, but the index did not return a usable document.'],
        },
      };
    },
  },

  'explorer.release.verify': {
    async buildPreview() {
      return preview({
        target: target('release'),
        preconditions: [satisfied('always-available', 'Release identity is always readable')],
        effects: ['Reads two release identifiers. Changes nothing.'],
        expectedPostconditions: ['The two release identities are compared and the result recorded.'],
        reversible: true,
      });
    },
    async execute() {
      const backendSha = releaseShaOrNull(backendInfo.getBackendInfo().gitCommit);
      const frontendSha = releaseShaOrNull(process.env.UNIVERSE_FRONTEND_RELEASE_SHA);
      const known = backendSha !== null && frontendSha !== null;
      const matched = known && backendSha === frontendSha;
      return {
        summary: !known
          ? 'One of the two release identities could not be read, so drift cannot be ruled out.'
          : matched
            ? 'The frontend and backend were built from the same commit.'
            : 'The frontend and backend were built from different commits.',
        result: { backendSha, frontendSha, matched },
        verification: {
          verified: known,
          evidence: known
            ? [`backend ${backendSha}, frontend ${frontendSha}`]
            : ['At least one release identity is unknown, so nothing was proven.'],
        },
      };
    },
  },

  'explorer.smoke.run': {
    async buildPreview() {
      return preview({
        target: target('smoke'),
        preconditions: [satisfied('always-available', 'Smoke checks are always available')],
        effects: ['Issues the same reads a visitor would. Changes nothing.'],
        expectedPostconditions: ['Every smoke check recorded a pass or an exact failure reason.'],
        reversible: true,
      });
    },
    async execute() {
      const failures: string[] = [];
      const report = await capabilities.$report();
      const requiredFeatures = ['addressLookup'];
      for (const feature of requiredFeatures) {
        const entry = report.features[feature];
        if (!entry || entry.state !== 'ready') {
          failures.push(
            `${feature} reports ${entry ? entry.state : 'nothing'}: ${entry?.degradedReason ?? 'no reason given'}`,
          );
        }
      }
      const height = blocks.getCurrentBlockHeight();
      if (height <= 0) {
        failures.push('No block has been processed, so the site would show no chain tip.');
      }
      const sync = backendInfo.getBackendInfo().chainSync;
      if (sync?.initialBlockDownload) {
        failures.push('Bitcoin Core is still in initial block download, so every height is behind.');
      }
      const mempoolSize = Object.keys(memPool.getMempool()).length;
      return {
        summary:
          failures.length === 0
            ? 'Every smoke check passed.'
            : `${failures.length} smoke checks failed.`,
        result: {
          blockHeight: height,
          mempoolTransactions: mempoolSize,
          failures,
        },
        verification: {
          verified: failures.length === 0,
          evidence:
            failures.length === 0
              ? ['Capabilities, chain tip and mempool all answered a usable result.']
              : failures,
        },
      };
    },
  },

  'explorer.runs.reconcile': {
    async buildPreview() {
      return preview({
        target: target('runs'),
        preconditions: [databasePrecondition()],
        effects: ['Rewrites the state of runs whose lease expired.'],
        expectedPostconditions: ['No run is left in a running state with an expired lease.'],
        reversible: false,
      });
    },
    async execute() {
      const outcome = await runStore.reconcileAbandonedRuns();
      const verified = outcome.verified && outcome.error === undefined && outcome.remaining === 0;
      return {
        summary: outcome.error !== undefined
          ? `Reconciliation stopped on a storage error after ${outcome.reconciled} runs.`
          : (outcome.remaining ?? 0) > 0
            ? `${outcome.reconciled} abandoned runs were moved to NEEDS_REVIEW; ${outcome.remaining} remain.`
            : outcome.reconciled === 0
              ? 'No abandoned runs were found.'
              : `${outcome.reconciled} abandoned runs were moved to NEEDS_REVIEW.`,
        result: {
          reconciled: outcome.reconciled,
          remaining: outcome.remaining,
          storageError: outcome.error ?? null,
        },
        verification: {
          verified,
          evidence: verified
            ? ['The expired-lease query answered and no run with an expired lease remains.']
            : outcome.error !== undefined
              ? [`The run store answered with an error: ${outcome.error}`]
              : [`${outcome.remaining} runs with an expired lease still remain.`],
        },
      };
    },
  },

  'explorer.pools.refresh': {
    async buildPreview() {
      return preview({
        target: target('mining-pool-metadata'),
        preconditions: [databasePrecondition()],
        effects: ['Rewrites the stored pool definitions and their revision.'],
        expectedPostconditions: ['The pool metadata revision is recorded and the refresh time updated.'],
        warnings: ['Blocks attributed to a renamed pool are relabelled by the next indexing pass.'],
        reversible: false,
        durationSeconds: 60,
      });
    },
    async execute() {
      // The updater throttles itself to once a week. Clearing the marker is
      // what makes this an operator action rather than a no-op.
      (poolsUpdater as unknown as { lastRun: number }).lastRun = 0;
      await poolsUpdater.updatePoolsJson();
      const revision = (poolsUpdater as unknown as { currentSha: string | null }).currentSha;
      return {
        summary: revision
          ? `Pool metadata is at revision ${revision}.`
          : 'The pool metadata refresh finished without recording a revision.',
        result: { revision },
        verification: {
          verified: revision !== null,
          evidence: revision ? [`The updater recorded revision ${revision}.`] : [],
        },
      };
    },
  },

  'explorer.prices.refresh': {
    async buildPreview() {
      return preview({
        target: target('price-feed'),
        preconditions: [
          config.FIAT_PRICE.ENABLED === true
            ? satisfied('prices-enabled', 'Fiat prices are enabled')
            : unsatisfied(
                'prices-enabled',
                'Fiat prices are enabled',
                'Fiat prices are switched off in this deployment.',
              ),
        ],
        effects: ['Writes one price row and updates the in-memory latest price.'],
        expectedPostconditions: ['The latest price is newer than it was before the request.'],
        reversible: false,
        durationSeconds: 15,
      });
    },
    async execute() {
      const before = priceUpdater.getLatestPrices() as unknown as { time?: number };
      await priceUpdater.$run();
      const after = priceUpdater.getLatestPrices() as unknown as { time?: number; USD?: number };
      const moved =
        typeof after?.time === 'number' &&
        (typeof before?.time !== 'number' || after.time > before.time);
      return {
        summary: moved
          ? 'The price feed produced a newer price.'
          : 'The price cycle ran but the stored price did not move.',
        result: { usd: typeof after?.USD === 'number' ? after.USD : null, at: after?.time ?? null },
        verification: {
          verified: moved,
          evidence: moved
            ? ['The stored price timestamp is newer than before the request.']
            : ['The stored price timestamp did not change, so nothing was proven.'],
        },
      };
    },
  },

  'explorer.indexer.task.run': {
    async buildPreview(input) {
      const task = String(input.task ?? '');
      return preview({
        target: target(`indexer/${task || 'unspecified'}`),
        preconditions: [
          (ALLOWED_INDEXER_TASKS as readonly string[]).includes(task)
            ? satisfied('task-allowlisted', 'The task is one this Explorer defines')
            : unsatisfied(
                'task-allowlisted',
                'The task is one this Explorer defines',
                `Only ${ALLOWED_INDEXER_TASKS.join(' and ')} can be run this way.`,
              ),
          databasePrecondition(),
        ],
        effects: [`Runs the ${task || 'selected'} indexing task once.`],
        expectedPostconditions: ['The task finished or recorded why it could not.'],
        warnings: ['A long task keeps the indexer busy and delays regular indexing.'],
        reversible: false,
        redactedInput: { task },
      });
    },
    async execute(context): Promise<ExplorerHandlerResult> {
      const task = String(context.input.task ?? '');
      if (!(ALLOWED_INDEXER_TASKS as readonly string[]).includes(task)) {
        throw new Error(`Only ${ALLOWED_INDEXER_TASKS.join(' and ')} can be run this way.`);
      }
      const outcome = await indexer.runSingleTask(task as AllowedIndexerTask);
      if (outcome.status === 'failed') {
        throw new Error(`The ${task} task failed: ${outcome.error ?? 'unknown error'}`);
      }
      if (outcome.status !== 'completed') {
        return {
          summary: `The ${task} task did not run: ${outcome.reason ?? outcome.status}.`,
          result: { task, status: outcome.status, reason: outcome.reason ?? null },
          verification: {
            verified: false,
            evidence: [`The indexer answered ${outcome.status}: ${outcome.reason ?? 'no reason given'}.`],
          },
        };
      }
      let checkpoint: Awaited<ReturnType<typeof readIndexerCheckpoint>>;
      try {
        checkpoint = await readIndexerCheckpoint(task as AllowedIndexerTask);
      } catch (e) {
        return {
          summary: `The ${task} task returned, but its persisted checkpoint could not be read.`,
          result: {
            task,
            status: outcome.status,
            startedAt: outcome.checkpoint?.startedAt ?? null,
            finishedAt: outcome.checkpoint?.finishedAt ?? null,
            checkpointError: e instanceof Error ? e.message : String(e),
          },
          verification: {
            verified: false,
            evidence: ['The checkpoint readback failed, so completion is unproven.'],
          },
        };
      }
      const verified = checkpoint.remaining === 0;
      return {
        summary: verified
          ? `The ${task} task completed and no block is left without its ${task} data.`
          : `The ${task} task returned but ${checkpoint.remaining} blocks are still missing ${task} data.`,
        result: {
          task,
          status: outcome.status,
          startedAt: outcome.checkpoint?.startedAt ?? null,
          finishedAt: outcome.checkpoint?.finishedAt ?? null,
          remaining: checkpoint.remaining,
          indexedTip: checkpoint.indexedTip,
        },
        verification: {
          verified,
          evidence: verified
            ? [`The database reports 0 blocks missing ${task} data; the newest indexed height is ${checkpoint.indexedTip ?? 'unknown'}.`]
            : [`The database still reports ${checkpoint.remaining} blocks missing ${task} data.`],
        },
      };
    },
  },

  'explorer.indexer.reindex': {
    async buildPreview() {
      return preview({
        target: target('indexer'),
        preconditions: [
          databasePrecondition(),
          config.MEMPOOL.INDEXING_BLOCKS_AMOUNT !== 0
            ? satisfied('indexing-enabled', 'Block indexing is enabled')
            : unsatisfied(
                'indexing-enabled',
                'Block indexing is enabled',
                'Block indexing is switched off in this deployment.',
              ),
        ],
        effects: ['Rewrites indexed block, hashrate and price rows as the loop catches up.'],
        expectedPostconditions: ['The indexing loop is scheduled to run.'],
        warnings: [
          'This can occupy the indexer and the database for hours on a deployment that is far behind.',
          'Mining and statistics pages can show gaps until the rebuild reaches the tip.',
        ],
        reversible: false,
        users: 'Mining and statistics pages can show gaps while the index rebuilds.',
        publicServices: 'Public routes stay available under sustained database load.',
      });
    },
    async execute(context) {
      if (String(context.input.confirmation ?? '') !== 'REINDEX EXPLORER BLOCKS') {
        throw new Error('This operation requires the exact typed confirmation.');
      }
      const scheduled = indexer.reindex();
      if (!scheduled) {
        throw new Error('The indexer refused the request because indexing is disabled in this deployment.');
      }
      return {
        summary: 'The indexing loop was released to run again. Indexing itself runs in the background and is not complete.',
        result: { scheduled, indexingCompleted: false },
        verification: {
          verified: true,
          evidence: ['The indexer accepted the request to run again; this proves scheduling, not completion.'],
        },
      };
    },
  },

  'explorer.service.restart': {
    async buildPreview() {
      const control = await probeControl();
      const current = control.state === 'ready' ? control.capabilities.currentRelease : null;
      return preview({
        target: target('service'),
        preconditions: [deploymentControlPrecondition('explorer.service.restart', control)],
        effects: [
          `Asks the deployment adapter to run the release tooling's health-checked cutover of release ${releaseLabel(current)}, restarting the backend and overlay units.`,
          'The run records the adapter job id before the restart replaces this process; the job is then polled to its terminal state.',
        ],
        expectedPostconditions: [`The adapter job succeeds and reports release ${releaseLabel(current)} serving from a new process.`],
        warnings: [
          'Every open WebSocket stream is dropped and has to reconnect.',
          'This process is the one being restarted: if the run record shows the job still running, read the job back from the adapter after the restart.',
        ],
        reversible: false,
        users: 'Every open WebSocket stream is dropped and reconnects.',
        publicServices:
          'The gateway keeps the public origin up while the backend and overlay restart; API routes answer errors until the new process passes the live verification.',
        durationSeconds: 120,
      });
    },
    /** @asyncUnsafe The route turns a rejection into a FAILED run. */
    async execute(context) {
      if (String(context.input.confirmation ?? '') !== 'RESTART EXPLORER BACKEND') {
        throw new Error('This operation requires the exact typed confirmation.');
      }
      // No shell, no unit name, no fallback: one signed request to the adapter.
      return driveDeployment('restart', 'explorer.service.restart', context, 600);
    },
  },

  'explorer.release.rollback': {
    async buildPreview() {
      const control = await probeControl();
      const capabilities = control.state === 'ready' ? control.capabilities : null;
      const journalTarget = capabilities ? rollbackTargetFromJournal(capabilities) : null;
      return preview({
        target: target('release'),
        preconditions: [deploymentControlPrecondition('explorer.release.rollback', control)],
        effects: [
          `Asks the deployment adapter to roll back from release ${releaseLabel(capabilities?.currentRelease ?? null)} to ${releaseLabel(journalTarget?.release ?? null)}, the previous release its journal verified${journalTarget ? ' at ' + journalTarget.verifiedAt : ''}.`,
          'The rollback runs through the release tooling and passes the live verification before it is reported done.',
        ],
        expectedPostconditions: [`The adapter job succeeds and reports release ${releaseLabel(journalTarget?.release ?? null)} serving.`],
        warnings: [
          'Rolling back healthy code because of a dependency incident makes things worse, not better.',
          'This process is replaced by the rollback: if the run record shows the job still running, read the job back from the adapter afterwards.',
        ],
        reversible: false,
        users: 'The site serves the previous build; every open WebSocket stream reconnects.',
        publicServices:
          'The gateway keeps the public origin up while the units restart on the previous release; API routes answer errors until it passes the live verification.',
        durationSeconds: 300,
      });
    },
    /** @asyncUnsafe The route turns a rejection into a FAILED run. */
    async execute(context) {
      if (String(context.input.confirmation ?? '') !== 'ROLL BACK EXPLORER RELEASE') {
        throw new Error('This operation requires the exact typed confirmation.');
      }
      return driveDeployment('rollback', 'explorer.release.rollback', context, 900);
    },
  },
};

function withHandler(definition: AdminOperationDefinition): ExplorerOperation {
  const handler = HANDLERS[definition.id];
  if (!handler) {
    throw new Error(`Operation ${definition.id} has no handler.`);
  }
  return { ...definition, buildPreview: handler.buildPreview, execute: handler.execute };
}

export function listExplorerOperations(): ExplorerOperation[] {
  return explorerOperationDefinitions().map(withHandler);
}

export function findExplorerOperation(operationId: string): ExplorerOperation {
  return withHandler(findExplorerOperationDefinition(operationId));
}

export { deploymentControlConfigured, DEPLOYMENT_CONTROL_REASON };
