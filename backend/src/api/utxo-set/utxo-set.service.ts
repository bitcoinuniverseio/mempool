import {
  ProtocolBearingUtxos,
  ScriptTypeDistribution,
  SupplyCohort,
  UtreexoRootsView,
  UtxoCheckpoint,
} from './utxo-set.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class UtxoSetEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

export interface UtreexoProofVerdict {
  readonly valid: boolean;
  readonly stage: 'invalid-input' | 'unavailable-verifier';
  readonly error: string;
}

const coinstatsUnavailable =
  'UTXO-set observations are unavailable. Checkpoint, distribution and protocol-bearing reads require the owned Bitcoin node with coinstatsindex (bitcoind RPC gettxoutsetinfo) and the owned UTXO cohort scanner, which are not connected on this deployment.';

const utreexoUnavailable =
  'Utreexo observations are unavailable. Accumulator roots require the owned utreexod bridge node, which is not connected on this deployment.';

/**
 * UTXO-set, supply-cohort and Utreexo evidence.
 *
 * Checkpoints and cohorts need the owned coinstatsindex node and a scanner
 * over its UTXO set; accumulator roots need an owned utreexod bridge. None is
 * connected, so each read reports the absent source. The revision this
 * replaces answered from constants: two checkpoints with invented MuHash
 * digests, cohort tables whose percentages summed by construction, protocol
 * counts nobody had scanned, three forest roots, and a verifier that called
 * any proof valid because an array length is never negative.
 */
export class UtxoSetService {
  /** @asyncSafe */
  public async $getCheckpoints(): Promise<UtxoCheckpoint[]> {
    throw new UtxoSetEvidenceError('unavailable-coinstatsindex', coinstatsUnavailable);
  }

  /** @asyncSafe */
  public async $getDistribution(): Promise<{ valueCohorts: SupplyCohort[]; scriptTypes: ScriptTypeDistribution[] }> {
    throw new UtxoSetEvidenceError('unavailable-coinstatsindex', coinstatsUnavailable);
  }

  /** @asyncSafe */
  public async $getProtocolUtxos(): Promise<ProtocolBearingUtxos> {
    throw new UtxoSetEvidenceError('unavailable-coinstatsindex', coinstatsUnavailable);
  }

  /** @asyncSafe */
  public async $getUtreexoRoots(): Promise<UtreexoRootsView> {
    throw new UtxoSetEvidenceError('unavailable-utreexo-bridge', utreexoUnavailable);
  }

  /** @asyncSafe */
  public async $verifyUtreexoProof(proof: unknown): Promise<UtreexoProofVerdict> {
    if (!Array.isArray(proof) || proof.length === 0 || !proof.every(hash => typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash))) {
      return { valid: false, stage: 'invalid-input', error: 'A nonempty array of 32-byte hexadecimal proof hashes is required.' };
    }
    return {
      valid: false, stage: 'unavailable-verifier',
      error: 'The Utreexo proof verifier (owned utreexod bridge) is not connected. No accumulator inclusion was verified.',
    };
  }
}

export const utxoSetService = new UtxoSetService();
