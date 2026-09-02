import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Network } from '@app/shared/regex.utils';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseSearchResponse } from '@app/universe/universe.types';
import { explorerChainFromUrl } from '@app/universe/universe-chain-routing';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import {
  CommandCandidate,
  candidatesFromSearch,
  dedupeCandidates,
  localCandidates,
  looksSecretLike,
} from './command-candidates';
import {
  CommandQuery,
  filterLabel,
  parseCommandQuery,
} from './command-query';
import {
  BatchRow,
  batchCsv,
  batchJson,
  batchRow,
  splitBatch,
} from './command-batch';
import {
  StoredQuery,
  loadRecent,
  loadSaved,
  pushRecent,
  removeSaved,
  saveQuery,
} from './command-history';
import { isEditable, nextIndex, shouldOpen, type ListKey } from './command-keyboard';

/**
 * The command center.
 *
 * One surface, available from every page, that turns whatever a visitor has
 * into the page about it: an identifier, a filter query, a batch of lines, a
 * QR image. It resolves as much as it can without the network, asks the
 * index for the rest, and never picks between equally plausible readings on
 * the visitor's behalf.
 *
 * The boundaries it holds are the product's boundaries: text that looks like
 * key material is named and refused before any request exists, a filter the
 * grammar does not know is shown back rather than swallowed, and a filter
 * this deployment cannot enforce is labelled as recorded, not applied.
 */

export interface ResultGroup {
  readonly title: string;
  readonly candidates: readonly CommandCandidate[];
}

type Panel = 'results' | 'batch';

/** Groups whose rows re-run a stored query rather than navigate. */
const STORED_KINDS = new Set(['recent', 'saved']);

@Component({
  selector: 'app-universe-command-palette',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent {
  private readonly router = inject(Router);
  private readonly stateService = inject(StateService);
  private readonly universeApi = inject(UniverseApiService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('dialogElement') dialogElement?: ElementRef<HTMLElement>;
  @ViewChild('queryInput') queryInput?: ElementRef<HTMLInputElement>;

  readonly open = signal(false);
  readonly mode = signal<Panel>('results');
  readonly value = signal('');
  readonly allChains = signal(true);
  readonly selected = signal<number | null>(null);
  readonly recent = signal<readonly StoredQuery[]>([]);
  readonly saved = signal<readonly StoredQuery[]>([]);
  readonly batchText = signal('');
  readonly batchRows = signal<readonly BatchRow[]>([]);
  readonly batchDropped = signal(0);
  readonly qrSupported = signal(false);
  readonly qrMessage = signal<string | null>(null);
  readonly remoteFailures = signal<readonly string[]>([]);

  private readonly remoteCandidates = signal<readonly CommandCandidate[]>([]);
  private readonly queryText$ = new Subject<string>();
  private lastFocus: HTMLElement | null = null;

  /** The parsed view of the current input. Chips and text render from this. */
  readonly parsed = computed<CommandQuery>(() => parseCommandQuery(this.value()));

  readonly secretLike = computed(() => looksSecretLike(this.parsed().text));

  /** Local readings of the text: deterministic, no request involved. */
  readonly localResults = computed<readonly CommandCandidate[]>(() => {
    if (this.mode() === 'batch' || this.secretLike()) { return []; }
    const parsed = this.parsed();
    return applyEnforcedFilters(
      dedupeCandidates(localCandidates(parsed.text, safeNetwork(this.stateService.network))),
      parsed,
    );
  });

  readonly groups = computed<readonly ResultGroup[]>(() => {
    const groups: ResultGroup[] = [];
    const local = this.localResults();
    if (local.length) { groups.push({ title: 'This looks like', candidates: local }); }
    const remote = this.remoteCandidates();
    if (remote.length) { groups.push({ title: 'From the index', candidates: remote }); }
    if (!this.value().trim()) {
      if (this.recent().length) {
        groups.push({ title: 'Recent', candidates: this.recent().map((entry) => this.storedCandidate(entry, 'recent')) });
      }
      if (this.saved().length) {
        groups.push({ title: 'Saved', candidates: this.saved().map((entry) => this.storedCandidate(entry, 'saved')) });
      }
    }
    return groups;
  });

  /** Every visible row, flattened in group order, for keyboard selection. */
  readonly flatList = computed<readonly CommandCandidate[]>(() =>
    this.groups().flatMap((group) => group.candidates));

  constructor() {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      this.qrSupported.set(true);
    }
    this.recent.set(loadRecent(safeStorage()));
    this.saved.set(loadSaved(safeStorage()));

    /**
     * The remote part of the results.
     *
     * Debounced and switched, so a fast typist leaves at most one request in
     * flight and a changed mind cancels the one before it. Text that looks
     * like key material never reaches this stream at all.
     */
    this.queryText$.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((text) => {
        const parsed = parseCommandQuery(text);
        if (!parsed.text || looksSecretLike(parsed.text)) {
          return of(null);
        }
        return this.universeApi.search$(parsed.text, this.activeChain, this.allChains()).pipe(
          catchError(() => of(null)),
        );
      }),
      map((response) => this.absorbRemote(response)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();
  }

  /** The active chain, from wherever in the explorer the palette was opened. */
  get activeChain(): 'bitcoin' | 'dogecoin' | 'zcash' {
    return explorerChainFromUrl(this.router.url) as 'bitcoin' | 'dogecoin' | 'zcash';
  }

  private absorbRemote(response: UniverseSearchResponse | null): void {
    if (!response) {
      this.remoteCandidates.set([]);
      this.remoteFailures.set([]);
      return;
    }
    this.remoteCandidates.set(applyEnforcedFilters(candidatesFromSearch(response.groups ?? []), this.parsed()));
    this.remoteFailures.set((response.failures ?? []).map((failure) => `${failure.chain}: ${failure.code}`));
  }

  /** Opens the palette and remembers where the visitor came from. */
  show(): void {
    if (this.open()) { return; }
    this.lastFocus = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    this.open.set(true);
    this.recent.set(loadRecent(safeStorage()));
    this.saved.set(loadSaved(safeStorage()));
    queueMicrotask(() => this.queryInput?.nativeElement.focus());
  }

  hide(): void {
    if (!this.open()) { return; }
    this.open.set(false);
    this.mode.set('results');
    this.selected.set(null);
    this.qrMessage.set(null);
    this.lastFocus?.focus?.();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKey(event: KeyboardEvent): void {
    if (this.open()) { return; }
    if (shouldOpen(event.key, event.ctrlKey || event.metaKey, isEditable(event.target))) {
      event.preventDefault();
      this.show();
    }
  }

  onInputKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
      return;
    }
    if (this.mode() === 'batch') { return; }
    const key = event.key as ListKey;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault();
      this.selected.set(nextIndex(key, this.selected(), this.flatList().length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const flat = this.flatList();
      if (!flat.length) { return; }
      const index = Math.min(this.selected() ?? 0, flat.length - 1);
      this.choose(flat[index]);
    }
  }

  onValueChange(text: string): void {
    this.value.set(text);
    this.selected.set(null);
    this.queryText$.next(text);
  }

  choose(candidate: CommandCandidate): void {
    if (STORED_KINDS.has(candidate.kind)) {
      this.chooseStored(candidate);
      return;
    }
    pushRecent(safeStorage(), this.value().trim());
    this.recent.set(loadRecent(safeStorage()));
    this.hide();
    this.router.navigateByUrl(candidate.path);
  }

  /** Re-runs a recent or saved query instead of navigating somewhere. */
  chooseStored(candidate: CommandCandidate): void {
    const query = candidate.label;
    if (candidate.kind === 'saved') {
      removeSaved(safeStorage(), query);
      this.saved.set(loadSaved(safeStorage()));
    }
    this.setMode('results');
    this.onValueChange(query);
  }

  saveCurrent(): void {
    const query = this.value().trim();
    if (!query) { return; }
    saveQuery(safeStorage(), query);
    this.saved.set(loadSaved(safeStorage()));
  }

  setMode(mode: Panel): void {
    this.mode.set(mode);
    this.selected.set(null);
  }

  toggleAllChains(): void {
    this.allChains.set(!this.allChains());
    if (this.value().trim()) {
      this.queryText$.next(this.value());
    }
  }

  // Batch panel

  onBatchText(text: string): void {
    this.batchText.set(text);
  }

  runBatch(): void {
    const { lines, dropped } = splitBatch(this.batchText());
    this.batchDropped.set(dropped);
    const network = safeNetwork(this.stateService.network);
    this.batchRows.set(lines.map((line) => {
      const parsed = parseCommandQuery(line);
      if (looksSecretLike(parsed.text)) {
        return {
          value: line,
          candidates: [],
          note: 'Looks like key material. It was not sent anywhere.',
        } as BatchRow;
      }
      return batchRow(line, dedupeCandidates(localCandidates(parsed.text, network)));
    }));
  }

  exportBatch(format: 'json' | 'csv'): void {
    const rows = this.batchRows();
    if (!rows.length) { return; }
    const content = format === 'json' ? batchJson(rows) : batchCsv(rows);
    const blob = new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/csv',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `universe-batch.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // QR input: pasting decoded text works everywhere; an image is decoded
  // locally where the browser provides the detector. Nothing is uploaded.

  async onQrImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) { return; }
    if (!('BarcodeDetector' in window)) {
      this.qrMessage.set('This browser cannot read QR images.');
      return;
    }
    try {
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      const value = codes?.[0]?.rawValue ?? null;
      if (value) {
        this.setMode('results');
        this.onValueChange(value);
        this.qrMessage.set(null);
      } else {
        this.qrMessage.set('No QR code found in that image.');
      }
    } catch {
      this.qrMessage.set('The image could not be read.');
    }
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this.setMode('results');
        this.onValueChange(text.trim());
      } else {
        this.qrMessage.set('The clipboard is empty.');
      }
    } catch {
      this.qrMessage.set('The browser refused clipboard access. Paste into the field instead.');
    }
  }

  optionId(index: number): string {
    return `universe-command-option-${index}`;
  }

  /** The index of a row in the flattened list, from its group and row. */
  flatIndex(groupIndex: number, rowIndex: number): number {
    const groups = this.groups();
    let count = 0;
    for (let i = 0; i < groupIndex; i++) {
      count += groups[i].candidates.length;
    }
    return count + rowIndex;
  }

  removeSavedFromList(query: string): void {
    removeSaved(safeStorage(), query);
    this.saved.set(loadSaved(safeStorage()));
  }

  isStored(candidate: CommandCandidate): boolean {
    return STORED_KINDS.has(candidate.kind);
  }

  sourceLabel(candidate: CommandCandidate): string {
    if (candidate.authority) { return candidate.authority; }
    switch (candidate.source) {
      case 'universe-index': return 'index';
      case 'chain-node': return 'node';
      default: return 'pattern';
    }
  }

  recordedNote(): string {
    const deferred = this.parsed().deferred;
    if (!deferred.length) { return ''; }
    const names = [...new Set(deferred.map((filter) => filterLabel(filter.key)))].join(', ');
    return `Recorded, not yet enforced by this deployment: ${names}.`;
  }

  unknownNote(): string {
    const unknown = this.parsed().unknown;
    if (!unknown.length) { return ''; }
    return `Not understood, left in the text: ${unknown.map((filter) => filter.raw).join(', ')}.`;
  }

  private storedCandidate(entry: StoredQuery, kind: 'recent' | 'saved'): CommandCandidate {
    return {
      kind, chain: null, label: entry.query, path: `command:${kind}`,
      source: 'pattern', exact: false,
    };
  }
}

function applyEnforcedFilters(
  candidates: readonly CommandCandidate[],
  parsed: CommandQuery,
): readonly CommandCandidate[] {
  return candidates.filter((candidate) => {
    if (parsed.chain && candidate.chain && candidate.chain !== parsed.chain) { return false; }
    if (parsed.kind && !(candidate.kind === parsed.kind || candidate.kind.includes(parsed.kind))) {
      return false;
    }
    return true;
  });
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function safeNetwork(network: string): Network {
  const known: Network[] = ['mainnet', 'testnet', 'testnet4', 'signet', 'regtest', 'liquid', 'liquidtestnet'];
  return known.includes(network as Network) ? network as Network : 'mainnet';
}
