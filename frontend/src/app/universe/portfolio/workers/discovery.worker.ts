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
import { derivePublicAddress } from '../../intelligence-platform/watchlist-descriptor-runtime';
import { looksSecretLike } from '../shared/secret-detection';

export type DiscoveryRequest =
  | { readonly id: number; readonly op: 'descriptor-batch'; readonly descriptor: string; readonly testnet: boolean; readonly start: number; readonly count: number }
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
    if (request.op === 'derive-batch' || request.op === 'descriptor-batch') {
      if (!Number.isSafeInteger(request.start) || request.start < 0 || !Number.isSafeInteger(request.count)
        || request.count < 1 || request.count > 20 || request.start + request.count > 0x80000000) throw Error('Invalid bounded derivation range');
    }
    if (request.op === 'descriptor-batch') {
      const descriptor = classifyDescriptor(request.descriptor, request.testnet);
      if (!descriptor || descriptor.checksumValid !== true || descriptor.multipath || looksSecretLike(request.descriptor).secret) throw Error('A checksummed public single-path descriptor is required');
      const ranged = request.descriptor.includes('*');
      if (!ranged && (request.start !== 0 || request.count !== 1)) throw Error('A fixed descriptor has one output');
      const addresses = Array.from({ length: request.count }, (_, offset) => ({ index: request.start + offset,
        address: derivePublicAddress(request.descriptor, request.start + offset, request.testnet) }));
      workerScope.postMessage({ id: request.id, ok: true, addresses });
      return;
    }
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
