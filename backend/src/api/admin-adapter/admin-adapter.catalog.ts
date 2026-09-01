import type {
  AdminEnvironment,
  AdminOperationDefinition,
} from '@bitcoinuniverse/ecosystem-contracts/admin-control';

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

export const DEPLOYMENT_CONTROL_ENVIRONMENT_VARIABLE = 'EXPLORER_DEPLOYMENT_CONTROL';

export const DEPLOYMENT_CONTROL_REASON =
  'Host-level deployment control is not enabled for this process. An operator has to configure the deployment adapter and set EXPLORER_DEPLOYMENT_CONTROL=enabled before the Control Center can restart or roll back this Explorer.';

/** Operations that cannot run without host-level deployment control. */
export const DEPLOYMENT_CONTROLLED_OPERATIONS = [
  'explorer.service.restart',
  'explorer.release.rollback',
];

/** The two indexing tasks this Explorer defines. Nothing else is accepted. */
export const ALLOWED_INDEXER_TASKS = ['blocksPrices', 'coinStatsIndex'] as const;
export type AllowedIndexerTask = (typeof ALLOWED_INDEXER_TASKS)[number];

export function deploymentControlConfigured(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return String(environment[DEPLOYMENT_CONTROL_ENVIRONMENT_VARIABLE] ?? '').trim() === 'enabled';
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
    sideEffects: ['Stops and starts the Explorer backend process.'],
    postconditions: ['The Explorer answers its capability route again from a new process.'],
    timeoutSeconds: 120,
    retryPolicy: 'none',
    lock: 'explorer:service:restart',
    userImpact: 'Every open WebSocket stream is dropped and reconnects.',
    publicServiceImpact: 'The Explorer is unreachable for the length of the restart.',
  }),
  definition({
    id: 'explorer.release.rollback',
    version: '1',
    resourceKind: 'release',
    action: 'rollback',
    name: 'Roll back to the previous verified Explorer release',
    description:
      'Asks the operator-controlled deployment adapter to put the previous verified release back in service. The target release comes from the recorded promotion journal, never from this request.',
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
    timeoutSeconds: 600,
    retryPolicy: 'none',
    lock: 'explorer:release:rollback',
    userImpact: 'The site briefly serves the previous build.',
    publicServiceImpact: 'A short interruption while the switch happens.',
  }),
];

/**
 * The catalog, with the availability of the deployment-controlled operations
 * recomputed on every call. Host configuration can change between restarts,
 * and an operation that is unavailable stays visible with the exact reason
 * rather than disappearing from the panel.
 */
export function explorerOperationDefinitions(
  environment: Record<string, string | undefined> = process.env,
): AdminOperationDefinition[] {
  const enabled = deploymentControlConfigured(environment);
  return DEFINITIONS.map((operation) =>
    DEPLOYMENT_CONTROLLED_OPERATIONS.includes(operation.id)
      ? {
          ...operation,
          availability: enabled ? ('enabled' as const) : ('not_configured' as const),
          availabilityReason: enabled ? null : DEPLOYMENT_CONTROL_REASON,
        }
      : operation,
  );
}

export function findExplorerOperationDefinition(
  operationId: string,
  environment: Record<string, string | undefined> = process.env,
): AdminOperationDefinition {
  const found = explorerOperationDefinitions(environment).find(
    (operation) => operation.id === operationId,
  );
  if (!found) {
    throw new Error(`Unknown operation ${operationId}.`);
  }
  return found;
}
