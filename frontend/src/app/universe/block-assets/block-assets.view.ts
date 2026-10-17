import {
  BlockAssetActivitySummary,
  BlockAssetEvent,
  BlockProtocolCoverage,
  BlockProtocolCoverageState,
  ExplorerAssetRef,
  ExplorerChain,
} from '@app/universe/universe.types';
import { formatAtomicAmount, shortenIdentifier } from '@app/universe/universe-evidence';

/** Protocols whose block activity this chain's explorer has its own asset pages for. */
const CHAIN_PROTOCOL_PAGES: Readonly<Record<string, readonly string[]>> = {
  dogecoin: ['doginals', 'drc20', 'dunes'],
  zcash: ['zerdinals', 'zrunes'],
};

export function operationLabel(operation: string): string {
  switch (operation) {
    case 'inscribe': return $localize`:@@universe.block-assets.op.inscribe:Inscribed`;
    case 'deploy': return $localize`:@@universe.block-assets.op.deploy:Deployed`;
    case 'etch': return $localize`:@@universe.block-assets.op.etch:Etched`;
    case 'mint': return $localize`:@@universe.block-assets.op.mint:Minted`;
    case 'transfer': return $localize`:@@universe.block-assets.op.transfer:Transferred`;
    case 'burn': return $localize`:@@universe.block-assets.op.burn:Burned`;
    case 'register': return $localize`:@@universe.block-assets.op.register:Registered`;
    case 'update': return $localize`:@@universe.block-assets.op.update:Updated`;
    case 'present-at-output': return $localize`:@@universe.block-assets.op.at-output:On output`;
    case 'shielded-untrackable': return $localize`:@@universe.block-assets.op.shielded:Moved into shielded`;
    default: return operation;
  }
}

export function assetKindLabel(kind: string | undefined): string {
  switch (kind) {
    case 'inscription': return $localize`:@@universe.block-assets.kind.inscription:Inscription`;
    case 'fungible': return $localize`:@@universe.block-assets.kind.fungible:Fungible token`;
    case 'non-fungible': return $localize`:@@universe.block-assets.kind.nft:NFT`;
    case 'name': return $localize`:@@universe.block-assets.kind.name:Name`;
    case 'sat': return $localize`:@@universe.block-assets.kind.sat:Sat`;
    case 'data': return $localize`:@@universe.block-assets.kind.data:Data`;
    case 'protocol-event': return $localize`:@@universe.block-assets.kind.event:Protocol event`;
    default: return $localize`:@@universe.block-assets.kind.unknown:Unknown`;
  }
}

export function coverageLabel(state: BlockProtocolCoverageState): string {
  switch (state) {
    case 'read': return $localize`:@@universe.block-assets.cov.read:Verified`;
    case 'partial': return $localize`:@@universe.block-assets.cov.partial:Partial`;
    case 'pending': return $localize`:@@universe.block-assets.cov.pending:Not indexed yet`;
    case 'unavailable': return $localize`:@@universe.block-assets.cov.unavailable:Unavailable`;
    case 'unconfigured': return $localize`:@@universe.block-assets.cov.unconfigured:Not configured`;
    default: return $localize`:@@universe.block-assets.cov.not-readable:Not readable by block yet`;
  }
}

export function assetLabel(asset: ExplorerAssetRef | null): string {
  if (!asset) {return $localize`:@@universe.block-assets.no-asset:Unnamed`;}
  return asset.displayName || asset.ticker || shortenIdentifier(asset.assetId, 10);
}

/** The exact quantity, scaled only when the authority states the divisibility. */
export function quantityLabel(event: BlockAssetEvent): string {
  if (event.quantityAtomic === null) {return '';}
  const decimals = (event.asset as { decimals?: number } | null)?.decimals;
  return formatAtomicAmount(event.quantityAtomic, typeof decimals === 'number' ? decimals : 0);
}

/** Router commands for the asset's own explorer page, or null when none exists. */
export function assetRoute(chain: ExplorerChain, asset: ExplorerAssetRef | null): unknown[] | null {
  if (!asset) {return null;}
  if (chain === 'bitcoin') {
    if (asset.protocolId === 'ordinals') {return ['/inscription', asset.assetId];}
    if (asset.protocolId === 'runes') {return ['/rune', asset.assetId];}
    return null;
  }
  return CHAIN_PROTOCOL_PAGES[chain]?.includes(asset.protocolId)
    ? ['/', chain, 'protocols', asset.protocolId, asset.assetId]
    : null;
}

export function protocolRoute(chain: ExplorerChain, protocolId: string): unknown[] {
  return chain === 'bitcoin' ? ['/protocols', protocolId] : ['/', chain, 'protocols', protocolId];
}

export function transactionRoute(chain: ExplorerChain, txid: string): unknown[] {
  return chain === 'bitcoin' ? ['/tx', txid] : ['/', chain, 'tx', txid];
}

/** Evidence as a reader judges it: verified, partial, or still pending. */
export function evidenceLabel(event: BlockAssetEvent): string {
  return event.verification === 'verified'
    ? $localize`:@@universe.block-assets.ev.verified:Verified`
    : $localize`:@@universe.block-assets.ev.partial:Partial`;
}

export interface BlockCoverageNotice {
  readonly tone: 'info' | 'warning';
  readonly text: string;
}

/**
 * What the reader must know before trusting the counts, most serious first.
 * Never says "no assets" unless every protocol proved its absence.
 */
export function coverageNotices(summary: BlockAssetActivitySummary): BlockCoverageNotice[] {
  const notices: BlockCoverageNotice[] = [];
  if (!summary.block.onMainChain) {
    notices.push({
      tone: 'warning',
      text: $localize`:@@universe.block-assets.off-main-chain:This block is no longer on the main chain. Its asset activity is shown for reference only and is not current.`,
    });
  }
  const failing = summary.protocols.filter((p) => p.state === 'unavailable').length;
  if (failing > 0) {
    notices.push({
      tone: 'warning',
      text: $localize`:@@universe.block-assets.unavailable-sources:Asset activity is partially indexed. ${failing}:count: protocol sources are currently unavailable.`,
    });
  }
  const pending = summary.protocols.filter((p) => p.state === 'pending').length;
  if (pending > 0) {
    notices.push({
      tone: 'info',
      text: $localize`:@@universe.block-assets.pending-sources:${pending}:count: protocol sources have not indexed this block yet.`,
    });
  }
  const unreadable = summary.protocols.filter((p) => p.state === 'not-block-readable').length;
  if (unreadable > 0) {
    notices.push({
      tone: 'info',
      text: $localize`:@@universe.block-assets.unreadable:${unreadable}:count: supported protocols cannot be read by block yet, so their activity in this block is not shown. This is a coverage limit, not an absence of assets.`,
    });
  }
  if (summary.outOfCoverageOutputsAtomic !== '0') {
    notices.push({
      tone: 'info',
      text: $localize`:@@universe.block-assets.spent:${summary.outOfCoverageOutputsAtomic}:count: outputs of this block have since been spent, and the asset authority no longer keeps their contents.`,
    });
  }
  return notices;
}

/** The headline the empty table may state, chosen from what coverage proves. */
export function emptyStateMessage(summary: BlockAssetActivitySummary): string {
  if (summary.completeness === 'complete') {
    return $localize`:@@universe.block-assets.empty-proven:No protocol assets in this block. Every supported protocol proved it.`;
  }
  return $localize`:@@universe.block-assets.empty-unproven:No protocol activity was found by the sources that could read this block. Assets from other protocols may still exist.`;
}

/** The coverage rows worth a table row: activity, or a state other than plain read. */
export function breakdownRows(summary: BlockAssetActivitySummary): BlockProtocolCoverage[] {
  return [...summary.protocols]
    .filter((p) => p.eventCountAtomic !== '0' || p.state === 'read' || p.state === 'partial')
    .sort((a, b) => compareAtomic(b.eventCountAtomic, a.eventCountAtomic) || a.displayName.localeCompare(b.displayName));
}

export function limitedRows(summary: BlockAssetActivitySummary): BlockProtocolCoverage[] {
  return summary.protocols
    .filter((p) => p.eventCountAtomic === '0' && p.state !== 'read' && p.state !== 'partial')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function compareAtomic(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
