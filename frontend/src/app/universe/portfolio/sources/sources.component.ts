/**
 * Sources: the coverage disclosure - what every authority answered for
 * this portfolio, with serving mode, checkpoint, and release identity.
 */

import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { catchError, concatMap, from, map, of, timeout } from 'rxjs';
import { accountReadScope, matchesAccount } from '../data/account-read-scope';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { truncateIdentifier } from '../shared/exact';
import type { PortfolioV2CoverageEntry } from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-portfolio-sources',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sources">
      @if (loading()) { <p role="status">Reading source coverage…</p> }
      @for (warning of warnings(); track $index) { <p role="note">{{ warning }}</p> }
      @for (read of reads(); track read.key) {
        <p>{{ read.accounts.join(', ') }} · {{ read.chain }}/{{ read.network }} · {{ read.address }}: {{ read.status }}</p>
      }
      @if (entries().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.sources.empty">
          No source roster is available in the current read. See account coverage above.
        </p>
      } @else {
        <table>
          <caption class="visually-hidden" i18n="@@universe.portfolio.sources.caption">
            Source coverage per protocol with state and checkpoints
          </caption>
          <thead>
            <tr>
              <th scope="col" i18n="@@universe.portfolio.sources.protocol">Protocol</th>
              <th scope="col" i18n="@@universe.portfolio.sources.authority">Authority</th>
              <th scope="col" i18n="@@universe.portfolio.sources.serving">Serving</th>
              <th scope="col" i18n="@@universe.portfolio.sources.state">State</th>
              <th scope="col" i18n="@@universe.portfolio.sources.checkpoint">Checkpoint</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of entries(); track $index) {
              <tr>
                <td>{{ entry.scope }} · {{ entry.protocol }}</td>
                <td class="mono">{{ entry.authorityId ?? '-' }}</td>
                <td>{{ entry.servingMode }}</td>
                <td><app-portfolio-data-state [state]="entry.state" /></td>
                <td class="mono">
                  {{ entry.checkpoint === null ? '-' : height(entry.checkpoint.heightAtomic) }}
                  <br />{{ entry.releaseSha ?? 'Release unknown' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="soft" i18n="@@universe.portfolio.sources.note">
          Available release and checkpoint identities are shown. Missing identities remain unknown; this table does not prove source completeness.
        </p>
      }
    </div>
  `,
  styles: [
    `
      .sources { display: flex; flex-direction: column; gap: 10px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.06)); }
      th { font-size: 11.5px; text-transform: uppercase; color: var(--u-fg-soft, inherit); }
      .mono { font-family: monospace; font-size: 12px; }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    `,
  ],
})
export class SourcesComponent {
  readonly store = inject(PortfoliosStore);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  private readonly entriesSignal = signal<readonly (PortfolioV2CoverageEntry & { scope: string })[]>([]);
  readonly entries = this.entriesSignal.asReadonly();
  readonly loading = signal(false);
  readonly warnings = signal<readonly string[]>([]);
  readonly reads = signal<readonly { key: string; accounts: readonly string[]; chain: string; network: string; address: string; status: string }[]>([]);

  constructor() {
    effect((cleanup) => {
      const scope = accountReadScope(this.store.activePortfolio());
      this.entriesSignal.set([]);
      this.warnings.set(scope.warnings);
      this.reads.set(scope.targets.map(target => ({ ...target, status: 'Pending' })));
      this.loading.set(scope.targets.length > 0);
      const sub = from(scope.targets).pipe(concatMap(target => this.api.getCoverage$(target.chain, target.network, target.address).pipe(
        timeout(15000),
        map(coverage => {
          if (!matchesAccount(coverage.account, target) || !Array.isArray(coverage.roster)) throw new Error('Invalid source identity');
          return { target, coverage };
        }),
        catchError(() => of({ target, coverage: null })),
      ))).subscribe({
        next: ({ target, coverage }) => {
          this.reads.update(rows => rows.map(row => row.key === target.key ? { ...row, status: coverage ? 'Answered; see each source state' : 'Unavailable; coverage unknown' } : row));
          if (coverage) this.entriesSignal.update(rows => [...rows, ...coverage.roster.map(entry => ({ ...entry, scope: `${target.accounts.join(', ')} · ${target.chain}/${target.network} · ${target.address}` }))]);
        },
        complete: () => this.loading.set(false),
      });
      cleanup(() => sub.unsubscribe());
    });
  }

  protected height(value: string): string {
    return truncateIdentifier(value, 9, 4);
  }
}
