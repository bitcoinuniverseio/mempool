/**
 * The discovery worker: watch-only address derivation off the main thread.
 *
 * Receives batches of "derive these indexes from this xpub" and
 * "parse/verify this descriptor" requests. The gap-limit scan itself runs
 * in the service - it owns the network reads - but every derivation
 * happens here so a 200-index scan never blocks a paint.
 */

import {
  classifyDescriptor,
  classifyExtendedKey,
  deriveAddressBatch,
  type DeriveBatchResult,
} from '../shared/derivation';

export type DiscoveryRequest =
  | {
      readonly id: number;
      readonly op: 'derive-batch';
      readonly key: string;
      readonly script: 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';
      readonly testnet: boolean;
      readonly branch: 'external' | 'internal';
      readonly start: number;
      readonly count: number;
    }
  | {
      readonly id: number;
      readonly op: 'classify';
      readonly input: string;
      readonly testnet: boolean;
    };

export type DiscoveryResponse =
  | ({ readonly id: number; readonly ok: true } & DeriveBatchResult)
  | {
      readonly id: number;
      readonly ok: true;
      readonly op: 'classify';
      readonly result: unknown;
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** The worker scope, typed locally so the DOM lib stays the only lib. */
const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<DiscoveryRequest>) => void): void;
  postMessage(message: DiscoveryResponse): void;
};

workerScope.addEventListener('message', (event: MessageEvent<DiscoveryRequest>) => {
  const request = event.data;
  try {
    if (request.op === 'derive-batch') {
      const result = deriveAddressBatch(request);
      const response: DiscoveryResponse = { id: request.id, ok: true, ...result };
      workerScope.postMessage(response);
      return;
    }
    const extended = classifyExtendedKey(request.input);
    const descriptor = extended === null ? classifyDescriptor(request.input, request.testnet) : null;
    const response: DiscoveryResponse = {
      id: request.id,
      ok: true,
      op: 'classify',
      result: extended ?? descriptor,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: DiscoveryResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Derivation failed.',
    };
    workerScope.postMessage(response);
  }
});
