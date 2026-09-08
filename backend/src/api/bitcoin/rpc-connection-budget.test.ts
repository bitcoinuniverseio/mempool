import { allocateRpcSockets, EXPLORER_CORE_RPC_BUDGET } from './rpc-connection-budget';

function budgetConfig(overrides: Record<string, unknown> = {}): Parameters<typeof allocateRpcSockets>[0] {
  return {
    MEMPOOL: {
      NETWORK: 'mainnet',
      SPAWN_CLUSTER_PROCS: 0,
      USE_SECOND_NODE_FOR_MINFEE: false,
      ...(overrides.MEMPOOL as object),
    },
    CORE_RPC: {
      HOST: '127.0.0.1',
      PORT: 8332,
      MAX_SOCKETS: 8,
      ...(overrides.CORE_RPC as object),
    },
    SECOND_CORE_RPC: {
      HOST: '127.0.0.1',
      PORT: 8332,
      MAX_SOCKETS: 8,
      ...(overrides.SECOND_CORE_RPC as object),
    },
  };
}

describe('Explorer Core RPC connection budget', () => {
  it('never gives one process more than one quarter of production RPC workers', () => {
    expect(allocateRpcSockets(budgetConfig())).toEqual({
      primary: EXPLORER_CORE_RPC_BUDGET,
      secondary: EXPLORER_CORE_RPC_BUDGET,
      processCount: 1,
    });
    expect(allocateRpcSockets(budgetConfig({
      MEMPOOL: { SPAWN_CLUSTER_PROCS: 4 },
    }))).toMatchObject({ primary: 2, processCount: 4 });
  });

  it('shares one aggregate budget when both active clients target the same node', () => {
    expect(allocateRpcSockets(budgetConfig({
      MEMPOOL: { USE_SECOND_NODE_FOR_MINFEE: true },
    }))).toEqual({ primary: 7, secondary: 1, processCount: 1 });
  });

  it('rejects unsafe socket and process settings', () => {
    expect(() => allocateRpcSockets(budgetConfig({
      CORE_RPC: { MAX_SOCKETS: 9 },
    }))).toThrow('CORE_RPC.MAX_SOCKETS');
    expect(() => allocateRpcSockets(budgetConfig({
      CORE_RPC: { MAX_SOCKETS: 1 },
    }))).toThrow('CORE_RPC.MAX_SOCKETS');
    expect(() => allocateRpcSockets(budgetConfig({
      MEMPOOL: { SPAWN_CLUSTER_PROCS: 9 },
    }))).toThrow('MEMPOOL.SPAWN_CLUSTER_PROCS');
    expect(() => allocateRpcSockets(budgetConfig({
      MEMPOOL: {
        SPAWN_CLUSTER_PROCS: 4,
        USE_SECOND_NODE_FOR_MINFEE: true,
      },
    }))).toThrow('fewer than three RPC sockets');
    expect(() => allocateRpcSockets(budgetConfig({
      MEMPOOL: { SPAWN_CLUSTER_PROCS: 8 },
    }))).toThrow('no priority socket can be reserved');
  });
});
