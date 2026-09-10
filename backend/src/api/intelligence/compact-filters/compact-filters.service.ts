import {
  CompactFilterProvider,
  CompactFilterCheckpoint,
  CompactFilter,
  CompactFilterVerificationRun,
  CompactFilterOverviewResponse,
} from './compact-filters.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class CompactFiltersEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const filterIndexUnavailable =
  'BIP158 filter observations are unavailable. Block filter, checkpoint and range reads require the owned bitcoind with blockfilterindex=1 (getblockfilter and getblockfilterheader RPC), which is not connected on this deployment.';

const filterPeersUnavailable =
  'Compact filter provider observations are unavailable. Provider, conflict and cross-peer verification reads require the owned P2P filter prober that samples NODE_COMPACT_FILTERS peers from the backend network, which is not connected on this deployment.';

/**
 * BIP157/158 filter evidence.
 *
 * Filters, headers and checkpoints come from the owned bitcoind filter index;
 * provider health, conflicts and cross-peer verification come from the owned
 * P2P prober. A deployment that has neither gets a 503 that names them: an
 * empty provider directory and an absent one are different answers, and this
 * never turns the second into the first.
 */
export class CompactFiltersService {
  public getOverview(): CompactFilterOverviewResponse {
    throw new CompactFiltersEvidenceError('unavailable-filter-peers', filterPeersUnavailable);
  }

  public listProviders(): CompactFilterProvider[] {
    throw new CompactFiltersEvidenceError('unavailable-filter-peers', filterPeersUnavailable);
  }

  public getProvider(_providerId: string): CompactFilterProvider | undefined {
    throw new CompactFiltersEvidenceError('unavailable-filter-peers', filterPeersUnavailable);
  }

  public getProviderHistory(_providerId: string): any[] {
    throw new CompactFiltersEvidenceError('unavailable-filter-peers', filterPeersUnavailable);
  }

  public listCheckpoints(): CompactFilterCheckpoint[] {
    throw new CompactFiltersEvidenceError('unavailable-filter-index', filterIndexUnavailable);
  }

  public getBlockFilter(_blockHash: string): CompactFilter | undefined {
    throw new CompactFiltersEvidenceError('unavailable-filter-index', filterIndexUnavailable);
  }

  public getRanges(): Array<{ range_start: number; range_end: number; filter_type: string; status: string }> {
    throw new CompactFiltersEvidenceError('unavailable-filter-index', filterIndexUnavailable);
  }

  public createVerification(_params: {
    start_height: number;
    end_height: number;
    providers: string[];
  }): CompactFilterVerificationRun {
    throw new CompactFiltersEvidenceError('unavailable-filter-peers', filterPeersUnavailable);
  }

  public getVerification(_verificationId: string): CompactFilterVerificationRun | undefined {
    throw new CompactFiltersEvidenceError('unavailable-filter-peers', filterPeersUnavailable);
  }
}

export default new CompactFiltersService();
