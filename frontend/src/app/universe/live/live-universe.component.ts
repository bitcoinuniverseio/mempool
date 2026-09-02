import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AsyncPipe, CommonModule, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StateService } from '@app/services/state.service';
import { UniverseWebsocketService } from '@app/universe/universe-websocket.service';
import { merge } from 'rxjs';
import {
  BufferReport,
  ChannelSummary,
  EMPTY_FILTER,
  LiveEntry,
  LiveFilter,
  ageWords,
  appendEnvelopes,
  filterEntries,
  summarize,
} from './live-buffer';

/**
 * The live universe, on one page.
 *
 * What this page shows is exactly what this deployment's stream delivered
 * while the page has been open: the buffer is the truth, the scrubber walks
 * that buffer, and the status board says how old each channel's last word
 * is. Replay reaches back to the moment this view opened and no further,
 * and it says so instead of implying an archive.
 *
 * Pause freezes the view, not the recording: arrivals keep filling the
 * buffer while the visitor reads an earlier moment, and jumping back to
 * live catches up without gaps the buffer ever saw.
 */

const CHAINS = ['bitcoin', 'dogecoin', 'zcash'] as const;

const EMPTY_BUFFER: BufferReport = { entries: [], evicted: 0, duplicates: 0, gaps: [] };

type Verbose = 'off' | 'key';

@Component({
  selector: 'app-universe-live',
  standalone: true,
  imports: [CommonModule, AsyncPipe, DatePipe],
  templateUrl: './live-universe.component.html',
  styleUrls: ['./live-universe.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveUniverseComponent {
  private readonly stateService = inject(StateService);
  private readonly websocket = inject(UniverseWebsocketService);
  private readonly destroyRef = inject(DestroyRef);

  readonly buffer = signal<BufferReport>(EMPTY_BUFFER);
  readonly paused = signal(false);
  /** Where the view reads in the filtered buffer. At the end means live. */
  readonly position = signal<number | null>(null);
  readonly filter = signal<LiveFilter>({ ...EMPTY_FILTER });
  readonly verbosity = signal<Verbose>('key');
  readonly reducedMotion = signal(false);
  readonly announcement = signal('');
  readonly now = signal(Date.now());

  readonly chains = CHAINS;
  readonly channels = ['chain-status', 'mempool-snapshot', 'candidate-buckets', 'confirmed-protocol-activity'] as const;
  readonly completions = ['complete', 'partial', 'unavailable'] as const;

  constructor() {
    if (this.stateService.isBrowser && typeof matchMedia !== 'undefined') {
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion.set(query.matches);
      query.addEventListener?.('change', (event) => this.reducedMotion.set(event.matches));

      merge(...CHAINS.map((chain) => this.websocket.stream$(chain)))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((envelope) => {
          this.buffer.set(appendEnvelopes(this.buffer(), [envelope], Date.now()));
          this.announce(envelope.chain, envelope.channel, envelope.completeness);
        });

      // Ages are words, not ticking numbers, so the page stays calm.
      setInterval(() => this.now.set(Date.now()), 5_000);
    }
  }

  private announce(chain: string, channel: string, completeness: string): void {
    if (this.verbosity() === 'off' || this.paused()) { return; }
    this.announcement.set(`${chain} ${channel.replace(/-/g, ' ')}, ${completeness}`);
  }

  readonly filtered = computed<readonly LiveEntry[]>(() =>
    filterEntries(this.buffer().entries, this.filter()));

  /** The slice the view reads: the paused position, or the live edge. */
  readonly visible = computed<readonly LiveEntry[]>(() => {
    const entries = this.filtered();
    const position = this.position();
    if (this.paused() && position !== null) {
      return entries.slice(0, position + 1).slice(-VISIBLE_ROWS);
    }
    return entries.slice(-VISIBLE_ROWS);
  });

  readonly summaries = computed<readonly ChannelSummary[]>(() =>
    summarize(this.buffer().entries, this.buffer().gaps));

  readonly atLiveEdge = computed<boolean>(() => !this.paused() || this.position() === null);

  readonly scrubMax = computed<number>(() => Math.max(0, this.filtered().length - 1));

  setFilter(key: keyof LiveFilter, value: string): void {
    this.filter.set({ ...this.filter(), [key]: value === '' ? null : value });
    this.position.set(null);
  }

  togglePause(): void {
    if (this.paused()) {
      this.paused.set(false);
      this.position.set(null);
      return;
    }
    // Freezing the view at the newest filtered row; arrivals continue into
    // the buffer behind it.
    this.position.set(Math.max(0, this.filtered().length - 1));
    this.paused.set(true);
  }

  jumpToLive(): void {
    this.paused.set(false);
    this.position.set(null);
  }

  onScrub(value: number): void {
    this.paused.set(true);
    this.position.set(value);
  }

  setVerbosity(value: Verbose): void {
    this.verbosity.set(value);
  }

  /** An arrival's age in words, against the page's own clock. */
  ageWordsAt(receivedAt: number): string {
    return ageWords(receivedAt, this.now());
  }
}

const VISIBLE_ROWS = 30;
