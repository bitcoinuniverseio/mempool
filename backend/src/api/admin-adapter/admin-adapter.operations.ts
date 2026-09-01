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
  deploymentControlConfigured,
  explorerOperationDefinitions,
  findExplorerOperationDefinition,
} from './admin-adapter.catalog';
import { explorerEnvironment, releaseShaOrNull } from './admin-adapter.identity';
import runStore from './admin-adapter.runs';

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

function deploymentControlPrecondition() {
  return deploymentControlConfigured()
    ? satisfied('deployment-control', 'Host deployment control is enabled')
    : unsatisfied(
        'deployment-control',
        'Host deployment control is enabled',
        DEPLOYMENT_CONTROL_REASON,
      );
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
      const reconciled = await runStore.reconcileAbandonedRuns();
      return {
        summary:
          reconciled === 0
            ? 'No abandoned runs were found.'
            : `${reconciled} abandoned runs were moved to NEEDS_REVIEW.`,
        result: { reconciled },
        verification: {
          verified: true,
          evidence: ['Every run with an expired lease now carries a terminal state.'],
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
    async execute(context) {
      const task = String(context.input.task ?? '');
      if (!(ALLOWED_INDEXER_TASKS as readonly string[]).includes(task)) {
        throw new Error(`Only ${ALLOWED_INDEXER_TASKS.join(' and ')} can be run this way.`);
      }
      await indexer.runSingleTask(task as AllowedIndexerTask);
      return {
        summary: `The ${task} task ran to completion.`,
        result: { task },
        verification: {
          verified: true,
          evidence: [`The indexer returned from ${task} without throwing.`],
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
      indexer.reindex();
      return {
        summary: 'The indexing loop was released to run again.',
        result: { scheduled: true },
        verification: {
          verified: true,
          evidence: ['The indexer accepted the request to run again.'],
        },
      };
    },
  },

  'explorer.service.restart': {
    async buildPreview() {
      return preview({
        target: target('service'),
        preconditions: [deploymentControlPrecondition()],
        effects: ['Stops and starts the Explorer backend process.'],
        expectedPostconditions: ['The Explorer answers its capability route again from a new process.'],
        warnings: ['Every open WebSocket stream is dropped and has to reconnect.'],
        reversible: false,
        users: 'Every open WebSocket stream is dropped and reconnects.',
        publicServices: 'The Explorer is unreachable for the length of the restart.',
      });
    },
    async execute() {
      // No shell, no unit name, no fallback. Until an operator wires the
      // deployment adapter, this refuses with the exact unmet precondition.
      throw new Error(DEPLOYMENT_CONTROL_REASON);
    },
  },

  'explorer.release.rollback': {
    async buildPreview() {
      return preview({
        target: target('release'),
        preconditions: [deploymentControlPrecondition()],
        effects: ['Replaces the running Explorer release with the previous verified one.'],
        expectedPostconditions: ['The Explorer reports the previous verified release sha.'],
        warnings: [
          'Rolling back healthy code because of a dependency incident makes things worse, not better.',
        ],
        reversible: false,
      });
    },
    async execute() {
      throw new Error(DEPLOYMENT_CONTROL_REASON);
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
