import { MempoolBlock } from '../mempool.interfaces';
import { IBitcoinApi } from './bitcoin/bitcoin-api.interface';
import config from '../config';
import mempool from './mempool';
import projectedBlocks from './mempool-blocks';
import blocks from './blocks';
import backendInfo from './backend-info';
import { bitcoinObservationMatches } from './bitcoin/bitcoin-source-observation';

const isLiquid = config.MEMPOOL.NETWORK === 'liquid' || config.MEMPOOL.NETWORK === 'liquidtestnet';

export interface RecommendedFees {
  fastestFee: number,
  halfHourFee: number,
  hourFee: number,
  economyFee: number,
  minimumFee: number,
}

export interface FeeEstimate {
  schemaVersion: 'universe-fee-estimate-v1';
  chain: 'bitcoin';
  network: string;
  status: 'ready' | 'syncing' | 'stale' | 'unavailable';
  observedAt: string | null;
  tip: { height: number; hash: string } | null;
  values: RecommendedFees | null;
  reason: string | null;
}

export const FEE_ESTIMATE_MAX_AGE_MS = 120_000;

class FeeApi {
  private observation: FeeEstimate | null = null;
  private roundedObservation: RecommendedFees | null = null;
  private lastCompletePollAt: number | null = null;

  /** Called by the shared producer after a complete poll, never by a reader. */
  public observe(complete: boolean = true, tip = blocks.getBlocks().slice(-1)[0], recordPoll: boolean = true): FeeEstimate {
    if (!complete || !mempool.isInSync()) {
      this.invalidate('syncing', 'mempool-syncing');
      return this.getFeeEstimate();
    }
    if (!tip || !Number.isSafeInteger(tip.height) || tip.height < 0 || !/^[a-f0-9]{64}$/i.test(tip.id)) {
      this.invalidate('unavailable', 'checkpoint-unavailable');
      return this.getFeeEstimate();
    }
    if (!bitcoinObservationMatches(backendInfo.getBackendInfo().chainSync, config.MEMPOOL.NETWORK,
      { height: tip.height, hash: tip.id }, FEE_ESTIMATE_MAX_AGE_MS)) {
      this.invalidate('syncing', 'node-checkpoint-unverified');
      return this.getFeeEstimate();
    }
    const values = this.getPreciseRecommendedFee();
    const rounded = this.getRecommendedFee();
    if (![...Object.values(values), ...Object.values(rounded)].every(v => Number.isFinite(v) && v >= 0)) {
      this.invalidate('unavailable', 'invalid-fee-calculation');
      return this.getFeeEstimate();
    }
    this.roundedObservation = rounded;
    if (recordPoll) this.lastCompletePollAt = Date.now();
    this.observation = { schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network: config.MEMPOOL.NETWORK,
      // A block changes the projection, but its mempool input remains dated
      // at the last complete poll. Consumers must not extend that input's age.
      status: 'ready', observedAt: new Date(this.lastCompletePollAt!).toISOString(), tip: { height: tip.height, hash: tip.id }, values, reason: null };
    return this.getFeeEstimate();
  }

  private invalidate(status: FeeEstimate['status'], reason: string): void {
    const prior = this.observation?.network === config.MEMPOOL.NETWORK ? this.observation : null;
    this.roundedObservation = null;
    this.lastCompletePollAt = null;
    this.observation = { schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network: config.MEMPOOL.NETWORK,
      status, observedAt: prior?.observedAt ?? null, tip: prior?.tip ?? null, values: null, reason };
  }

  public getFeeEstimate(): FeeEstimate {
    if (!mempool.isInSync()) this.invalidate('syncing', 'mempool-syncing');
    else if (!this.observation || this.observation.network !== config.MEMPOOL.NETWORK) this.invalidate('unavailable', 'observation-unavailable');
    else if (this.observation.status === 'ready' && (this.lastCompletePollAt === null || Date.now() - this.lastCompletePollAt >= FEE_ESTIMATE_MAX_AGE_MS || this.lastCompletePollAt > Date.now() || Date.now() - Date.parse(this.observation.observedAt!) >= FEE_ESTIMATE_MAX_AGE_MS || Date.parse(this.observation.observedAt!) > Date.now())) {
      this.invalidate('stale', 'observation-expired');
    }
    else if (this.observation.status === 'ready' && !bitcoinObservationMatches(
      backendInfo.getBackendInfo().chainSync, config.MEMPOOL.NETWORK, this.observation.tip, FEE_ESTIMATE_MAX_AGE_MS)) {
      this.invalidate('syncing', 'node-checkpoint-unverified');
    }
    const estimate = this.observation!;
    return { ...estimate, tip: estimate.tip ? { ...estimate.tip } : null, values: estimate.values ? { ...estimate.values } : null };
  }

  public getObservedRecommendedFee(precise: boolean): RecommendedFees | null {
    const estimate = this.getFeeEstimate();
    return estimate.status === 'ready' ? (precise ? estimate.values : { ...this.roundedObservation! }) : null;
  }

  /** A block alone cannot renew fees if the shared mempool poll has stalled. */
  public observeBlock(tip: Parameters<FeeApi['observe']>[1]): FeeEstimate {
    const lastPoll = this.lastCompletePollAt;
    if (lastPoll == null || Date.now() - lastPoll >= FEE_ESTIMATE_MAX_AGE_MS || lastPoll > Date.now()) {
      this.invalidate('stale', 'mempool-observation-expired');
      return this.getFeeEstimate();
    }
    return this.observe(true, tip, false);
  }
  constructor() { }

  minimumIncrement = isLiquid ? 0.1 : 1;
  minFastestFee = isLiquid ? 0.1 : 1;
  minHalfHourFee = isLiquid ? 0.1 : 0.5;
  priorityFactor = isLiquid ? 0 : 0.5;

  public getRecommendedFee(): RecommendedFees {
    const pBlocks = projectedBlocks.getMempoolBlocks();
    const mPool = mempool.getMempoolInfo();

    return this.calculateRecommendedFee(pBlocks, mPool);
  }

  public getPreciseRecommendedFee(): RecommendedFees {
    const pBlocks = projectedBlocks.getMempoolBlocks();
    const mPool = mempool.getMempoolInfo();

    // minimum non-zero minrelaytxfee / incrementalrelayfee is 1 sat/kvB = 0.001 sat/vB
    const recommendations = this.calculateRecommendedFee(pBlocks, mPool, 0.001);
    // enforce floor & offset for highest priority recommendations while <100% hashrate accepts sub-sat fees
    recommendations.fastestFee = Math.max(recommendations.fastestFee + this.priorityFactor, this.minFastestFee);
    recommendations.halfHourFee = Math.max(recommendations.halfHourFee + (this.priorityFactor / 2), this.minHalfHourFee);
    return {
      'fastestFee': Math.round(recommendations.fastestFee * 1000) / 1000,
      'halfHourFee': Math.round(recommendations.halfHourFee * 1000) / 1000,
      'hourFee': Math.round(recommendations.hourFee * 1000) / 1000,
      'economyFee': Math.round(recommendations.economyFee * 1000) / 1000,
      'minimumFee': Math.round(recommendations.minimumFee * 1000) / 1000,
    };
  }

  public calculateRecommendedFee(pBlocks: MempoolBlock[], mPool: IBitcoinApi.MempoolInfo, minIncrement: number = this.minimumIncrement): RecommendedFees {
    const purgeRate = this.roundUpToNearest(mPool.mempoolminfee * 100000, minIncrement);
    const minimumFee = Math.max(purgeRate, minIncrement);

    if (!pBlocks.length) {
      return {
        'fastestFee': minimumFee,
        'halfHourFee': minimumFee,
        'hourFee': minimumFee,
        'economyFee': minimumFee,
        'minimumFee': minimumFee,
      };
    }

    const firstMedianFee = this.optimizeMedianFee(pBlocks[0], pBlocks[1], undefined, minimumFee, minIncrement);
    const secondMedianFee = pBlocks[1] ? this.optimizeMedianFee(pBlocks[1], pBlocks[2], firstMedianFee, minimumFee, minIncrement) : minimumFee;
    const thirdMedianFee = pBlocks[2] ? this.optimizeMedianFee(pBlocks[2], pBlocks[3], secondMedianFee, minimumFee, minIncrement) : minimumFee;

    // explicitly enforce a minimum of ceil(mempoolminfee) on all recommendations.
    // simply rounding up recommended rates is insufficient, as the purging rate
    // can exceed the median rate of projected blocks in some extreme scenarios
    // (see https://bitcoin.stackexchange.com/a/120024)
    let fastestFee = Math.max(minimumFee, firstMedianFee);
    let halfHourFee = Math.max(minimumFee, secondMedianFee);
    let hourFee = Math.max(minimumFee, thirdMedianFee);
    const economyFee = Math.max(minimumFee, Math.min(2 * minimumFee, thirdMedianFee));

    // ensure recommendations always increase w/ priority
    fastestFee = Math.max(fastestFee, halfHourFee, hourFee, economyFee);
    halfHourFee = Math.max(halfHourFee, hourFee, economyFee);
    hourFee = Math.max(hourFee, economyFee);

    return {
      'fastestFee': this.roundToNearest(fastestFee, minIncrement),
      'halfHourFee': this.roundToNearest(halfHourFee, minIncrement),
      'hourFee': this.roundToNearest(hourFee, minIncrement),
      'economyFee': this.roundToNearest(economyFee, minIncrement),
      'minimumFee': this.roundToNearest(minimumFee, minIncrement),
    };
  }

  private optimizeMedianFee(pBlock: MempoolBlock, nextBlock: MempoolBlock | undefined, previousFee: number | undefined, minFee: number, minIncrement: number = this.minimumIncrement): number {
    const useFee = previousFee ? (pBlock.medianFee + previousFee) / 2 : pBlock.medianFee;
    if (pBlock.blockVSize <= 500000 || pBlock.medianFee < minFee) {
      return minFee;
    }
    if (pBlock.blockVSize <= 950000 && !nextBlock) {
      const multiplier = (pBlock.blockVSize - 500000) / 500000;
      return Math.max(this.roundToNearest(useFee * multiplier, minIncrement), minFee);
    }
    return Math.max(this.roundUpToNearest(useFee, minIncrement), minFee);
  }

  private roundUpToNearest(value: number, nearest: number): number {
    if (nearest !== 0) {
      return Math.ceil(value / nearest) * nearest;
    }
    return value;
  }

  private roundToNearest(value: number, nearest: number): number {
    if (nearest !== 0) {
      return Math.round(value / nearest) * nearest;
    }
    return value;
  }
}

export default new FeeApi();
