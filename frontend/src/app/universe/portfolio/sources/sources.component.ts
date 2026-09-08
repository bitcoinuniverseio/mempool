/**
 * Sources: the coverage disclosure - what every authority answered for
 * this portfolio, with serving mode, checkpoint, and release identity.
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { truncateIdentifier } from '../shared/exact';
import type { PortfolioRequestState } from '../shared/request-state';
import type { PortfolioV2CoverageEntry } from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-portfolio-sources',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sources">
      @if (requestState() === 'loading') {
        <p class="soft" role="status">Reading source coverage…</p>
      }
      @if (requestState() === 'error') {
        <section class="failure" role="alert">
          <strong>Source coverage could not be read.</strong>
          <p>
            The provider failure is not an empty source roster. Retry from the
            portfolio header.
          </p>
        </section>
      }
      @if (requestState() === 'ready' && entries().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.sources.empty">
          The provider answered successfully and returned no source coverage for
          this address.
        </p>
      }
      @if (entries().length > 0) {
        <table>
          <caption
            class="visually-hidden"
            i18n="@@universe.portfolio.sources.caption"
          >
            Source coverage per protocol with state and checkpoints
          </caption>
          <thead>
            <tr>
              <th scope="col" i18n="@@universe.portfolio.sources.protocol">
                Protocol
              </th>
              <th scope="col" i18n="@@universe.portfolio.sources.authority">
                Authority
              </th>
              <th scope="col" i18n="@@universe.portfolio.sources.serving">
                Serving
              </th>
              <th scope="col" i18n="@@universe.portfolio.sources.state">
                State
              </th>
              <th scope="col" i18n="@@universe.portfolio.sources.checkpoint">
                Checkpoint
              </th>
            </tr>
          </thead>
          <tbody>
            @for (entry of entries(); track entry.protocol) {
              <tr>
                <td>{{ entry.protocol }}</td>
                <td class="mono">{{ entry.authorityId ?? '-' }}</td>
                <td>{{ entry.servingMode }}</td>
                <td><app-portfolio-data-state [state]="entry.state" /></td>
                <td class="mono">
                  {{
                    entry.checkpoint === null
                      ? '-'
                      : height(entry.checkpoint.heightAtomic)
                  }}
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="soft" i18n="@@universe.portfolio.sources.note">
          Every answer names its source release and chain checkpoint, so a
          number can always be traced to the authority and block it came from.
        </p>
      }
    </div>
  `,
  styles: [
    `
      .sources {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th,
      td {
        text-align: left;
        padding: 7px 6px;
        border-bottom: 1px solid var(--u-separator, rgba(0, 0, 0, 0.06));
      }
      th {
        font-size: 11.5px;
        text-transform: uppercase;
        color: var(--u-fg-soft, inherit);
      }
      .mono {
        font-family: monospace;
        font-size: 12px;
      }
      .soft {
        font-size: 12.5px;
        color: var(--u-fg-soft, inherit);
      }
      .failure {
        border: 1px solid
          var(--u-evidence-unavailable-border, rgba(160, 40, 40, 0.4));
        border-radius: 10px;
        padding: 12px 14px;
        background: var(--u-evidence-unavailable-bg, rgba(160, 40, 40, 0.07));
        font-size: 13px;
      }
      .failure p {
        margin: 4px 0 0;
        color: var(--u-fg-soft, inherit);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class SourcesComponent implements OnInit {
  readonly store = inject(PortfoliosStore);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  private readonly entriesSignal = signal<readonly PortfolioV2CoverageEntry[]>(
    []
  );
  readonly entries = this.entriesSignal.asReadonly();
  private readonly requestStateSignal =
    signal<PortfolioRequestState>('loading');
  readonly requestState = this.requestStateSignal.asReadonly();
  private loaded = false;

  ngOnInit(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.load();
  }

  private async load(): Promise<void> {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) {
      this.requestStateSignal.set('ready');
      return;
    }
    const account = portfolio.accounts.find(
      (candidate) => (candidate.addresses?.length ?? 0) > 0
    );
    if (account === undefined || account.addresses![0] === undefined) {
      this.requestStateSignal.set('ready');
      return;
    }
    try {
      const coverage = await firstValueFrom(
        this.api.getCoverage$(
          account.chain,
          account.network,
          account.addresses![0]
        )
      );
      this.entriesSignal.set(coverage.roster);
      this.requestStateSignal.set('ready');
    } catch {
      this.requestStateSignal.set('error');
    }
  }

  protected height(value: string): string {
    return truncateIdentifier(value, 9, 4);
  }
}
