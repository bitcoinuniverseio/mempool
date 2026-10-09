/** Per-process limits for the two existing owned-node pools; no additional pool. */
export interface RpcPoolConfiguration {
  MAX_SOCKETS?: number;
  ADDRESS_MAX_SOCKETS?: number;
}

export function rpcPoolLimits(config: RpcPoolConfiguration): { bulk: number; address: number } {
  const bound = (value: number | undefined, fallback: number, maximum: number, name: string): number => {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} must be a safe integer between 1 and ${maximum}`);
    }
    return value;
  };
  return {
    bulk: bound(config.MAX_SOCKETS, 8, 8, 'CORE_RPC.MAX_SOCKETS'),
    address: bound(config.ADDRESS_MAX_SOCKETS, 4, 4, 'CORE_RPC.ADDRESS_MAX_SOCKETS'),
  };
}
