import {
  SubmissionCapabilities,
  SubmissionDiagnosisResult,
  PrivateBroadcastRecord,
  AcceleratorProvider,
  AcceleratorReceipt,
  TransactionOrderingEvidence,
  PrivateRelayOverview,
} from './private-submission.models';
import {
  abortPrivateRelaySubmission,
  privateRelayCapabilities,
  privateRelayOverview,
  readPrivateRelaySubmission,
  submitPrivateRelay,
} from './private-relay.submissions';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * status, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class SubmissionEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

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
  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getOverview(): Promise<PrivateRelayOverview> {
    return privateRelayOverview();
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getCapabilities(): Promise<SubmissionCapabilities> {
    return privateRelayCapabilities();
  }

  public diagnoseTransaction(_rawTxOrTxid: string): SubmissionDiagnosisResult {
    throw new SubmissionEvidenceError(
      'unavailable-source',
      diagnosisUnavailable
    );
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async submitPrivate(submission: {
    raw_tx: string;
    method: string;
  }): Promise<PrivateBroadcastRecord> {
    return submitPrivateRelay(submission);
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getPrivateSubmission(
    submissionId: string,
    ownerToken?: string
  ): Promise<PrivateBroadcastRecord> {
    return readPrivateRelaySubmission(submissionId, ownerToken);
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async abortPrivateSubmission(
    submissionId: string,
    ownerToken?: string
  ): Promise<{
    success: boolean;
    status: string;
  }> {
    return abortPrivateRelaySubmission(submissionId, ownerToken);
  }

  public listAcceleratorProviders(): { providers: AcceleratorProvider[] } {
    throw new SubmissionEvidenceError(
      'unavailable-registry',
      registryUnavailable
    );
  }

  public getAcceleratorProvider(
    _providerId: string
  ): AcceleratorProvider | undefined {
    throw new SubmissionEvidenceError(
      'unavailable-registry',
      registryUnavailable
    );
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
    if (
      !receipt ||
      typeof receipt !== 'object' ||
      Array.isArray(receipt) ||
      JSON.stringify(receipt).length > 16384
    )
      return {
        verified: false,
        stage: 'invalid',
        errors: ['Receipt must be a JSON object no larger than16KiB.'],
      };
    for (const [key, max] of [
      ['provider_id', 256],
      ['receipt_id', 256],
      ['provider_signature', 8192],
    ] as const)
      if (typeof receipt[key] === 'string' && receipt[key]!.length > max)
        errors.push(key + ' is too long');
    if (typeof receipt?.provider_id !== 'string' || !receipt.provider_id.trim())
      errors.push('provider_id is required');
    if (typeof receipt?.receipt_id !== 'string' || !receipt.receipt_id.trim())
      errors.push('receipt_id is required');
    if (
      typeof receipt?.provider_signature !== 'string' ||
      !receipt.provider_signature.trim()
    )
      errors.push('provider_signature is required');
    if (
      typeof receipt?.txid !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(receipt.txid)
    )
      errors.push('Valid 32-byte txid is required');

    if (errors.length > 0) {
      return { verified: false, stage: 'invalid', errors };
    }
    return {
      verified: false,
      stage: 'unavailable-registry',
      errors: [registryUnavailable],
    };
  }

  public getTransactionOrdering(
    _txid: string
  ): TransactionOrderingEvidence | undefined {
    throw new SubmissionEvidenceError(
      'unavailable-source',
      orderingUnavailable
    );
  }

  public getBlockOrdering(_blockHash: string): {
    block_hash: string;
    transactions: TransactionOrderingEvidence[];
  } {
    throw new SubmissionEvidenceError(
      'unavailable-source',
      orderingUnavailable
    );
  }

  public listOrderingFindings(): { findings: TransactionOrderingEvidence[] } {
    throw new SubmissionEvidenceError(
      'unavailable-source',
      orderingUnavailable
    );
  }
}

export default new PrivateSubmissionService();
