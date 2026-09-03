/**
 * The deterministic insight engine.
 *
 * Versioned, rule-based, explainable. Every insight states its formula,
 * names its data boundary, links its evidence, and carries its confidence.
 * No opaque scores, no predictions, no financial advice: an insight is a
 * measurable fact about this portfolio's current evidence, or it is not
 * emitted. Re-derivation over the same inputs yields the same insights.
 */

import type { PortfolioDataState } from '@app/shared/universe-portfolio-v2.types';
import { compareExact } from './exact';
import type { AggregatedHolding, AggregationResult } from './aggregation';
import type { PortfolioUtxo } from '@app/shared/universe-portfolio-v2.types';
import { classifyUtxo } from './utxo-safety';

export const INSIGHT_SCHEMA_VERSION = 'universe-portfolio-insight-v1';
export const INSIGHT_ENGINE_VERSION = '1';

export type InsightSeverity = 'information' | 'attention' | 'high';
export type InsightCategory =
  | 'allocation'
  | 'performance'
  | 'fees'
  | 'utxo-health'
  | 'asset-safety'
  | 'privacy'
  | 'source-confidence'
  | 'account-hygiene'
  | 'backup'
  | 'pending-state';
export type InsightConfidence = 'proven' | 'supported-inference' | 'unknown';

export interface PortfolioInsight {
  readonly schemaVersion: typeof INSIGHT_SCHEMA_VERSION;
  readonly insightId: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly severity: InsightSeverity;
  readonly category: InsightCategory;
  readonly title: string;
  readonly explanation: string;
  readonly calculation: string;
  readonly confidence: InsightConfidence;
  readonly evidenceRefs: readonly string[];
  readonly accountIds: readonly string[];
  readonly assetKeys: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface InsightInput {
  readonly aggregation: AggregationResult;
  readonly utxos: readonly PortfolioUtxo[];
  readonly duplicateAddresses: readonly string[];
  readonly sourceStates: readonly {
    readonly authorityId: string;
    readonly state: PortfolioDataState;
  }[];
  readonly vaultUnlockedHours: number | null;
  readonly lastBackupAt: string | null;
  readonly lastSnapshotAt: string | null;
}

interface RuleContext extends InsightInput {
  readonly now: string;
}

type Rule = (context: RuleContext) => PortfolioInsight | null;

function insight(
  ruleId: string,
  partial: Omit<PortfolioInsight, 'schemaVersion' | 'insightId' | 'ruleId' | 'ruleVersion' | 'createdAt' | 'expiresAt'>,
  now: string,
): PortfolioInsight {
  return {
    schemaVersion: INSIGHT_SCHEMA_VERSION,
    insightId: `${ruleId}:${hashStable(JSON.stringify(partial.evidenceRefs))}`,
    ruleId,
    ruleVersion: INSIGHT_ENGINE_VERSION,
    createdAt: now,
    expiresAt: null,
    ...partial,
  };
}

function hashStable(value: string): string {
  let hash = 5381;
  for (const character of value) {
    hash = ((hash << 5) + hash + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}

const concentration = (thresholdPercent: string): Rule =>
  (context) => {
    if (context.aggregation.pricedTotal === null) return null;
    let top: AggregatedHolding | null = null;
    let topShare: string | null = null;
    for (const holding of context.aggregation.holdings) {
      if (holding.pricedValue === null) continue;
      const share = shareOf(holding.pricedValue, context.aggregation.pricedTotal);
      if (topShare === null || compareExact(share, topShare) > 0) {
        top = holding;
        topShare = share;
      }
    }
    if (top === null || topShare === null || compareExact(topShare, thresholdPercent) < 0) {
      return null;
    }
    return insight(
      'allocation.asset-concentration',
      {
        severity: compareExact(topShare, '80') >= 0 ? 'attention' : 'information',
        category: 'allocation',
        title: `${top.displayName ?? top.ticker ?? 'One asset'} is ${topShare}% of the priced portfolio`,
        explanation:
          'A single asset dominates the priced total. This is a measurement, not advice: it says what the evidence shows, and it excludes unpriced holdings.',
        calculation: `share = pricedValue / pricedTotal × 100 = ${top.pricedValue} / ${context.aggregation.pricedTotal} × 100 = ${topShare}%; threshold ${thresholdPercent}%`,
        confidence: 'proven',
        evidenceRefs: [`asset:${top.assetKey}`],
        accountIds: [...top.accountIds],
        assetKeys: [top.assetKey],
      },
      context.now,
    );
  };

const utxoFragmentation: Rule = (context) => {
  const spendable = context.utxos.filter((utxo) => !utxo.pending && !utxo.spent);
  if (spendable.length < 20) return null;
  return insight(
    'utxo.fragmentation',
    {
      severity: 'information',
      category: 'utxo-health',
      title: `${spendable.length} unspent outputs across the tracked accounts`,
      explanation:
        'Many small outputs raise the future cost of spending the same value, because every input costs fee weight. The consolidation view estimates this from proven plain-BTC outputs only.',
      calculation: `count(unspent outputs) = ${spendable.length}; threshold 20`,
      confidence: 'proven',
      evidenceRefs: spendable.slice(0, 25).map((utxo) => `outpoint:${utxo.txid}:${utxo.vout}`),
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const dustExposure: Rule = (context) => {
  const dust = context.utxos.filter((utxo) =>
    classifyUtxo(utxo).classes.includes('economic-dust'),
  );
  if (dust.length === 0) return null;
  const total = dust.reduce((sum, utxo) => sum + BigInt(utxo.valueAtomic), 0n);
  return insight(
    'utxo.dust-exposure',
    {
      severity: 'information',
      category: 'utxo-health',
      title: `${dust.length} outputs are uneconomic to spend at the selected fee rate`,
      explanation:
        'At the fee rate you selected, spending these outputs costs more in fees than they carry. The value is not lost; it is trapped unless fee rates fall or outputs consolidate.',
      calculation: `count(class = economic-dust) = ${dust.length}; trapped total = ${total.toString()} sats`,
      confidence: 'proven',
      evidenceRefs: dust.slice(0, 25).map((utxo) => `outpoint:${utxo.txid}:${utxo.vout}`),
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const unknownUtxoCoverage: Rule = (context) => {
  const unknown = context.utxos.filter((utxo) =>
    classifyUtxo(utxo).classes.includes('unknown-asset-state'),
  );
  if (unknown.length === 0) return null;
  return insight(
    'utxo.unknown-asset-coverage',
    {
      severity: 'attention',
      category: 'asset-safety',
      title: `${unknown.length} outputs have an unproven asset state`,
      explanation:
        'A protocol authority did not answer for these outputs. They may carry inscriptions, runes, or other assets: nothing here should be read as plain BTC until a source proves otherwise.',
      calculation: `count(assetState ∉ {proven with empty assets}) = ${unknown.length}`,
      confidence: 'unknown',
      evidenceRefs: unknown.slice(0, 25).map((utxo) => `outpoint:${utxo.txid}:${utxo.vout}`),
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const unpricedExposure: Rule = (context) => {
  const unpriced = context.aggregation.holdings.filter(
    (holding) => holding.valuationState === 'unpriced' && holding.state !== 'unsupported',
  );
  if (unpriced.length === 0) return null;
  return insight(
    'valuation.unpriced-exposure',
    {
      severity: 'information',
      category: 'source-confidence',
      title: `${unpriced.length} holdings carry no price and sit outside the priced total`,
      explanation:
        'Unpriced holdings keep their exact quantities; they are never counted as zero. The portfolio total is a priced subtotal.',
      calculation: `count(valuationState = unpriced) = ${unpriced.length}`,
      confidence: 'proven',
      evidenceRefs: unpriced.map((holding) => `asset:${holding.assetKey}`),
      accountIds: [],
      assetKeys: unpriced.map((holding) => holding.assetKey),
    },
    context.now,
  );
};

const sourceDegradation: Rule = (context) => {
  const degraded = context.sourceStates.filter((source) => source.state === 'unavailable' || source.state === 'stale');
  if (degraded.length === 0) return null;
  return insight(
    'sources.degraded',
    {
      severity: 'attention',
      category: 'source-confidence',
      title: `${degraded.length} source${degraded.length === 1 ? '' : 's'} degraded or stale`,
      explanation:
        'Answers from a degraded source are marked, not silently kept. Totals that include degraded coverage state exactly which parts are affected.',
      calculation: `count(state ∈ {unavailable, stale}) = ${degraded.length}`,
      confidence: 'proven',
      evidenceRefs: degraded.map((source) => `authority:${source.authorityId}`),
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const duplicateAccounts: Rule = (context) => {
  if (context.duplicateAddresses.length === 0) return null;
  return insight(
    'accounts.duplicate-addresses',
    {
      severity: 'attention',
      category: 'account-hygiene',
      title: `${context.duplicateAddresses.length} address${context.duplicateAddresses.length === 1 ? ' appears' : 's appear'} under more than one account`,
      explanation:
        'The same address in two accounts would double-count its value. Aggregation counts each duplicated address once and names the accounts so you can set an explicit inclusion.',
      calculation: `count(duplicated addresses) = ${context.duplicateAddresses.length}`,
      confidence: 'proven',
      evidenceRefs: context.duplicateAddresses.map((address) => `address:${address}`),
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const vaultUnlocked: Rule = (context) => {
  if (context.vaultUnlockedHours === null || context.vaultUnlockedHours < 8) return null;
  return insight(
    'vault.unlocked-too-long',
    {
      severity: 'information',
      category: 'privacy',
      title: 'The vault has been unlocked a while',
      explanation:
        'You configured a preference about how long the vault should stay open. Locking it removes the decryption key from memory; nothing is stored unlocked.',
      calculation: `unlockedHours = ${context.vaultUnlockedHours}; threshold 8`,
      confidence: 'proven',
      evidenceRefs: ['vault:session'],
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const backupOverdue: Rule = (context) => {
  if (context.lastBackupAt !== null) return null;
  return insight(
    'backup.missing',
    {
      severity: 'attention',
      category: 'backup',
      title: 'No encrypted backup exists yet',
      explanation:
        'The vault lives only in this browser profile. A reset, a cleared profile, or a lost device erases the portfolio definitions, labels, and snapshots. An encrypted backup file is the only recovery path.',
      calculation: 'lastBackupAt = null',
      confidence: 'proven',
      evidenceRefs: ['vault:backup'],
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const pendingActivity: Rule = (context) => {
  const pending = context.utxos.filter((utxo) => utxo.pending);
  if (pending.length === 0) return null;
  return insight(
    'pending.outputs',
    {
      severity: 'information',
      category: 'pending-state',
      title: `${pending.length} output${pending.length === 1 ? ' is' : 's are'} still pending`,
      explanation:
        'Pending outputs are not yet part of the confirmed chain. They are shown, marked, and excluded from proven totals until confirmation.',
      calculation: `count(pending) = ${pending.length}`,
      confidence: 'proven',
      evidenceRefs: pending.slice(0, 25).map((utxo) => `outpoint:${utxo.txid}:${utxo.vout}`),
      accountIds: [],
      assetKeys: [],
    },
    context.now,
  );
};

const RULES: readonly Rule[] = [
  concentration('60'),
  utxoFragmentation,
  dustExposure,
  unknownUtxoCoverage,
  unpricedExposure,
  sourceDegradation,
  duplicateAccounts,
  vaultUnlocked,
  backupOverdue,
  pendingActivity,
];

/**
 * Derives insights deterministically. `now` seeds createdAt so the same
 * evidence produces identical insight bodies across a refresh.
 */
export function deriveInsights(input: InsightInput, now: string): PortfolioInsight[] {
  const context: RuleContext = { ...input, now };
  const insights: PortfolioInsight[] = [];
  for (const rule of RULES) {
    const result = rule(context);
    if (result !== null) insights.push(result);
  }
  return insights.sort(
    (a, b) =>
      severityOrder(b.severity) - severityOrder(a.severity) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

function severityOrder(severity: InsightSeverity): number {
  return severity === 'high' ? 3 : severity === 'attention' ? 2 : 1;
}

function shareOf(part: string, total: string): string {
  const scale = 1_000_000n;
  const [whole, fraction = ''] = part.split('.');
  const partUnits = BigInt(whole + fraction.padEnd(fraction.length, '0'));
  const [tWhole, tFraction = ''] = total.split('.');
  const totalUnits = BigInt(tWhole + tFraction.padEnd(tFraction.length, '0'));
  if (totalUnits === 0n) return '0';
  const scaled = (partUnits * 100n * scale) / totalUnits;
  const wholePart = scaled / scale;
  const fractionPart = (scaled % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return fractionPart.length === 0 ? `${wholePart}` : `${wholePart}.${fractionPart}`;
}
