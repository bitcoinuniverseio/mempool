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
  AddressReading,
  BlockReading,
  ChainProfile,
  ChainShape,
  CollectionReading,
  EmptyListReading,
  Fact,
  OutpointReading,
  ProtocolReading,
  ReadCapability,
  StatusReading,
  TransactionListReading,
  TransactionReading,
  chainProfile,
  classifyPayload,
  readAddress,
  readBlock,
  readCapabilities,
  readCollection,
  readEmptyList,
  readIdentifierList,
  readNotReadyReasons,
  readOutpoint,
  readProtocolCoverage,
  readRecordFacts,
  readStatusRail,
  readTransaction,
  readTransactionList,
  shortenIdentifier,
} from '@app/universe/multichain-explorer/multichain-view';
import { ChainReasonReading } from '@app/universe/multichain-explorer/chain-reasons';
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
  readonly rail: readonly StatusReading[];
  /** Why the chain withholds readiness. Null when it does not. */
  readonly notReady: readonly ChainReasonReading[] | null;
  readonly reads: readonly ReadCapability[];
  readonly protocols: readonly ProtocolReading[];
  readonly shape: ChainShape;
  readonly transaction: TransactionReading | null;
  readonly block: BlockReading | null;
  readonly address: AddressReading | null;
  readonly outpoint: OutpointReading | null;
  readonly collection: CollectionReading | null;
  readonly transactionList: TransactionListReading | null;
  readonly emptyList: EmptyListReading | null;
  readonly facts: readonly Fact[];
  /** True when the page is showing a response it has no purpose-built reading for. */
  readonly generic: boolean;
}

interface RequestContext {
  readonly page: MultichainPage;
  readonly params: ParamMap;
  readonly ruleset?: string;
  /** 1-based list page, from the `page` query parameter. */
  readonly listPage: number;
}

/** Rows a paged list requests at a time. Also the offset step. */
const LIST_PAGE_SIZE = 100;

function listPageFrom(value: string | null): number {
  if (!value || !/^[1-9][0-9]{0,5}$/.test(value)) {
    return 1;
  }
  return Number(value);
}

const PAGE_KINDS: Partial<Record<MultichainPage, UniverseEntryKind>> = {
  block: 'block',
  transaction: 'transaction',
  address: 'address',
  outpoint: 'outpoint',
  'protocol-detail': 'protocol',
};

/**
 * Fields a purpose-built reading already presents. They are skipped when the
 * page lists the remaining scalars, so a value never appears twice: once in
 * its designed place and again in the leftover record.
 */
const PRESENTED_FIELDS: Partial<Record<ChainShape, readonly string[]>> = {
  transaction: [
    'schemaVersion', 'chain', 'network', 'txid', 'status', 'block', 'fee',
    'transparent', 'shielded', 'protocolActions', 'replacement', 'expiry',
    'confirmationsAtomic', 'sizeBytesAtomic', 'virtualSizeBytesAtomic',
    'firstSeenAt', 'completeness',
  ],
  block: [
    'chain', 'network', 'block', 'pagination',
    // The Zcash spellings, read by the block reading rather than dumped.
    'schemaVersion', 'hash', 'height', 'prev_hash', 'time', 'tx_count',
    'transactions',
    // What the source says about its own coverage of the chain. The status
    // rail already states every one of these from the capability document,
    // and a second copy as a nested field table is not a second fact.
    'checkpoint', 'coverage',
  ],
  address: [
    'chain', 'network', 'address', 'balanceAtomic', 'totalReceivedAtomic',
    'totalSentAtomic', 'unconfirmedBalanceAtomic', 'transactionCountAtomic',
    'unconfirmedTransactionsAtomic',
  ],
  outpoint: ['chain', 'network', 'outpoint', 'output', 'transaction'],
  collection: ['chain', 'network'],
  record: ['chain', 'network'],
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
  readonly profile: ChainProfile;
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
    this.profile = chainProfile(this.chain);
    this.chainName = this.profile.name;
    this.ticker = this.profile.ticker;
    this.protocolIds = this.profile.protocols.map((tab) => tab.id);
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
        listPage: listPageFrom(queryParams.get('page')),
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
        this.seo.setDescription(this.pageDescription(context));
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
          map(([status, result]): ExplorerViewModel =>
            this.viewModel(status.capability, status.error, result.payload, result.error)
          )
        );
      }),
      takeUntil(this.destroyed$)
    );
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  private viewModel(
    capability: ChainCapabilityEnvelope | null,
    capabilityError: string | null,
    payload: ChainExplorerPayload | null,
    payloadError: string | null
  ): ExplorerViewModel {
    const shape = classifyPayload(payload);
    const transaction = payload && shape === 'transaction' ? readTransaction(payload, this.profile) : null;
    const block = payload && shape === 'block' ? readBlock(payload) : null;
    const address = payload && shape === 'address' ? readAddress(payload, this.profile) : null;
    const outpoint = payload && shape === 'outpoint' ? readOutpoint(payload, this.profile) : null;
    // A list of whole transaction envelopes gets read as transactions. Only
    // what is left over falls through to the generic table.
    const transactionList =
      payload && shape === 'collection'
        ? readTransactionList(payload, this.profile)
        : null;
    const collection =
      payload && !transactionList && (shape === 'collection' || shape === 'record')
        ? readCollection(payload, this.profile)
        : null;
    const skip = [
      ...(PRESENTED_FIELDS[shape] ?? []),
      ...(collection ? [collection.sourceKey] : []),
      // The transaction list owns the array it read, whichever field it was in.
      ...(transactionList ? ['transactions', 'items'] : []),
    ];
    return {
      capability,
      capabilityError,
      payload,
      payloadError,
      rail: readStatusRail(capability, this.profile, Date.now()),
      notReady: readNotReadyReasons(capability),
      reads: readCapabilities(capability),
      protocols: readProtocolCoverage(capability, this.profile),
      shape,
      transaction,
      block,
      address,
      outpoint,
      collection,
      transactionList,
      emptyList: transactionList || collection ? null : readEmptyList(payload),
      facts: readRecordFacts(payload, this.profile, skip),
      generic: shape === 'collection' || shape === 'record',
    };
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

  /** True when this page addresses a single object a visitor can save. */
  savable(): boolean {
    return !!PAGE_KINDS[this.page] && !!this.reference;
  }

  pageLabel(): string {
    switch (this.page) {
      case 'dashboard':
        return $localize`:@@universe.chain.page-dashboard:overview`;
      case 'mempool':
        return $localize`:@@universe.chain.page-mempool:pending transactions`;
      case 'block':
        return $localize`:@@universe.chain.page-block:block`;
      case 'transaction':
        return $localize`:@@universe.chain.page-transaction:transaction`;
      case 'address':
        return $localize`:@@universe.chain.page-address:address`;
      case 'outpoint':
        return $localize`:@@universe.chain.page-outpoint:outpoint`;
      case 'protocols':
        return $localize`:@@universe.chain.page-protocols:protocols`;
      case 'protocol-list':
        return $localize`:@@universe.chain.page-protocol-list:protocol assets`;
      case 'protocol-detail':
        return $localize`:@@universe.chain.page-protocol-detail:protocol asset`;
      case 'protocol-holders':
        return $localize`:@@universe.chain.page-protocol-holders:holders`;
      case 'protocol-events':
        return $localize`:@@universe.chain.page-protocol-events:events`;
      default:
        return '';
    }
  }

  /** One sentence saying what the reader is looking at, under the heading. */
  pageLede(): string {
    switch (this.page) {
      case 'dashboard':
        return $localize`:@@universe.chain.lede-dashboard:What this explorer can answer about ${this.chainName}:CHAIN: right now, and how far behind the chain tip each answer is.`;
      case 'mempool':
        return $localize`:@@universe.chain.lede-mempool:Transactions seen by our own ${this.chainName}:CHAIN: node and not yet in a block.`;
      case 'protocols':
        return $localize`:@@universe.chain.lede-protocols:The asset protocols this explorer indexes on ${this.chainName}:CHAIN:, and the state of each indexer.`;
      default:
        return '';
    }
  }

  /** Query parameters for a link to another page of the current list. */
  pageLink(page: number): Record<string, string> {
    return { page: String(page) };
  }

  isProtocolPage(): boolean {
    return this.page.startsWith('protocol');
  }

  activeProtocolId(): string {
    return this.route.snapshot.paramMap.get('protocol') ?? '';
  }

  short(value: string, lead = 8): string {
    return shortenIdentifier(value, lead);
  }

  identifierList(values: unknown): readonly string[] {
    return readIdentifierList(values);
  }

  trackByIndex(index: number): number {
    return index;
  }

  /** "3 inscriptions and 2 ZRune events", in the reader's language. */
  unlistedSummary(entries: readonly { label: string; count: number }[]): string {
    const parts = entries.map((entry) => `${entry.count} ${entry.label.toLowerCase()}`);
    if (parts.length < 2) {
      return parts.join('');
    }
    const last = parts[parts.length - 1];
    return $localize`:@@universe.chain.list-join:${parts.slice(0, -1).join(', ')}:ITEMS: and ${last}:LAST:`;
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackByKey(_index: number, item: { key: string }): string {
    return item.key;
  }

  trackByProtocol(_index: number, item: { protocolId: string }): string {
    return item.protocolId;
  }

  trackByText(_index: number, value: string): string {
    return value;
  }

  trackByTxid(_index: number, item: { txid: string }): string {
    return item.txid;
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
        return this.api.getChainBlock$(
          this.chain,
          reference,
          LIST_PAGE_SIZE,
          (context.listPage - 1) * LIST_PAGE_SIZE
        );
      case 'address':
        return this.api.getChainAddress$(
          this.chain,
          reference,
          LIST_PAGE_SIZE,
          (context.listPage - 1) * LIST_PAGE_SIZE
        );
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

  /**
   * What a shared link to this page says it is.
   *
   * Without this every chain page fell back to the site description, so a
   * Dogecoin transaction and the Zcash protocol list previewed identically
   * wherever a link was pasted.
   */
  private pageDescription(context: RequestContext): string {
    const reference = this.referenceFrom(context);
    switch (context.page) {
      case 'dashboard':
        return $localize`:@@universe.chain.meta-dashboard:What Universe Explorer can answer about ${this.chainName}:CHAIN: right now, how far behind the chain tip each answer is, and which protocol indexers are running.`;
      case 'mempool':
        return $localize`:@@universe.chain.meta-mempool:${this.chainName}:CHAIN: transactions seen by Bitcoin Universe's own node and not yet in a block, read from first-party data.`;
      case 'protocols':
        return $localize`:@@universe.chain.meta-protocols:The asset protocols Universe Explorer indexes on ${this.chainName}:CHAIN:, and the state and coverage of each indexer.`;
      case 'transaction':
        return $localize`:@@universe.chain.meta-transaction:${this.chainName}:CHAIN: transaction ${reference}:REFERENCE:: its state, transparent value, and the protocol actions the authority reported, with the evidence behind each.`;
      case 'block':
        return $localize`:@@universe.chain.meta-block:${this.chainName}:CHAIN: block ${reference}:REFERENCE:: its header facts and the transactions it contains, from first-party data.`;
      case 'address':
        return $localize`:@@universe.chain.meta-address:${this.chainName}:CHAIN: address ${reference}:REFERENCE:: balance, history, and unspent outputs, with the block each figure is true as of.`;
      case 'outpoint':
        return $localize`:@@universe.chain.meta-outpoint:${this.chainName}:CHAIN: output ${reference}:REFERENCE:: what it carries and whether it has been spent.`;
      default:
        return $localize`:@@universe.chain.meta-generic:${this.chainName}:CHAIN: data from Bitcoin Universe's own node and protocol indexers, with the evidence behind every claim.`;
    }
  }

  /**
   * The tab title. The chain is already the suffix the SEO service appends, so
   * naming it here too produced "Dogecoin dashboard - Universe Explorer -
   * Dogecoin". It also said "dashboard" where the heading said "overview".
   */
  private pageTitle(context: RequestContext): string {
    const label = this.pageLabel();
    const reference = this.referenceFrom(context);
    const subject = label.charAt(0).toUpperCase() + label.slice(1);
    return reference ? `${subject} ${reference}` : subject;
  }

  private errorMessage(error: unknown): string {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? String((error as { status: unknown }).status)
        : '';
    if (status === '404') {
      return $localize`:@@universe.chain.error-not-found:The ${this.chainName}:CHAIN: authority has no record of this object. It may not exist, or it may be outside the range this indexer covers.`;
    }
    if (status === '503') {
      return $localize`:@@universe.chain.error-unavailable:The ${this.chainName}:CHAIN: authority is not answering right now. Nothing here is stale data presented as current: the page shows no facts rather than old ones.`;
    }
    if (status === '400') {
      return $localize`:@@universe.chain.error-malformed:That identifier is not a valid ${this.chainName}:CHAIN: reference, so no lookup was made.`;
    }
    return $localize`:@@universe.chain.error-generic:The request to the ${this.chainName}:CHAIN: authority did not complete.`;
  }
}
