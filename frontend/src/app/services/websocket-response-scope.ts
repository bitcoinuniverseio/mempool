import { WebsocketResponse } from '@interfaces/websocket.interface';
import { feeNetwork } from './fee-estimate';

/** Explicit identity contradictions reject the entire frame before ingress. */
export function websocketResponseMatchesScope(response: WebsocketResponse, network: string): boolean {
  const expected = feeNetwork(network);
  const record = response as WebsocketResponse & { chain?: unknown; network?: unknown };
  for (const claim of [record, response.feeEstimate, response.liveObservation]) {
    if (!claim) continue;
    if (typeof claim.network === 'string' && claim.network !== expected) return false;
    if (typeof claim.chain === 'string' && claim.chain !== 'bitcoin' &&
        ['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(expected)) return false;
  }
  const sync = response.backendInfo?.chainSync as { chain?: unknown; network?: unknown };
  if (sync) {
    if (typeof sync.network === 'string' && sync.network !== expected) return false;
    if (typeof sync.chain === 'string' && ['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(expected)) {
      const core = { main: 'mainnet', test: 'testnet', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' };
      if (core[sync.chain] !== expected) return false;
    }
  }
  return true;
}
