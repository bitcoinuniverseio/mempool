import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Observable, combineLatest, filter, map, startWith } from 'rxjs';
import { ChainHealthService } from '../chain-health.service';
import { ChainCapabilityEnvelope, ExplorerChain } from '../universe.types';
import { nodeHealthLabel, readHealth } from '../multichain-explorer/chain-health';
import { explorerChainFromUrl, explorerChainName } from '../universe-chain-routing';
import { IBackendInfo } from '@interfaces/websocket.interface';

export interface ChainSyncNotice {
  readonly show: boolean;
  readonly behind: number;
  readonly blocks: number;
  readonly headers: number;
  readonly percent: number;
  readonly initial: boolean;
}

/**
 * The gap between the node this explorer reads and the chain that exists.
 *
 * Every other claim on the site is qualified by the evidence behind it. The
 * base chain deserves the same treatment: an explorer reading a node that is
 * still catching up would otherwise present a months-old tip as the present,
 * silently, which is the single worst thing it could do. So it says so, and it
 * says by how much.
 */
@Component({
  selector: 'app-universe-chain-sync-notice',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './chain-sync-notice.component.html',
  styleUrls: ['./chain-sync-notice.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainSyncNoticeComponent {
  notice$: Observable<IndependentChainNotice>;

  constructor(public health: ChainHealthService, router: Router) {
    const chain$ = router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      startWith(null),
      map(() => explorerChainFromUrl(router.url)),
    );
    this.notice$ = combineLatest([chain$, health.state$]).pipe(map(([chain, state]) =>
      chainHealthNotice(state.capabilities.find(row => row.chain === chain) ?? null, chain, state.loading),
    ));
  }

}

/**
 * A gap of a block or two is ordinary propagation, not a sync problem, so the
 * notice only appears once the node is genuinely behind.
 */
export const CHAIN_SYNC_TOLERANCE_BLOCKS = 3;

export function chainSyncNotice(info: IBackendInfo | null): ChainSyncNotice {
  const sync = info?.chainSync;
  if (!sync || !Number.isFinite(sync.blocks) || !Number.isFinite(sync.headers)) {
    return { show: false, behind: 0, blocks: 0, headers: 0, percent: 0, initial: false };
  }
  const behind = Math.max(0, sync.headers - sync.blocks);
  const progress = Number(sync.verificationProgress);
  const percent = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, Math.floor(progress * 100)))
    : 0;
  return {
    show: sync.initialBlockDownload || behind > CHAIN_SYNC_TOLERANCE_BLOCKS,
    behind,
    blocks: sync.blocks,
    headers: sync.headers,
    percent,
    initial: !!sync.initialBlockDownload,
  };
}

export interface IndependentChainNotice {
  show: boolean;
  title: string;
  detail: string;
}

export function chainHealthNotice(capability: ChainCapabilityEnvelope | null, chain: ExplorerChain, loading = false, now = Date.now()): IndependentChainNotice {
  const node = readHealth(capability)?.node;
  const label = nodeHealthLabel(capability, now);
  return {
    show: !loading && label !== 'Synced',
    title: explorerChainName(chain) + ' · ' + label,
    detail: label === 'Syncing'
      ? 'The node is catching up.' + (node?.heightAtomic ? ' Node block ' + node.heightAtomic + '.' : '') + (node?.blocksBehindNetworkAtomic !== null && node?.blocksBehindNetworkAtomic !== undefined ? ' Reported gap: ' + node.blocksBehindNetworkAtomic + ' blocks.' : ' The remaining gap is unknown.')
      : 'Current node synchronization could not be confirmed. Individual services report their own availability.',
  };
}
