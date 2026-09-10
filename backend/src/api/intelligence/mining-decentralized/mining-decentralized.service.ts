import {
  DecentralizedMiningProtocol,
  DecentralizedMiningSource,
  DecentralizedMiningShare,
  DecentralizedMiningTemplate,
  DecentralizedMiningTemplateComparison,
  DecentralizedMiningPayoutEvidence,
  DecentralizedMiningOverviewResponse,
} from './mining-decentralized.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class DecentralizedMiningEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const shareSourceUnavailable =
  'Decentralized mining observations are unavailable. Sources, shares, templates and template comparisons require the owned DATUM gateway, P2Pool v2 node and Braidpool node share feeds, which are not connected on this deployment.';

const payoutSourceUnavailable =
  'Decentralized mining payout evidence is unavailable. Coinbase payout verification requires the owned share feeds and the owned Bitcoin block reader, which are not connected on this deployment.';

/**
 * Decentralized mining evidence.
 *
 * The protocol catalogue is reference material and stays answerable. Sources,
 * shares, templates, comparisons and payouts are observations and need the
 * owned share feeds; a deployment without them gets a 503 that names them.
 */
export class DecentralizedMiningService {
  private protocols: DecentralizedMiningProtocol[] = [
    {
      protocol_id: 'datum_gateway',
      name: 'DATUM Gateway',
      architecture: 'miner_selected_templates',
      current_version: 'v1.0.4',
      share_structure: 'Miner-built template with pool-mandated coinbase outputs',
      payout_mechanism: 'Direct pool coinbase reward split',
      description: 'Decentralized mining template architecture enabling hashrate owners to construct local blocks while delegating share coordination',
    },
    {
      protocol_id: 'p2pool_v2',
      name: 'P2Pool v2',
      architecture: 'linear_sharechain',
      current_version: 'v2.1.0-alpha',
      share_structure: 'Linear sharechain with deterministic PPLNS window',
      payout_mechanism: 'On-chain coinbase multi-output dispersion',
      description: 'Decentralized peer-to-peer sharechain that completely removes centralized pool operators',
    },
    {
      protocol_id: 'braidpool',
      name: 'Braidpool',
      architecture: 'dag_consensus',
      current_version: 'v0.3.0-prototype',
      share_structure: 'Directed Acyclic Graph of shares with multi-parent ancestry',
      payout_mechanism: 'Braid balance commitments and off-chain batch settlement',
      description: 'DAG-based share accounting platform eliminating share-orphaning and reducing payout variance',
    },
  ];

  public getOverview(): DecentralizedMiningOverviewResponse {
    throw new DecentralizedMiningEvidenceError('unavailable-share-source', shareSourceUnavailable);
  }

  public listProtocols(): DecentralizedMiningProtocol[] {
    return this.protocols;
  }

  public listSources(): DecentralizedMiningSource[] {
    throw new DecentralizedMiningEvidenceError('unavailable-share-source', shareSourceUnavailable);
  }

  public listShares(): DecentralizedMiningShare[] {
    throw new DecentralizedMiningEvidenceError('unavailable-share-source', shareSourceUnavailable);
  }

  public getShare(_shareId: string): DecentralizedMiningShare | undefined {
    throw new DecentralizedMiningEvidenceError('unavailable-share-source', shareSourceUnavailable);
  }

  public listTemplates(): DecentralizedMiningTemplate[] {
    throw new DecentralizedMiningEvidenceError('unavailable-share-source', shareSourceUnavailable);
  }

  public getTemplate(_templateId: string): DecentralizedMiningTemplate | undefined {
    throw new DecentralizedMiningEvidenceError('unavailable-share-source', shareSourceUnavailable);
  }

  public listPayouts(): DecentralizedMiningPayoutEvidence[] {
    throw new DecentralizedMiningEvidenceError('unavailable-payout-source', payoutSourceUnavailable);
  }

  public compareTemplates(): DecentralizedMiningTemplateComparison {
    throw new DecentralizedMiningEvidenceError('unavailable-share-source', shareSourceUnavailable);
  }
}

export default new DecentralizedMiningService();
