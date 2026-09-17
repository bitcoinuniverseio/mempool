import type {
  AdminEnvironment,
  AdminOperationDefinition,
} from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import {
  DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE,
  DEPLOYMENT_CONTROL_KEY_VARIABLE,
  deploymentControlClient,
  deploymentControlConfig,
  rollbackTargetFromJournal,
  type DeploymentControlState,
} from './deployment-control.client';

/**
 * What the Control Center may ask this Explorer to do, described without
 * touching the runtime.
 *
 * The descriptors live apart from the handlers on purpose: this file can be
 * read, tested and reviewed without starting a database pool, a price timer or
 * an indexing loop, and a reviewer can see the entire mutable surface of the
 * Explorer in one place.
 *
 * Nothing here accepts a shell command, an RPC method, a SQL statement, a
 * filesystem path, a service unit name, or a URL from the caller.
 */

const ALL_ENVIRONMENTS: AdminEnvironment[] = [
  'production',
  'staging',
  'test',
  'development',
];

export const DEPLOYMENT_CONTROL_ENVIRONMENT_VARIABLES = [
  DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE,
  DEPLOYMENT_CONTROL_KEY_VARIABLE,
] as const;

export const DEPLOYMENT_CONTROL_REASON =
  `Host-level deployment control is not configured for this process. An operator has to run the owned deployment adapter on this host and set ${DEPLOYMENT_CONTROL_ENDPOINT_VARIABLE} and ${DEPLOYMENT_CONTROL_KEY_VARIABLE} before the Control Center can restart or roll back this Explorer.`;

/** Operations that cannot run without host-level deployment control. */
export const DEPLOYMENT_CONTROLLED_OPERATIONS = [
  'explorer.service.restart',
  'explorer.release.rollback',
];

/** The two indexing tasks this Explorer defines. Nothing else is accepted. */
export const ALLOWED_INDEXER_TASKS = ['blocksPrices', 'coinStatsIndex'] as const;
export type AllowedIndexerTask = (typeof ALLOWED_INDEXER_TASKS)[number];

/** Whether the adapter is named at all. Configured is not ready: readiness is what the adapter answers. */
export function deploymentControlConfigured(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  try {
    return deploymentControlConfig(environment) !== null;
  } catch {
    return false;
  }
}

/**
 * The availability of one deployment-controlled operation, from what the
 * adapter has actually answered. A flag cannot make this 'enabled'; only a
 * capability document that supports the action can, and for a rollback the
 * journal has to hold a previous verified release as well.
 */
export function deploymentControlAvailability(
  operationId: string,
  control: DeploymentControlState,
): { availability: AdminOperationDefinition['availability']; availabilityReason: string | null } {
  if (control.state === 'unconfigured') {
    return { availability: 'not_configured', availabilityReason: control.reason };
  }
  if (control.state === 'unprobed' || control.state === 'unreachable') {
    return { availability: 'unavailable', availabilityReason: control.reason };
  }
  const { capabilities } = control;
  if (operationId === 'explorer.service.restart') {
    return capabilities.supports.restart
      ? { availability: 'enabled', availabilityReason: null }
      : { availability: 'unavailable', availabilityReason: capabilities.reasons.restart ?? 'The deployment adapter does not support a restart on this host.' };
  }
  if (operationId === 'explorer.release.rollback') {
    if (!capabilities.supports.rollback) {
      return { availability: 'unavailable', availabilityReason: capabilities.reasons.rollback ?? 'The deployment adapter does not support a rollback on this host.' };
    }
    if (!rollbackTargetFromJournal(capabilities)) {
      return { availability: 'unavailable', availabilityReason: 'The deployment adapter journal holds no previous verified release to roll back to.' };
    }
    return { availability: 'enabled', availabilityReason: null };
  }
  return { availability: 'enabled', availabilityReason: null };
}

function definition(
  partial: Pick<
    AdminOperationDefinition,
    | 'id'
    | 'version'
    | 'resourceKind'
    | 'action'
    | 'name'
    | 'description'
    | 'risk'
    | 'requiredPermission'
    | 'sideEffects'
    | 'postconditions'
  > &
    Partial<AdminOperationDefinition>,
): AdminOperationDefinition {
  return {
    application: 'explorer',
    environments: ALL_ENVIRONMENTS,
    networks: [],
    availability: 'enabled',
    availabilityReason: null,
    inputFields: [],
    preview: true,
    idempotent: true,
    cancellable: false,
    rollbackSupported: false,
    retryPolicy: 'manual',
    timeoutSeconds: 60,
    concurrency: 'exclusive-global',
    lock: `explorer:${partial.id}`,
    redactedFields: [],
    userImpact: 'None.',
    publicServiceImpact: 'Public Explorer routes stay available.',
    runbook: null,
    ...partial,
  } as AdminOperationDefinition;
}

const DEFINITIONS: AdminOperationDefinition[] = [
  definition({
    id: 'explorer.capabilities.refresh',
    version: '1',
    resourceKind: 'service',
    action: 'refresh-capabilities',
    name: 'Refresh capability probes',
    description:
      'Discards the cached capability report and rebuilds it from live probes, so every feature state on the panel is current rather than up to ten seconds old.',
    risk: 'SAFE',
    requiredPermission: 'operate.safe',
    sideEffects: ['Runs one probe per capability and rewrites the cached report.'],
    postconditions: ['The capability report carries a timestamp newer than the request.'],
    timeoutSeconds: 30,
  }),
  definition({
    id: 'explorer.dependencies.recheck',
    version: '1',
    resourceKind: 'dependency',
    action: 'recheck',
    name: 'Recheck every dependency',
    description:
      'Probes Bitcoin Core, the database and Redis with a real request each and reports which of them answered.',
    risk: 'SAFE',
    requiredPermission: 'operate.safe',
    sideEffects: ['Opens one probe request per configured dependency.'],
    postconditions: ['Each configured dependency has a fresh reachability result.'],
    timeoutSeconds: 30,
  }),
  definition({
    id: 'explorer.address-index.probe',
    version: '1',
    resourceKind: 'indexer',
    action: 'probe',
    name: 'Probe the address index',
    description:
      'Runs a real address query, a real UTXO query and a height comparison against Bitcoin Core. A listening port is not treated as readiness.',
    risk: 'SAFE',
    requiredPermission: 'operate.safe',
    sideEffects: ['Issues one address query and one UTXO query.'],
    postconditions: ['The address capability carries a fresh probe result.'],
    timeoutSeconds: 30,
  }),
  definition({
    id: 'explorer.release.verify',
    version: '1',
    resourceKind: 'release',
    action: 'verify',
    name: 'Verify frontend and backend release identity',
    description:
      'Compares the commit this backend was built from against the commit the served frontend declares, so a half-finished deploy is visible instead of silent.',
    risk: 'SAFE',
    requiredPermission: 'operate.safe',
    sideEffects: ['Reads two release identifiers. Changes nothing.'],
    postconditions: ['The two release identities are compared and the result recorded.'],
    timeoutSeconds: 15,
  }),
  definition({
    id: 'explorer.smoke.run',
    version: '1',
    resourceKind: 'service',
    action: 'smoke',
    name: 'Run the deployment smoke checks',
    description:
      'Reads the capability report, the chain tip and the mempool through the same paths a visitor uses, and reports which of them answered a usable result.',
    risk: 'SAFE',
    requiredPermission: 'operate.safe',
    sideEffects: ['Issues the same reads a visitor would. Changes nothing.'],
    postconditions: ['Every smoke check recorded a pass or an exact failure reason.'],
    timeoutSeconds: 60,
  }),
  definition({
    id: 'explorer.runs.reconcile',
    version: '1',
    resourceKind: 'run',
    action: 'reconcile',
    name: 'Reconcile abandoned operation runs',
    description:
      'Moves runs whose lease expired without finishing to NEEDS_REVIEW, so a restart during an operation leaves a reviewable record instead of a spinner.',
    risk: 'SAFE',
    requiredPermission: 'operate.safe',
    sideEffects: ['Rewrites the state of runs whose lease expired.'],
    postconditions: ['No run is left in a running state with an expired lease.'],
    timeoutSeconds: 30,
    lock: 'explorer:runs:reconcile',
  }),
  definition({
    id: 'explorer.pools.refresh',
    version: '1',
    resourceKind: 'dependency',
    action: 'refresh-pools',
    name: 'Refresh mining pool metadata',
    description:
      'Re-reads the mining pool definition file so block attribution uses current pool data.',
    risk: 'GUARDED',
    requiredPermission: 'operate.guarded',
    sideEffects: ['Rewrites the stored pool definitions and their revision.'],
    postconditions: ['The pool metadata revision is recorded and the refresh time updated.'],
    timeoutSeconds: 120,
    lock: 'explorer:pools:refresh',
  }),
  definition({
    id: 'explorer.prices.refresh',
    version: '1',
    resourceKind: 'dependency',
    action: 'refresh-prices',
    name: 'Refresh fiat prices',
    description: 'Runs one price update cycle now instead of waiting for its timer.',
    risk: 'GUARDED',
    requiredPermission: 'operate.guarded',
    sideEffects: ['Writes one price row and updates the in-memory latest price.'],
    postconditions: ['The latest price is newer than it was before the request.'],
    timeoutSeconds: 60,
    lock: 'explorer:prices:refresh',
  }),
  definition({
    id: 'explorer.indexer.task.run',
    version: '1',
    resourceKind: 'indexer',
    action: 'run-task',
    name: 'Run one indexing task now',
    description:
      'Runs a single allowlisted indexing task immediately. Only the two task names this Explorer defines are accepted.',
    risk: 'GUARDED',
    requiredPermission: 'operate.guarded',
    inputFields: [
      {
        name: 'task',
        label: 'Task',
        type: 'select',
        required: true,
        options: [...ALLOWED_INDEXER_TASKS],
        help: null,
        sensitive: false,
        pattern: null,
      },
    ],
    sideEffects: ['Writes the rows that task produces.'],
    postconditions: ['The task finished or recorded why it could not.'],
    timeoutSeconds: 900,
    lock: 'explorer:indexer:task',
  }),
  definition({
    id: 'explorer.indexer.reindex',
    version: '1',
    resourceKind: 'indexer',
    action: 'reindex',
    name: 'Restart block indexing from the beginning of its schedule',
    description:
      'Clears the indexer backoff and lets the indexing loop run again immediately. On a deployment that is far behind, this can occupy the indexer and the database for hours.',
    risk: 'HIGH_RISK',
    requiredPermission: 'operate.high_risk',
    inputFields: [
      {
        name: 'confirmation',
        label: 'Typed confirmation',
        type: 'text',
        required: true,
        options: [],
        help: 'Type: REINDEX EXPLORER BLOCKS',
        sensitive: false,
        pattern: null,
      },
    ],
    sideEffects: ['Rewrites indexed block, hashrate and price rows as the loop catches up.'],
    postconditions: ['The indexing loop is scheduled to run.'],
    timeoutSeconds: 60,
    retryPolicy: 'none',
    lock: 'explorer:indexer:reindex',
    userImpact: 'Mining and statistics pages can show gaps while the index rebuilds.',
    publicServiceImpact:
      'Public routes stay available, but the database is under sustained load for the duration.',
  }),
  definition({
    id: 'explorer.service.restart',
    version: '1',
    resourceKind: 'service',
    action: 'restart',
    name: 'Restart the Explorer backend',
    description:
      'Restarts the approved Explorer service unit through the operator-controlled deployment adapter. The unit name is fixed on the host and can never be supplied here.',
    risk: 'HIGH_RISK',
    requiredPermission: 'operate.high_risk',
    inputFields: [
      {
        name: 'confirmation',
        label: 'Typed confirmation',
        type: 'text',
        required: true,
        options: [],
        help: 'Type: RESTART EXPLORER BACKEND',
        sensitive: false,
        pattern: null,
      },
    ],
    sideEffects: ['Runs the release tooling\'s health-checked cutover of the current release, which restarts the backend and overlay units and verifies the live origin.'],
    postconditions: ['The deployment adapter reports the job succeeded with the same release serving from a new process.'],
    timeoutSeconds: 600,
    retryPolicy: 'none',
    lock: 'explorer:service:restart',
    userImpact: 'Every open WebSocket stream is dropped and reconnects.',
    publicServiceImpact:
      'The gateway keeps the public origin up while the backend and overlay restart; API routes answer errors until the new process passes the live verification.',
  }),
  definition({
    id: 'explorer.release.rollback',
    version: '1',
    resourceKind: 'release',
    action: 'rollback',
    name: 'Roll back to the previous verified Explorer release',
    description:
      'Asks the operator-controlled deployment adapter to put the previous verified release back in service through the release tooling\'s health-checked rollback. The target release comes from the adapter\'s promotion journal, never from this request.',
    risk: 'IRREVERSIBLE',
    requiredPermission: 'operate.irreversible',
    inputFields: [
      {
        name: 'confirmation',
        label: 'Typed confirmation',
        type: 'text',
        required: true,
        options: [],
        help: 'Type: ROLL BACK EXPLORER RELEASE',
        sensitive: false,
        pattern: null,
      },
    ],
    sideEffects: ['Replaces the running Explorer release with the previous verified one.'],
    postconditions: ['The Explorer reports the previous verified release sha.'],
    timeoutSeconds: 900,
    retryPolicy: 'none',
    lock: 'explorer:release:rollback',
    userImpact: 'The site serves the previous build; every open WebSocket stream reconnects.',
    publicServiceImpact:
      'The gateway keeps the public origin up while the units restart on the previous release; API routes answer errors until it passes the live verification.',
  }),
];

/**
 * The catalog, with the availability of the deployment-controlled operations
 * recomputed on every call from what the deployment adapter last answered.
 * Host configuration can change between restarts, and an operation that is
 * unavailable stays visible with the exact reason rather than disappearing
 * from the panel.
 */
export function explorerOperationDefinitions(
  environment: Record<string, string | undefined> = process.env,
  control: DeploymentControlState = environment === process.env
    ? deploymentControlClient.known()
    : deploymentControlConfigured(environment)
      ? { state: 'unprobed', reason: 'The deployment adapter is configured but has not answered its capability route yet.', capabilities: null, probedAt: null }
      : { state: 'unconfigured', reason: DEPLOYMENT_CONTROL_REASON, capabilities: null, probedAt: null },
): AdminOperationDefinition[] {
  return DEFINITIONS.map((operation) =>
    DEPLOYMENT_CONTROLLED_OPERATIONS.includes(operation.id)
      ? { ...operation, ...deploymentControlAvailability(operation.id, control) }
      : operation,
  );
}

export function findExplorerOperationDefinition(
  operationId: string,
  environment: Record<string, string | undefined> = process.env,
  control?: DeploymentControlState,
): AdminOperationDefinition {
  const found = explorerOperationDefinitions(environment, control).find(
    (operation) => operation.id === operationId,
  );
  if (!found) {
    throw new Error(`Unknown operation ${operationId}.`);
  }
  return found;
}
