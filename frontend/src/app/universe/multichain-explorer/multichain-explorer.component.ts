import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {
  ActivatedRoute,
  ParamMap,
  Router,
  RouterModule,
} from '@angular/router';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseWebsocketService } from '@app/universe/universe-websocket.service';
import {
  UniverseEntryKind,
  UniverseLocalService,
} from '@app/universe/universe-local.service';
import {
  ChainCapabilityEnvelope,
  ChainExplorerPayload,
  ExplorerChain,
} from '@app/universe/universe.types';
import {
  Observable,
  Subject,
  catchError,
  combineLatest,
  map,
  of,
  switchMap,
  takeUntil,
  timer,
  merge,
  auditTime,
} from 'rxjs';

type MultichainPage =
  | 'dashboard'
  | 'mempool'
  | 'block'
  | 'transaction'
  | 'address'
  | 'outpoint'
  | 'protocols'
  | 'protocol-list'
  | 'protocol-detail'
  | 'protocol-holders'
  | 'protocol-events';

interface ExplorerViewModel {
  readonly capability: ChainCapabilityEnvelope | null;
  readonly capabilityError: string | null;
  readonly payload: ChainExplorerPayload | null;
  readonly payloadError: string | null;
  readonly rows: readonly Record<string, unknown>[];
  readonly summary: readonly { key: string; value: string }[];
}

interface RequestContext {
  readonly page: MultichainPage;
  readonly params: ParamMap;
  readonly ruleset?: string;
}

const PAGE_KINDS: Partial<Record<MultichainPage, UniverseEntryKind>> = {
  block: 'block',
  transaction: 'transaction',
  address: 'address',
  outpoint: 'outpoint',
  'protocol-detail': 'protocol',
};

@Component({
  selector: 'app-multichain-explorer',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './multichain-explorer.component.html',
  styleUrls: ['./multichain-explorer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultichainExplorerComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();

  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly chainName: string;
  readonly ticker: string;
  readonly protocolIds: readonly string[];
  page: MultichainPage = 'dashboard';
  reference = '';
  saved = false;
  switchedFrom: string | null = null;
  vm$: Observable<ExplorerViewModel>;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: UniverseApiService,
    private readonly live: UniverseWebsocketService,
    private readonly local: UniverseLocalService,
    private readonly seo: SeoService
  ) {
    this.chain = this.chainFromUrl(router.url);
    this.chainName = this.chain === 'dogecoin' ? 'Dogecoin' : 'Zcash';
    this.ticker = this.chain === 'dogecoin' ? 'DOGE' : 'ZEC';
    this.protocolIds =
      this.chain === 'dogecoin'
        ? ['doginals', 'drc20', 'doge-tap']
        : ['zerdinals', 'zrunes', 'zrc20'];
  }

  ngOnInit(): void {
    const context$ = combineLatest([
      this.route.data,
      this.route.paramMap,
      this.route.queryParamMap,
    ]).pipe(
      map(([data, params, queryParams]): RequestContext => ({
        page: data.page as MultichainPage,
        params,
        ruleset: queryParams.get('ruleset') ?? undefined,
      }))
    );

    this.vm$ = context$.pipe(
      switchMap((context) => {
        this.page = context.page;
        this.reference = this.referenceFrom(context);
        this.switchedFrom =
          this.route.snapshot.queryParamMap.get('switchedFrom');
        this.saved = this.isSaved(context);
        this.seo.setTitle(this.pageTitle(context));
        this.recordVisit(context);
        return merge(timer(0, 15_000), this.live.stream$(this.chain)).pipe(
          auditTime(100),
          switchMap(() =>
            combineLatest([
              this.api.getChainStatus$(this.chain).pipe(
                map((capability) => ({ capability, error: null })),
                catchError((error) =>
                  of({ capability: null, error: this.errorMessage(error) })
                )
              ),
              this.pageRequest$(context).pipe(
                map((payload) => ({ payload, error: null })),
                catchError((error) =>
                  of({ payload: null, error: this.errorMessage(error) })
                )
              ),
            ])
          ),
          map(([status, result]): ExplorerViewModel => ({
            capability: status.capability,
            capabilityError: status.error,
            payload: result.payload,
            payloadError: result.error,
            rows: this.rowsFrom(result.payload),
            summary: this.summaryFrom(result.payload),
          }))
        );
      }),
      takeUntil(this.destroyed$)
    );
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  toggleSaved(): void {
    const kind = PAGE_KINDS[this.page];
    if (!kind || !this.reference) {
      return;
    }
    this.saved = this.local.toggleBookmark({
      chain: this.chain,
      network: 'mainnet',
      kind,
      value: this.reference,
      path: this.router.url.split('?')[0],
      label: `${this.chainName} ${this.pageLabel()} ${this.reference}`,
    });
  }

  pageLabel(): string {
    return this.page.replace('protocol-', '').replace('-', ' ');
  }

  stateLabel(capability: ChainCapabilityEnvelope): string {
    return capability.ready ? 'ready' : 'degraded';
  }

  freshness(capability: ChainCapabilityEnvelope): string {
    const observed = Date.parse(capability.updatedAt);
    if (!Number.isFinite(observed)) {
      return 'freshness unknown';
    }
    const seconds = Math.max(0, Math.floor((Date.now() - observed) / 1000));
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    return `${Math.floor(seconds / 60)}m ago`;
  }

  value(value: unknown): string {
    if (value === null || value === undefined) {
      return 'not available';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  keys(row: Record<string, unknown>): string[] {
    return Object.keys(row).slice(0, 8);
  }

  trackRow(index: number): number {
    return index;
  }

  private chainFromUrl(url: string): Exclude<ExplorerChain, 'bitcoin'> {
    return url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] === 'dogecoin'
      ? 'dogecoin'
      : 'zcash';
  }

  private pageRequest$(
    context: RequestContext
  ): Observable<ChainExplorerPayload | null> {
    const txid = context.params.get('txid') ?? '';
    const reference = context.params.get('reference') ?? '';
    const protocol = context.params.get('protocol') ?? '';
    switch (context.page) {
      case 'dashboard':
        return of(null);
      case 'mempool':
        return this.api.getChainMempool$(this.chain);
      case 'transaction':
        return this.api.getChainTransaction$(this.chain, txid);
      case 'block':
        return this.api.getChainBlock$(this.chain, reference);
      case 'address':
        return this.api.getChainAddress$(this.chain, reference);
      case 'outpoint':
        return this.api.getChainOutpoint$(
          this.chain,
          txid,
          context.params.get('vout') ?? ''
        );
      case 'protocols':
        return this.api.getChainProtocols$(this.chain);
      case 'protocol-list':
        return this.api.getChainProtocolList$(
          this.chain,
          protocol,
          100,
          0,
          context.ruleset
        );
      case 'protocol-detail':
        return this.api.getChainProtocolDetail$(
          this.chain,
          protocol,
          reference,
          context.ruleset
        );
      case 'protocol-holders':
        return this.chain === 'dogecoin'
          ? this.api.getChainProtocolSection$(
              this.chain,
              protocol,
              reference,
              'holders'
            )
          : of({
              chain: this.chain,
              network: 'mainnet',
              state: 'unavailable',
              reason: 'section-not-supported',
            });
      case 'protocol-events':
        return this.chain === 'dogecoin'
          ? this.api.getChainProtocolSection$(
              this.chain,
              protocol,
              reference,
              'events'
            )
          : of({
              chain: this.chain,
              network: 'mainnet',
              state: 'unavailable',
              reason: 'section-not-supported',
            });
    }
  }

  private referenceFrom(context: RequestContext): string {
    if (context.page === 'outpoint') {
      return `${context.params.get('txid') ?? ''}:${context.params.get('vout') ?? ''}`;
    }
    return context.params.get('txid') ?? context.params.get('reference') ?? '';
  }

  private recordVisit(context: RequestContext): void {
    const kind = PAGE_KINDS[context.page];
    if (!kind || !this.reference) {
      return;
    }
    this.local.recordVisit({
      chain: this.chain,
      network: 'mainnet',
      kind,
      value: this.reference,
      path: this.router.url.split('?')[0],
      label: `${this.chainName} ${this.pageLabel()} ${this.reference}`,
    });
  }

  private isSaved(context: RequestContext): boolean {
    const kind = PAGE_KINDS[context.page];
    return (
      !!kind &&
      !!this.reference &&
      this.local.isBookmarked(kind, this.reference, this.chain, 'mainnet')
    );
  }

  private pageTitle(context: RequestContext): string {
    const suffix = this.referenceFrom(context);
    return `${this.chainName} ${context.page.replace('-', ' ')}${suffix ? ` ${suffix}` : ''}`;
  }

  private rowsFrom(
    payload: ChainExplorerPayload | null
  ): readonly Record<string, unknown>[] {
    if (!payload) {
      return [];
    }
    for (const key of [
      'transactions',
      'items',
      'data',
      'utxos',
      'holders',
      'events',
      'outputs',
      'inputs',
    ]) {
      const candidate = payload[key];
      if (Array.isArray(candidate)) {
        return candidate
          .slice(0, 100)
          .map((item) =>
            typeof item === 'object' && item !== null
              ? (item as Record<string, unknown>)
              : { value: item }
          );
      }
    }
    return [];
  }

  private summaryFrom(
    payload: ChainExplorerPayload | null
  ): readonly { key: string; value: string }[] {
    if (!payload) {
      return [];
    }
    return Object.entries(payload)
      .filter(
        ([, value]) =>
          !Array.isArray(value) && (typeof value !== 'object' || value === null)
      )
      .slice(0, 24)
      .map(([key, value]) => ({ key, value: this.value(value) }));
  }

  private errorMessage(error: unknown): string {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? String((error as { status: unknown }).status)
        : '';
    return status ? `Request failed (${status}).` : 'Request failed.';
  }
}
