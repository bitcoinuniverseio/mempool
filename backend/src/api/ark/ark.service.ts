import {
  ArkBatch,
  ArkOperator,
  ArkVirtualTx,
  ArkVtxo,
} from './ark.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class ArkEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

export interface ArkProofVerdict {
  readonly valid: boolean;
  readonly stage: 'invalid-input' | 'unavailable-verifier';
  readonly error: string;
}

const aspUnavailable =
  'Ark observations are unavailable. Operator, batch, VTXO and virtual-transaction reads require the owned Ark service provider (arkd) with its Bitcoin anchor reader, which is not connected on this deployment.';

/**
 * Ark operator, round, VTXO and virtual-mempool evidence.
 *
 * Every read here needs an owned arkd whose round anchors are checked against
 * the owned Bitcoin reader. None is connected, so each read reports the absent
 * source. The revision this replaces answered from constants: one operator
 * marked online with an invented pubkey and volume, a settled batch whose
 * timestamps were computed at request time, a spendable VTXO, and a verifier
 * that called any proof path valid because an array length is never negative.
 */
export class ArkService {
  /** @asyncSafe */
  public async $getOperators(): Promise<ArkOperator[]> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $getBatches(): Promise<ArkBatch[]> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $getBatch(_batchId: string): Promise<ArkBatch | null> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $getVtxo(_vtxoId: string): Promise<ArkVtxo | null> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $getVirtualTxs(): Promise<ArkVirtualTx[]> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $verifyProof(vtxoId: unknown, proofPath: unknown): Promise<ArkProofVerdict> {
    if (typeof vtxoId !== 'string' || !vtxoId.trim()
      || !Array.isArray(proofPath) || proofPath.length === 0
      || !proofPath.every(hash => typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash))) {
      return { valid: false, stage: 'invalid-input', error: 'A VTXO ID and a nonempty array of 32-byte hexadecimal proof path hashes are required.' };
    }
    return {
      valid: false, stage: 'unavailable-verifier',
      error: 'The Ark exit proof verifier (owned arkd) and Bitcoin anchor reader are not connected. No VTXO tree path or batch root was verified.',
    };
  }
}

export const arkService = new ArkService();
