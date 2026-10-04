import { ChangeDetectionStrategy, Component, Input, effect, inject, signal } from '@angular/core';
import type { LocalPortfolio } from '../stores/portfolio-model';
import { PortfoliosStore } from '../stores/portfolios.store';
import { WatchOnlyDiscoveryService } from '../data/watch-only-discovery.service';

@Component({
  selector: 'app-watch-only-discovery', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WatchOnlyDiscoveryService],
  template: `
    @for (account of selectedPortfolio()?.accounts; track account.id) {
      @if (account.kind === 'xpub' || account.kind === 'descriptor') {
        <section aria-label="Watch-only address discovery">
          <p>{{ account.name }} · {{ account.chain }}/{{ account.network }}</p>
          <p>Only derived public addresses are queried. Key material stays in this browser.
            Each action checks at most 20 addresses. A declared gap limit does not prove addresses beyond that range are unused.</p>
          <p>External index {{ account.discovery?.lastIndexExternal ?? -1 }}; internal index {{ account.discovery?.lastIndexInternal ?? -1 }}.
            {{ account.discovery?.complete ? 'Declared range scanned' : 'Discovery partial or not started' }}.</p>
          @if (account.discovery?.sourceIdentity; as source) {
            <details><summary>Observed discovery source</summary>
              <p>{{ source.network }} at block {{ source.checkpoint.heightAtomic }}: <code>{{ source.checkpoint.blockHash }}</code>.</p>
              <p>Genesis: <code>{{ source.genesisHash }}</code>. Build: <code>{{ source.releaseSha }}</code>.</p>
              <p>Configuration: <code>{{ source.configurationSha256 }}</code>. Observed {{ source.observedAt }}.</p>
              @if (source.signetChallenge) { <p>Signet challenge: <code>{{ source.signetChallenge }}</code>.</p> }
            </details>
          }
          @if (!account.discovery?.complete) {
            <button type="button" [disabled]="discovery.busy() || store.vaultKind() !== 'unlocked'" (click)="discovery.advance(selectedPortfolio()!.id, account)">Check next address batch</button>
          }
          @if (account.discovery) {
            <p>Restart clears saved derived-address progress, then checks the range from index zero. Account labels and key material stay saved.</p>
            <button type="button" [disabled]="discovery.busy() || store.vaultKind() !== 'unlocked'" (click)="discovery.restart(selectedPortfolio()!.id, account)">Restart address range</button>
          }
        </section>
      }
    }
    @if (discovery.busy()) {
      <p role="status">Checked {{ discovery.checked() }} addresses in this batch.</p>
      <button type="button" (click)="discovery.cancel()">Cancel discovery</button>
    }
    @if (discovery.message()) { <p role="status">{{ discovery.message() }}</p> }
  `,
})
export class WatchOnlyDiscoveryComponent {
  readonly selectedPortfolio = signal<LocalPortfolio | null>(null);
  @Input() set portfolio(value: LocalPortfolio | null) { this.selectedPortfolio.set(value); }
  readonly store = inject(PortfoliosStore);
  readonly discovery = inject(WatchOnlyDiscoveryService);
  private scope = '';

  constructor() {
    effect(() => {
      const portfolio = this.selectedPortfolio();
      const scope = JSON.stringify([this.store.vaultKind(), portfolio?.id, portfolio?.accounts.map(account =>
        [account.id, account.kind, account.chain, account.network, account.xpub, account.descriptor])]);
      if (scope !== this.scope) { this.scope = scope; this.discovery.cancel(); }
    });
  }
}
