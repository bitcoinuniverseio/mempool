import config from '../../../config';
import {
  SubmissionCapabilities,
  SubmissionDiagnosisResult,
  PrivateBroadcastRecord,
  AcceleratorProvider,
  AcceleratorReceipt,
  ReceiptVerificationResult,
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
import { AcceleratorDirectoryError, acceleratorDirectory, providerView, verifyAcceleratorReceipt } from './accelerator-directory';
import { BlockOrderingEvidence, OrderingEvidenceError, OrderingEvidenceService, orderingEvidenceService, OrderingFindings } from './ordering-evidence.service';
import { DiagnosisNotFound, DiagnosisReaders, diagnoseFromOwnedMempool, ownedDiagnosisReaders } from './transaction-diagnosis';

/**
 * Raised when a read has no source behind it, or names nothing the source
 * holds. The routes map the status: 503 for an absent integration, 404 for
 * an absent record.
 */
export class SubmissionEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 503
  ) {
    super(message);
  }
}


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
  /** Test seams for the owned readers behind diagnosis and ordering. */
  public diagnosisReaders: DiagnosisReaders = ownedDiagnosisReaders;
  public ordering: OrderingEvidenceService = orderingEvidenceService;

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getOverview(): Promise<PrivateRelayOverview> {
    return privateRelayOverview();
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getCapabilities(): Promise<SubmissionCapabilities> {
    return privateRelayCapabilities();
  }

  /** Facts of the requested transaction's own mempool entry; a transaction this mempool does not hold is a typed 404. */
  public diagnoseTransaction(rawTxOrTxid: string): SubmissionDiagnosisResult {
    try {
      return diagnoseFromOwnedMempool(rawTxOrTxid, this.diagnosisReaders);
    } catch (e) {
      if (e instanceof DiagnosisNotFound) {
        throw new SubmissionEvidenceError('transaction-not-in-mempool', e.message, 404);
      }
      throw e;
    }
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

  private directory(): ReturnType<typeof acceleratorDirectory> {
    try {
      return acceleratorDirectory();
    } catch (e) {
      if (e instanceof AcceleratorDirectoryError) {
        throw new SubmissionEvidenceError('unavailable-registry', e.message + ' (reason: ' + e.reason + ')');
      }
      throw e;
    }
  }

  /** Providers from the owned directory that list this deployment's network. */
  public listAcceleratorProviders(): { providers: AcceleratorProvider[]; network: string; directory: { source: string; revision: string; loaded_at_utc: string } } {
    const directory = this.directory();
    const network = config.MEMPOOL.NETWORK;
    return {
      providers: directory.providers.filter(provider => provider.networks.includes(network)).map(provider => providerView(provider, directory)),
      network,
      directory: { source: directory.source, revision: directory.revision, loaded_at_utc: directory.loaded_at_utc },
    };
  }

  public getAcceleratorProvider(providerId: string): AcceleratorProvider {
    const directory = this.directory();
    const provider = directory.providers.find(entry => entry.id === providerId);
    if (!provider) {
      throw new SubmissionEvidenceError('provider-not-in-directory', `Provider ${providerId} is not in the owned directory (revision ${directory.revision}).`, 404);
    }
    return providerView(provider, directory);
  }

  /**
   * Structural faults are the caller's; everything past them is decided by
   * the owned directory's key for the named provider: the signed payload
   * encoding documented on AcceleratorReceipt, the key's validity at issue,
   * the network, the expiry and a replay of a receipt already verified here.
   */
  public verifyAcceleratorReceipt(receipt: Partial<AcceleratorReceipt>, now = Date.now()): ReceiptVerificationResult {
    return verifyAcceleratorReceipt(receipt, { now });
  }

  private orderingRead<T>(read: () => T): T {
    try {
      return read();
    } catch (e) {
      if (e instanceof OrderingEvidenceError) {
        throw new SubmissionEvidenceError(e.code, e.message, e.status);
      }
      throw e;
    }
  }

  public getTransactionOrdering(txid: string): TransactionOrderingEvidence {
    return this.orderingRead(() => this.ordering.getTransactionOrdering(txid));
  }

  public getBlockOrdering(blockHash: string): BlockOrderingEvidence {
    return this.orderingRead(() => this.ordering.getBlockOrdering(blockHash));
  }

  public listOrderingFindings(): OrderingFindings {
    return this.ordering.listOrderingFindings();
  }
}

export default new PrivateSubmissionService();
