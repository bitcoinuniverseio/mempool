import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  PortfolioWatchlistService,
  WatchedAddress,
  watchKey,
} from '@app/universe/portfolio/portfolio-watchlist.service';
import { PortfolioApiService } from '@app/universe/portfolio/portfolio-api.service';
import { PortfolioSummary } from '@app/universe/portfolio/portfolio.types';
import {
  AddressOutcome,
  WorkspaceAggregate,
  aggregateCsv,
  aggregateJson,
  aggregateWorkspace,
} from './workspace-aggregate';
import { ImportResult, importCsv, importJson } from './workspace-import';

/**
 * The private, local first portfolio workspace.
 *
 * The watchlist is the visitor's own, stored only in this browser, and this
 * page is where a whole watchlist becomes one picture: what each address
 * holds, what the holdings add up to, and which sources answered. Three
 * rules hold throughout:
 *
 * 1. Everything that identifies the visitor stays in the browser. Labels,
 *    groups, and the list of addresses themselves are local data; the
 *    server sees only the ordinary per address reads any portfolio page
 *    makes.
 * 2. Sums are exact. Native balances add as arbitrary precision integers,
 *    valuations add as scale aligned decimals within their own quote
 *    currency.
 * 3. A failed authority is a named failure. It never becomes a zero, and a
 *    partial total is labelled by what it covers.
 */

const REFRESH_BATCH = 25;
const REFRESH_GAP_MS = 400;

@Component({
  selector: 'app-universe-portfolio-workspace',
  standalone: true,
  imports: [CommonModule, RouterLink, DecimalPipe],
  templateUrl: './workspace.component.html',
  styleUrls: ['./workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioWorkspaceComponent {
  private readonly api = inject(PortfolioApiService);
  private readonly watchlistService = inject(PortfolioWatchlistService);
  private readonly destroyRef = inject(DestroyRef);

  readonly watched = signal<readonly WatchedAddress[]>([]);
  readonly results = signal<ReadonlyMap<string, { summary: PortfolioSummary | null; reason: string | null }>>(new Map());
  readonly refreshing = signal(false);
  readonly progress = signal({ done: 0, total: 0 });
  readonly importReport = signal<ImportResult | null>(null);
  readonly imported = signal(0);

  private cancelled = false;

  /** The whole picture, recomputed from the current results every read. */
  aggregate(): WorkspaceAggregate {
    return aggregateWorkspace(this.results(), this.watched());
  }

  constructor() {
    this.watched.set(this.watchlistService.snapshot());
    this.destroyRef.onDestroy(() => {
      this.cancelled = true;
    });
  }

  async refresh(): Promise<void> {
    if (this.refreshing()) { return; }
    const list = this.watched().slice(0, REFRESH_BATCH);
    this.cancelled = false;
    this.refreshing.set(true);
    this.progress.set({ done: 0, total: list.length });
    const next = new Map(this.results());

    for (let i = 0; i < list.length; i++) {
      if (this.cancelled) { break; }
      const entry = list[i];
      try {
        const response = await firstValueFrom(
          this.api.getSummary$(entry.chain, entry.network, entry.address),
        );
        next.set(watchKey(entry), { summary: response?.summary ?? null, reason: null });
      } catch (error) {
        const message = (error as { message?: string })?.message;
        next.set(watchKey(entry), { summary: null, reason: message || 'The authority did not answer.' });
      }
      this.results.set(new Map(next));
      this.progress.set({ done: i + 1, total: list.length });
      if (i < list.length - 1) {
        await sleep(REFRESH_GAP_MS);
      }
    }
    this.refreshing.set(false);
  }

  cancelRefresh(): void {
    this.cancelled = true;
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) { return; }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const result = /\.json$/i.test(file.name) ? importJson(text) : importCsv(text);
      this.importReport.set(result);
      let count = 0;
      for (const entry of result.entries) {
        this.watchlistService.watch({
          chain: entry.chain,
          network: entry.network,
          address: entry.address,
          label: entry.label,
          group: entry.group,
        });
        count += 1;
      }
      this.imported.set(count);
      this.watched.set(this.watchlistService.snapshot());
    };
    reader.readAsText(file);
  }

  exportAggregate(format: 'json' | 'csv'): void {
    const aggregate = aggregateWorkspace(this.results(), this.watched());
    if (!aggregate.readyCount && !aggregate.failedCount) { return; }
    const content = format === 'json' ? aggregateJson(aggregate) : aggregateCsv(aggregate);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `workspace.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  outcomeFor(entry: WatchedAddress): AddressOutcome | null {
    return this.aggregate()
      .outcomes.find((outcome) => outcome.entry === entry) ?? null;
  }

  remove(entry: WatchedAddress): void {
    this.watchlistService.unwatch(entry.chain, entry.network, entry.address);
    const next = new Map(this.results());
    next.delete(watchKey(entry));
    this.results.set(next);
    this.watched.set(this.watchlistService.snapshot());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
