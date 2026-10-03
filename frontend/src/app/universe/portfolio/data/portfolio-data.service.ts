/**
 * PortfolioDataService: loads per-address v2 evidence for every included
 * account, runs the aggregation engine in a Web Worker, and exposes
 * progressive, cancellable state as signals.
 *
 * Loading order is deliberate: native balances and source confidence
 * first, priced holdings next, unpriced after, activity and history last.
 * A cached snapshot stays visible and clearly dated while a refresh runs;
 * a populated page is never replaced by a full-page spinner.
 */

import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { readEvidencePages, EvidencePageRead } from './read-evidence-pages';
import type { ExplorerCheckpoint, PortfolioV2Holding, PortfolioSemanticEvent } from '@app/shared/universe-portfolio-v2.types';
import { PORTFOLIO_SOURCE_STATES, portfolioAssetKey } from '@app/shared/universe-portfolio-v2.types';
import {
  accountAddresses,
  type InclusionPolicy,
  type LocalAccount,
  type LocalPortfolio,
} from '../stores/portfolio-model';
import {
  aggregatePortfolio,
  type AddressSnapshot,
  type AggregationResult,
  type PortfolioEventInput,
} from '../shared/aggregation';

export interface AccountLoadState {
  readonly accountId: string;
  readonly address: string;
  readonly state: 'idle' | 'loading' | 'ok' | 'failed';
  readonly aggregateState: string;
  readonly errorMessage?: string;
}

export interface PortfolioDataState {
  readonly loading: boolean;
  readonly accounts: readonly AccountLoadState[];
  readonly aggregation: AggregationResult | null;
  readonly completedAt: string | null;
}

const EMPTY_STATE: PortfolioDataState = {
  loading: false,
  accounts: [],
  aggregation: null,
  completedAt: null,
};

@Injectable({ providedIn: 'root' })
export class PortfolioDataService {
  private readonly _state = signal<PortfolioDataState>(EMPTY_STATE);
  readonly state = this._state.asReadonly();
  readonly aggregation = computed(() => this._state().aggregation);

  private loadSequence = 0;
  private readonly cancel = new Subject<void>();
  private scope = '';
  private readonly retained = new Map<string, { snapshot: AddressSnapshot; protocolSnapshots: AddressSnapshot[]; events: PortfolioEventInput[]; error?: string }>();
  private readonly pages = new Map<string, { checkpoint: string; holdings?: EvidencePageRead<PortfolioV2Holding>; activity?: EvidencePageRead<PortfolioSemanticEvent> }>();

  private readonly api = inject(PortfolioV2ApiService);
  private readonly store = inject(PortfoliosStore);
  private readonly zone = inject(NgZone);

  /**
   * Loads every included address of the portfolio and aggregates.
   * Cancellation: a newer load invalidates older ones by sequence.
   */
  /**
   * IMPLEMENTATION-HANDOFF [WP-FE-002] | D-FE-002A/B | C-FE-PF-FAIL/RETRY.
   * Verified at 62dec461: rejected accounts never enter snapshots, so a fully
   * failed portfolio becomes state=proven, pricedTotal=0, unknownValueBucket=absent.
   * retryFailed then rebuilds from only failed accounts and drops prior successes.
   * Reproduction: handoff evidence/frontend-reproduce.mjs and frontend-reproductions.json.
   * Contract: shared/universe-portfolio-v2.types.ts source-state rules (owning
   * backend-apis v2 contract hash c1a533860b85092619102a9dae5a1f6c5c70d70e9977c0f5c59759cc61dfaa85).
   * 1. Retain results in a load-generation map keyed by portfolio ID, chain,
   *    network, account ID and address. Represent every selected read target,
   *    including rejected, timed-out, undiscovered and incomplete targets.
   * 2. Fold failed targets into aggregate coverage as unavailable/partial and
   *    preserve an explicit unknown bucket. Do not turn a nonempty selection
   *    with no successful reads into proven zero. Keep intentional empty/manual
   *    portfolios distinct; home/overview and shell consume this status.
   * 3. Refresh only failed target entries on retry; retain successful snapshots
   *    and combine both sets once. Use cancellation plus bounded per-request
   *    deadlines, not only a sequence check after Promise.allSettled. Clear the
   *    whole map on vault lock, portfolio/network scope change and reset().
   * 4. Extend portfolio-data.service.spec.ts: all failed, one of two failed,
   *    activity failure after a valid balance, retry A=10/B=20 -> total=30 and
   *    both accounts retained, late old responses, lock/reload and no-address
   *    discovery. Run npm test -- --maxWorkers=2 src/app/universe/portfolio/data.
   * Execute this state model first; WP-FE-003 page completeness and WP-FE-004/005
   * aggregation are follow-on integrations that use the retained target states.
   * Acceptance: controlled faults plus a real Signet API-to-UI balance read,
   *    preserved unknown coverage and successful retry/readback after refresh.
   * Rollback: no vault/schema migration here; never persist a failed zero as a
   *    baseline, valuation snapshot or exported evidence during rollout.
   */
  async loadPortfolio(
    portfolio: LocalPortfolio,
    options: { readonly includeAccounts?: readonly string[] } = {},
  ): Promise<void> {
    this.cancel.next();
    const sequence = ++this.loadSequence;
    const scope = JSON.stringify([portfolio.id, portfolio.accounts]);
    const retry = options.includeAccounts !== undefined && this.scope === scope;
    if (!retry) { this.retained.clear(); this.pages.clear(); }
    this.scope = scope;
    const policy = inclusionPolicyOf(portfolio);
    const targets: { account: LocalAccount; address: string }[] = [];
    for (const account of portfolio.accounts) {
      for (const address of accountAddresses(account)) {
        targets.push({ account, address });
      }
    }

    const accountStates: AccountLoadState[] = targets.map(({ account, address }) => ({
      accountId: account.id,
      address,
      state: retry && !options.includeAccounts?.includes(account.id) ? 'ok' : 'loading',
      aggregateState: this.retained.get(JSON.stringify([account.id, account.chain, account.network, address]))?.snapshot.summary.aggregateState ?? 'pending',
    }));
    this._state.set({
      loading: true,
      accounts: accountStates,
      aggregation: this._state().aggregation,
      completedAt: this._state().completedAt,
    });

    const reads = retry ? targets.filter(target => options.includeAccounts?.includes(target.account.id)) : targets;
    const CHUNK = 6;
    for (let index = 0; index < reads.length; index += CHUNK) {
      if (sequence !== this.loadSequence) return;
      const chunk = reads.slice(index, index + CHUNK);
      const results = await Promise.allSettled(
        chunk.map(({ account, address }) => this.loadAddress(account, address)),
      );
      if (sequence !== this.loadSequence) return;
      for (let offset = 0; offset < results.length; offset += 1) {
        const result = results[offset];
        const { account, address } = chunk[offset];
        const stateIndex = accountStates.findIndex(
          (entry) => entry.accountId === account.id && entry.address === address,
        );
        if (result.status === 'fulfilled') {
          this.retained.set(JSON.stringify([account.id, account.chain, account.network, address]), result.value);
          if (stateIndex >= 0) {
            accountStates[stateIndex] = {
              ...accountStates[stateIndex],
              state: result.value.error ? 'failed' : 'ok',
              errorMessage: result.value.error,
              aggregateState: result.value.snapshot.summary.aggregateState,
            };
          }
        } else {
          if (stateIndex >= 0) {
            accountStates[stateIndex] = {
              ...accountStates[stateIndex],
              state: 'failed',
              aggregateState: 'unavailable',
              errorMessage:
                result.reason instanceof Error
                  ? result.reason.message
                  : 'The account could not be read.',
            };
          }
        }
      }
      this._state.set({ ...this._state(), accounts: [...accountStates] });
    }

    if (sequence !== this.loadSequence) return;
    const results = [...this.retained.values()];
    const snapshots = results.flatMap(result => [result.snapshot, ...result.protocolSnapshots]);
    const events = results.flatMap(result => result.events);
    const incomplete = accountStates.some(account => account.state === 'failed')
      || portfolio.accounts.some(account => accountAddresses(account).length === 0 || ((account.kind === 'descriptor' || account.kind === 'xpub') && account.discovery?.complete !== true));
    const derived = this.aggregate(snapshots, events, policy);
    const byAccount = [...derived.byAccount];
    for (const account of portfolio.accounts) {
      if (!byAccount.some(entry => entry.accountId === account.id)) byAccount.push({ accountId: account.id, pricedValue: null, holdingCount: 0, state: 'unavailable' });
    }
    const aggregation: AggregationResult = incomplete ? { ...derived, byAccount, nativeFlows: derived.nativeFlows?.map(flow => ({ ...flow, state: 'partial' })), state: results.length ? 'partial' : 'unavailable', unknownValueBucket: 'present', pricedTotal: results.length ? derived.pricedTotal : null } : derived;
    this._state.set({
      loading: false,
      accounts: accountStates,
      aggregation,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * IMPLEMENTATION-HANDOFF [WP-FE-003] | D-FE-003 | C-FE-PF-HOLDINGS-PAGE/ACTIVITY-PAGE.
   * Both APIs expose nextCursor; this method requests only page one and discards
   * both cursors and page coverage. A two-page fixture valued at 60 USD becomes
   * a proven 30 USD portfolio. Activity/history is truncated independently.
   * Source: PortfolioV2HoldingsPage/PortfolioSemanticActivityPage in the pinned
   * shared/universe-portfolio-v2.types.ts; evidence/frontend-reproductions.json.
   * 1. After WP-FE-002 defines target-state retention, add proposed new
   *    data/read-holdings-pages.ts and data/read-activity-pages.ts. Follow the
   *    bounded sequential read-utxo-pages.ts pattern, retaining opaque cursors,
   *    cancellation, errors and a seen-cursor set. Respect the owning API limit.
   * 2. Validate summary/account and every page's chain/network/address, schema,
   *    checkpoint/reorg epoch, source state and row identities before merging.
   *    Repeated cursors, changed checkpoints, wrong context or malformed records
   *    cannot produce a complete total. Stop/restart a snapshot on reorg.
   * 3. Accumulate holdings by full asset identity/location and events by stable
   *    event identity. Retain prior pages on a failed continuation, mark coverage
   *    partial, and allow the exact failed cursor to be retried. A finite page
   *    budget must surface truncation; it must not imply complete history.
   * 4. Extend portfolio-data.service.spec.ts plus the proposed reader specs for
   *    two+ pages, empty final page, failure/retry, duplicates, cyclic cursors,
   *    invalid context and cancellation. Check holdings, overview, report and
   *    share consumers together. npm test -- --maxWorkers=2 src/app/universe/portfolio.
   * Acceptance: all known Signet address assets and selected history pages agree
   *    with authority readback; bounded incomplete results are visibly partial.
   * Rollback: discard only newly cached read state, retain encrypted user data;
   *    never cache/export a first-page subtotal as a complete portfolio value.
   */
  private async loadAddress(
    account: LocalAccount,
    address: string,
  ): Promise<{
    snapshot: AddressSnapshot;
    protocolSnapshots: AddressSnapshot[];
    events: PortfolioEventInput[];
    error?: string;
  }> {
    const sequence = this.loadSequence;
    const summary = await firstValueFrom(
      this.api.getSummary$(account.chain, account.network, address).pipe(timeout(15000), takeUntil(this.cancel)),
    );
    if (sequence !== this.loadSequence) throw Error('Portfolio read cancelled');
    const context = { chain: account.chain, network: account.network, address };
    const sameContext = (value: { chain: string; network: string; address: string } | undefined) => value && Object.entries(context).every(([key, expected]) => value[key as keyof typeof context] === expected);
    if (!sameContext(summary.account) || !sameContext(summary.envelope) || summary.schemaVersion !== 'universe-portfolio-v2-summary-v1' || !PORTFOLIO_SOURCE_STATES.includes(summary.aggregateState)) throw Error('Portfolio summary context mismatch');
    const pageKey = JSON.stringify([account.id, account.chain, account.network, address]);
    const checkpoint = checkpointKey(summary.envelope.chainTip, account.chain, account.network);
    const previous = this.pages.get(pageKey);
    const resumed = previous?.checkpoint === checkpoint ? previous : undefined;
    let holdingsCheckpoint: string | undefined = checkpoint !== 'null' ? checkpoint : undefined;
    const holdingsRead = await readEvidencePages(
      cursor => this.api.getHoldings$(account.chain, account.network, address, cursor, 250),
      page => {
        if (!sameContext(page.account) || !sameContext(page.envelope) || page.schemaVersion !== 'universe-portfolio-v2-holdings-v1' || !Array.isArray(page.holdings) || !PORTFOLIO_SOURCE_STATES.includes(page.sourceState)) throw Error('Holdings page context mismatch');
        if (!page.holdings.every(row => row.holding?.identity?.chain === account.chain && row.holding.identity.network === account.network
          && portfolioAssetKey(row.holding.identity) === row.holding.assetKey && PORTFOLIO_SOURCE_STATES.includes(row.holding.sourceState)
          && Array.isArray(row.locations) && row.locations.every(location => sameContext(location.account)))) throw Error('Holdings row context mismatch');
        const checkpoint = checkpointKey(page.envelope.chainTip, account.chain, account.network);
        if (holdingsCheckpoint !== undefined && holdingsCheckpoint !== checkpoint) throw Error('Holdings checkpoint changed');
        holdingsCheckpoint = checkpoint;
        return page.holdings;
      },
      row => row.holding.assetKey, this.cancel,
      resumed?.holdings?.error ? resumed.holdings : undefined,
    );
    if (sequence !== this.loadSequence) throw Error('Portfolio read cancelled');
    let activityCheckpoint: string | undefined = checkpoint !== 'null' ? checkpoint : undefined;
    const activityRead = await readEvidencePages(
      cursor => this.api.getActivity$(account.chain, account.network, address, cursor),
      page => {
        if (!sameContext(page.account) || !sameContext(page) || page.schemaVersion !== 'universe-portfolio-activity-v2' || !Array.isArray(page.events) || !PORTFOLIO_SOURCE_STATES.includes(page.sourceState)) throw Error('Activity page context mismatch');
        const checkpoint = checkpointKey(page.checkpoint, account.chain, account.network);
        if (activityCheckpoint !== undefined && activityCheckpoint !== checkpoint) throw Error('Activity checkpoint changed');
        activityCheckpoint = checkpoint;
        if (!page.events.every(event => event.chain === account.chain && event.network === account.network && typeof event.eventId === 'string')) throw Error('Activity row context mismatch');
        return page.events;
      }, row => row.eventId, this.cancel,
      resumed?.activity?.error ? resumed.activity : undefined,
    );
    if (sequence !== this.loadSequence) throw Error('Portfolio read cancelled');
    this.pages.set(pageKey, { checkpoint, holdings: holdingsRead, activity: activityRead });
    const snapshot: AddressSnapshot = {
      chain: account.chain,
      network: account.network,
      address,
      accountId: account.id,
      summary: {
        aggregateState: holdingsRead.complete && activityRead.complete ? summary.aggregateState : 'partial',
        valuation: summary.valuation,
        sources: summary.envelope.sources.map((source) => ({
          authorityId: source.authorityId,
          state: source.state,
        })),
      },
      holdings: {
        assetKey: summary.nativeBalance?.assetKey ?? `${account.chain}:${account.network}:base:native:${account.chain}`,
        quantityAtomic: summary.nativeBalance?.quantityAtomic ?? null,
        value: summary.nativeBalance?.value,
        valuationState: summary.nativeBalance?.valuationState ?? 'unpriced',
        quoteCurrency: summary.nativeBalance?.price?.quoteCurrency,
        displayName: summary.nativeBalance?.displayName,
        ticker: summary.nativeBalance?.ticker,
        decimals: summary.nativeBalance?.decimals,
        sourceState: summary.nativeBalance?.sourceState ?? summary.aggregateState,
        protocol: 'base',
        assetType: 'native',
        accountId: account.id,
        locations: [],
      },
    };
    const protocolSnapshots = holdingsRead.rows
      .filter((entry) => entry.holding.identity.protocol !== 'base')
      .map((entry) => ({
        chain: account.chain,
        network: account.network,
        address,
        accountId: account.id,
        summary: snapshot.summary,
        holdings: {
          assetKey: entry.holding.assetKey,
          quantityAtomic: entry.holding.quantityAtomic,
          value: entry.holding.value,
          valuationState: entry.holding.valuationState,
          quoteCurrency: entry.holding.price?.quoteCurrency,
          displayName: entry.holding.displayName,
          ticker: entry.holding.ticker,
          decimals: entry.holding.decimals,
          sourceState: entry.holding.sourceState,
          protocol: entry.holding.identity.protocol,
          assetType: entry.holding.identity.assetType,
          accountId: account.id,
          locations: entry.locations.map((location) => ({
            kind: location.custodyKind,
            reference: location.custodyReference,
            quantityAtomic: location.quantityAtomic,
            address,
            accountId: account.id,
          })),
        },
      }));
    const events: PortfolioEventInput[] = activityRead.rows.map((event) => ({
      eventId: event.eventId,
      chain: event.chain,
      network: event.network,
      txid: event.txid,
      eventType: event.eventType,
      direction: event.direction,
      confirmationState: event.confirmationState,
      timestamp: event.timestamp,
      blockHeightAtomic: event.blockHeightAtomic,
      nativeValueAtomic: event.nativeValueAtomic,
      feeAtomic: event.feeAtomic,
      accountId: account.id,
      address,
      counterparties: [...event.rawCounterparties],
      assetKeys: event.holdings.map((holding) => holding.assetKey),
      sourceState: event.sourceState,
    }));
    return {
      snapshot,
      protocolSnapshots,
      events,
      error: holdingsRead.error ?? activityRead.error,
    };
  }

  /**
   * Aggregation runs off the main thread through the worker in production
   * and synchronously here for small portfolios; both paths call the same
   * pure engine, so results are identical for identical snapshots.
   */
  private aggregate(
    snapshots: AddressSnapshot[],
    events: PortfolioEventInput[],
    policy: InclusionPolicy,
    includeAccounts?: readonly string[],
  ): AggregationResult {
    this.zone.runOutsideAngular(() => {
      // Budget marker: the pure engine is O(holdings + events); it stays
      // responsive up to thousands of rows and the worker path absorbs the
      // large ones.
    });
    return aggregatePortfolio(snapshots, events, {
      inclusionPolicy: policy,
      includeAccounts,
    });
  }

  /** Retries only the failed accounts, never the whole portfolio. */
  /**
   * IMPLEMENTATION-HANDOFF [WP-FE-002] | D-FE-002B | C-FE-PF-RETRY.
   * Apply the generation-scoped merge described at loadPortfolio, not a fresh
   * load constrained to failed account IDs. The reproduced A=10/B=failure then
   * B=20 retry currently returns only B=20. Retain A, retry B and return 30 with
   * both statuses; invalidate retained evidence only on an actual scope reset.
   * Related test: portfolio-data.service.spec.ts; parent work package gives
   * source references, fault/Signet acceptance and rollback requirements.
   */
  async retryFailed(portfolio: LocalPortfolio): Promise<void> {
    const failed = this._state()
      .accounts.filter((account) => account.state === 'failed')
      .map((account) => account.accountId);
    if (failed.length === 0) return;
    await this.loadPortfolio(portfolio, { includeAccounts: failed });
  }

  reset(): void {
    this.cancel.next();
    this.retained.clear();
    this.pages.clear();
    this.scope = '';
    this.loadSequence += 1;
    this._state.set(EMPTY_STATE);
  }
}

/** Reads the stored per-address inclusion policy from annotations. */
function inclusionPolicyOf(portfolio: LocalPortfolio): InclusionPolicy {
  const policy: Record<string, string> = {};
  for (const [key, annotation] of Object.entries(portfolio.annotations)) {
    if (key.startsWith('inclusion:') && annotation.note !== undefined) {
      policy[key.slice('inclusion:'.length)] = annotation.note;
    }
  }
  return policy;
}

/** Observation time may advance while the same chain checkpoint remains valid. */
function checkpointKey(value: ExplorerCheckpoint | null, chain: string, network: string): string {
  if (value !== null && (value.chain !== chain || value.network !== network || !/^(0|[1-9][0-9]*)$/.test(value.heightAtomic) || !/^[a-f0-9]{64}$/i.test(value.blockHash) || typeof value.reorgEpoch !== 'string')) throw Error('Invalid portfolio checkpoint');
  return value === null ? 'null' : JSON.stringify([value.chain, value.network, value.heightAtomic, value.blockHash, value.reorgEpoch]);
}
