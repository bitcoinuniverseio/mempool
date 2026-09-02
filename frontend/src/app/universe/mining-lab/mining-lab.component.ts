import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/**
 * The mining and consensus lab's front door.
 *
 * Three modules, each naming what it is built on. Nothing here links to a
 * page the deployment cannot fill with real data: where a module needs data
 * the deployment does not produce, the hub says so in the same breath.
 */
@Component({
  selector: 'app-universe-mining-lab',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="hub">
      <h1 class="title" i18n="universe.mining.hub-title">Mining and consensus lab</h1>
      <p class="lede" i18n="universe.mining.hub-lede">
        How blocks actually get built and what can go wrong, measured from
        this deployment's own nodes and named with their sources.
      </p>

      <a class="module" routerLink="/labs/mining/bitcoin">
        <h2 i18n="universe.mining.bitcoin-title">Bitcoin</h2>
        <p i18n="universe.mining.bitcoin-desc">
          Block intervals, empty blocks, pool shares, and fee share over the
          most recent blocks, with the window and the method stated.
        </p>
      </a>

      <a class="module" routerLink="/labs/mining/dogecoin">
        <h2 i18n="universe.mining.dogecoin-title">Dogecoin and AuxPoW</h2>
        <p i18n="universe.mining.dogecoin-desc">
          The merge mining proof, parsed from the raw block in your browser:
          the parent header, the coinbase commitment, and the readable pool
          text. Plus intervals and empty block share on the Dogecoin chain.
        </p>
      </a>

      <a class="module" routerLink="/labs/mining/reorgs">
        <h2 i18n="universe.mining.reorgs-title">Reorgs</h2>
        <p i18n="universe.mining.reorgs-desc">
          Competing tips this node has seen: the stale block and the block
          that displaced it, and when. What one node saw is what this page
          claims, never more.
        </p>
      </a>
    </div>
  `,
  styles: [`
    .hub { margin: var(--u-space-5) auto; max-width: 52rem; padding: 0 var(--u-space-4); }
    .title { font-size: var(--u-text-xl); margin: 0 0 var(--u-space-2); }
    .lede { color: var(--u-text-secondary); margin: 0 0 var(--u-space-5); }
    .module {
      background: var(--u-surface-raised); border: 1px solid var(--u-border);
      border-radius: var(--u-radius-md); display: block; margin-bottom: var(--u-space-3);
      color: inherit; padding: var(--u-space-4); text-decoration: none;
    }
    .module:hover { border-color: var(--u-brand); }
    .module:focus-visible { outline: 2px solid var(--u-focus-ring); outline-offset: 2px; }
    .module h2 { font-size: var(--u-text-lg); margin: 0 0 var(--u-space-1); }
    .module p { color: var(--u-text-secondary); margin: 0; }
  `],
})
export class MiningLabComponent {}
