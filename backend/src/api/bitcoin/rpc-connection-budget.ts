export const EXPLORER_CORE_RPC_BUDGET = 8;

interface RpcEndpoint {
  HOST: string;
  PORT: number;
  MAX_SOCKETS: number;
}

interface RpcBudgetConfig {
  MEMPOOL: {
    NETWORK: string;
    SPAWN_CLUSTER_PROCS: number;
    USE_SECOND_NODE_FOR_MINFEE: boolean;
  };
  CORE_RPC: RpcEndpoint;
  SECOND_CORE_RPC: RpcEndpoint;
}

export interface RpcSocketAllocation {
  primary: number;
  secondary: number;
  processCount: number;
}

function requestedSockets(label: string, value: number, minimum = 1): number {
  if (!Number.isInteger(value) || value < minimum || value > EXPLORER_CORE_RPC_BUDGET) {
    throw new Error(
      `${label}.MAX_SOCKETS must be an integer from ${minimum} to ${EXPLORER_CORE_RPC_BUDGET}`,
    );
  }
  return value;
}

function normalizedHost(host: string): string {
  const value = host.trim().toLowerCase();
  return ['localhost', '::1', '[::1]'].includes(value) ? '127.0.0.1' : value;
}

export function allocateRpcSockets(config: RpcBudgetConfig): RpcSocketAllocation {
  const configuredProcesses = config.MEMPOOL.SPAWN_CLUSTER_PROCS;
  const processCount = configuredProcesses === 0 ? 1 : configuredProcesses;
  if (!Number.isInteger(processCount) || processCount < 1 || processCount > EXPLORER_CORE_RPC_BUDGET) {
    throw new Error(
      `MEMPOOL.SPAWN_CLUSTER_PROCS must be 0 or an integer from 1 to ${EXPLORER_CORE_RPC_BUDGET} when Core RPC is enabled`,
    );
  }

  const primaryRequested = requestedSockets('CORE_RPC', config.CORE_RPC.MAX_SOCKETS, 2);
  const secondaryRequested = requestedSockets('SECOND_CORE_RPC', config.SECOND_CORE_RPC.MAX_SOCKETS);
  const perProcessBudget = Math.floor(EXPLORER_CORE_RPC_BUDGET / processCount);
  if (perProcessBudget < 2) {
    throw new Error(
      'MEMPOOL.SPAWN_CLUSTER_PROCS leaves fewer than two primary RPC sockets per process, so no priority socket can be reserved',
    );
  }
  const secondaryActive =
    config.MEMPOOL.USE_SECOND_NODE_FOR_MINFEE ||
    ['liquid', 'liquidtestnet'].includes(config.MEMPOOL.NETWORK);
  const sameNode =
    normalizedHost(config.CORE_RPC.HOST) === normalizedHost(config.SECOND_CORE_RPC.HOST) &&
    Number(config.CORE_RPC.PORT) === Number(config.SECOND_CORE_RPC.PORT);

  if (secondaryActive && sameNode) {
    if (perProcessBudget < 3) {
      throw new Error(
        'The active primary and secondary Core clients share one node but the process count leaves fewer than three RPC sockets per process',
      );
    }
    const secondary = Math.min(secondaryRequested, 1);
    return {
      primary: Math.min(primaryRequested, perProcessBudget - secondary),
      secondary,
      processCount,
    };
  }

  return {
    primary: Math.min(primaryRequested, perProcessBudget),
    secondary: Math.min(secondaryRequested, perProcessBudget),
    processCount,
  };
}
