import {
  LightningNodeReliability,
  LightningLiquiditySimulationRequest,
  LightningLiquiditySimulationResult,
  LightningChannelLifecycle,
  LightningClosureForensics,
  LightningLspProvider,
  LightningReliabilityOverview,
} from './lightning-reliability.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class LightningReliabilityEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const probeFleetUnavailable =
  'Lightning reliability observations are unavailable. Node reachability, uptime and the fleet overview require the owned multi-region probe fleet (UNIVERSE_LN_PROBE_ORIGIN) and the owned Lightning gossip reader, which are not connected on this deployment.';

const channelSourceUnavailable =
  'Lightning channel observations are unavailable. Channel lifecycle and closure forensics require the owned Lightning gossip reader and the owned Bitcoin reader for funding and closing transactions, which are not connected on this deployment.';

const lspDirectoryUnavailable =
  'Lightning Service Provider observations are unavailable. The LSP directory requires the owned LSPS probe source (UNIVERSE_LN_PROBE_ORIGIN), which is not connected on this deployment.';

const pathfinderUnavailable =
  'Lightning liquidity simulations are unavailable. Path probability and fee estimates require the owned Lightning node pathfinder (UNIVERSE_LN_PATHFINDER_ORIGIN), which is not connected on this deployment.';

/**
 * Lightning reliability evidence.
 *
 * Every read here used to answer from constants: three named nodes with
 * invented uptime, a channel with an invented funding txid, a closure that
 * was settled because the constant said so, and a fleet of 4850 probed nodes
 * that nobody probed. No owned probe fleet, gossip reader or pathfinder is
 * connected, so each read reports the source it would need.
 */
export class LightningReliabilityService {
  private static instance: LightningReliabilityService;

  private constructor() {}

  public static getInstance(): LightningReliabilityService {
    if (!LightningReliabilityService.instance) {
      LightningReliabilityService.instance = new LightningReliabilityService();
    }
    return LightningReliabilityService.instance;
  }

  public getOverview(): LightningReliabilityOverview {
    throw new LightningReliabilityEvidenceError('unavailable-probe-fleet', probeFleetUnavailable);
  }

  public getNodeReliability(pubkey: string): LightningNodeReliability | null {
    if (typeof pubkey !== 'string' || !/^0[23][0-9a-f]{64}$/i.test(pubkey)) {
      throw new LightningReliabilityEvidenceError('invalid-input', 'A 33-byte compressed hexadecimal node public key is required.', 400);
    }
    throw new LightningReliabilityEvidenceError('unavailable-probe-fleet', probeFleetUnavailable);
  }

  public getChannelLifecycle(shortId: string): LightningChannelLifecycle | null {
    if (typeof shortId !== 'string' || !/^\d+x\d+x\d+$/.test(shortId)) {
      throw new LightningReliabilityEvidenceError('invalid-input', 'A short channel ID of the form <block>x<index>x<output> is required.', 400);
    }
    throw new LightningReliabilityEvidenceError('unavailable-channel-source', channelSourceUnavailable);
  }

  public getClosureForensics(txid: string): LightningClosureForensics | null {
    if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) {
      throw new LightningReliabilityEvidenceError('invalid-input', 'A 32-byte hexadecimal closing transaction ID is required.', 400);
    }
    throw new LightningReliabilityEvidenceError('unavailable-channel-source', channelSourceUnavailable);
  }

  public getLspProviders(): LightningLspProvider[] {
    throw new LightningReliabilityEvidenceError('unavailable-lsp-directory', lspDirectoryUnavailable);
  }

  public simulateLiquidity(req: LightningLiquiditySimulationRequest): LightningLiquiditySimulationResult {
    if (!req.target_pubkey || typeof req.target_pubkey !== 'string') {
      throw new LightningReliabilityEvidenceError('invalid-input', 'Target pubkey is required for liquidity simulation.', 400);
    }
    if (!req.amount_sats || req.amount_sats <= 0) {
      throw new LightningReliabilityEvidenceError('invalid-input', 'Amount in satoshis must be greater than zero.', 400);
    }
    throw new LightningReliabilityEvidenceError('unavailable-pathfinder', pathfinderUnavailable);
  }
}

export const lightningReliabilityService = LightningReliabilityService.getInstance();
