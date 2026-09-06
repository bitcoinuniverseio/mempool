import {
  SubmissionCapabilities,
  SubmissionDiagnosisResult,
  PrivateBroadcastRecord,
  AcceleratorProvider,
  AcceleratorReceipt,
  TransactionOrderingEvidence,
} from './private-submission.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * status, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class SubmissionEvidenceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const relayUnavailable =
  'Private broadcast is unavailable. Queueing, relaying and abort all require the owned Tor and I2P submission relay, which is not configured on this deployment (PRE-01).';

const registryUnavailable =
  'The accelerator provider registry is unavailable. Provider identities, health and receipt trust cannot be determined until the owned signed provider directory is configured (PRE-04).';

const orderingUnavailable =
  'Ordering evidence is unavailable. Template and first-seen observation require the owned relay sensor and template recorder, which are not configured on this deployment (PRE-01).';

const diagnosisUnavailable =
  'Acceleration diagnosis is unavailable. Feerate, policy, RBF and CPFP findings require the owned mempool and policy source for this transaction, which is not wired to this route (PRE-01).';

/**
 * Private submission, acceleration and ordering evidence.
 *
 * The revision this replaces answered every one of these with a constant. It
 * reported a queued private broadcast that nothing relayed, a diagnosis whose
 * numbers did not depend on the transaction, an accelerator directory of two
 * third-party providers with third-party health endpoints, ordering evidence
 * for two invented transactions in an invented block, and a receipt
 * verification that returned verified for any four non-empty fields with no
 * signature check of any kind.
 *
 * None of those had a source. A reader could not tell them from real answers,
 * and on the receipt and broadcast paths that is the difference between an
 * honest surface and a false one. Each read now names the integration it is
 * waiting on, and the routes turn that into a 503.
 *
 * The one check kept is the receipt's structural validation, because it is
 * real: it inspects the payload the caller supplied. It no longer reports a
 * receipt as verified, because verifying one needs a provider key this
 * deployment does not have.
 */
export class PrivateSubmissionService {
  public getOverview(): never {
    throw new SubmissionEvidenceError('unavailable-source', relayUnavailable);
  }

  public getCapabilities(): SubmissionCapabilities {
    throw new SubmissionEvidenceError('unavailable-source', relayUnavailable);
  }

  public diagnoseTransaction(_rawTxOrTxid: string): SubmissionDiagnosisResult {
    throw new SubmissionEvidenceError('unavailable-source', diagnosisUnavailable);
  }

  public submitPrivate(_submission: { raw_tx: string; method: string }): PrivateBroadcastRecord {
    throw new SubmissionEvidenceError('unavailable-relay', relayUnavailable);
  }

  public getPrivateSubmission(_token: string): PrivateBroadcastRecord | undefined {
    throw new SubmissionEvidenceError('unavailable-relay', relayUnavailable);
  }

  public abortPrivateSubmission(_token: string): { success: boolean; status: string } {
    throw new SubmissionEvidenceError('unavailable-relay', relayUnavailable);
  }

  public listAcceleratorProviders(): { providers: AcceleratorProvider[] } {
    throw new SubmissionEvidenceError('unavailable-registry', registryUnavailable);
  }

  public getAcceleratorProvider(_providerId: string): AcceleratorProvider | undefined {
    throw new SubmissionEvidenceError('unavailable-registry', registryUnavailable);
  }

  /**
   * Reads the payload the caller supplied and reports what is missing from it.
   *
   * A structurally complete receipt is not a verified receipt: the signature
   * has to be checked against the provider's key, and there is no registry to
   * take that key from. So a complete payload reports unavailable trust rather
   * than success, and an incomplete one reports its own faults, which is a
   * finding this deployment can actually make.
   */
  public verifyAcceleratorReceipt(receipt: Partial<AcceleratorReceipt>): {
    verified: false;
    stage: 'invalid' | 'unavailable-registry';
    errors: string[];
  } {
    const errors: string[] = [];
    if (!receipt.provider_id) errors.push('provider_id is required');
    if (!receipt.receipt_id) errors.push('receipt_id is required');
    if (!receipt.provider_signature) errors.push('provider_signature is required');
    if (!receipt.txid || receipt.txid.length !== 64) errors.push('Valid 32-byte txid is required');

    if (errors.length > 0) {
      return { verified: false, stage: 'invalid', errors };
    }
    return { verified: false, stage: 'unavailable-registry', errors: [registryUnavailable] };
  }

  public getTransactionOrdering(_txid: string): TransactionOrderingEvidence | undefined {
    throw new SubmissionEvidenceError('unavailable-source', orderingUnavailable);
  }

  public getBlockOrdering(_blockHash: string): { block_hash: string; transactions: TransactionOrderingEvidence[] } {
    throw new SubmissionEvidenceError('unavailable-source', orderingUnavailable);
  }

  public listOrderingFindings(): { findings: TransactionOrderingEvidence[] } {
    throw new SubmissionEvidenceError('unavailable-source', orderingUnavailable);
  }
}

export default new PrivateSubmissionService();
