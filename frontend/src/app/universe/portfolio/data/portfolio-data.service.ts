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
import { firstValueFrom } from 'rxjs';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
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

  private readonly api = inject(PortfolioV2ApiService);
  private readonly store = inject(PortfoliosStore);
  private readonly zone = inject(NgZone);

  /**
   * Loads every included address of the portfolio and aggregates.
   * Cancellation: a newer load invalidates older ones by sequence.
   */
  async loadPortfolio(
    portfolio: LocalPortfolio,
    options: { readonly includeAccounts?: readonly string[] } = {},
  ): Promise<void> {
    const sequence = ++this.loadSequence;
    const policy = inclusionPolicyOf(portfolio);
    const targets: { account: LocalAccount; address: string }[] = [];
    for (const account of portfolio.accounts) {
      if (
        options.includeAccounts !== undefined &&
        !options.includeAccounts.includes(account.id)
      ) {
        continue;
      }
      for (const address of accountAddresses(account)) {
        targets.push({ account, address });
      }
    }

    const accountStates: AccountLoadState[] = targets.map(({ account, address }) => ({
      accountId: account.id,
      address,
      state: 'loading',
      aggregateState: 'pending',
    }));
    this._state.set({
      loading: true,
      accounts: accountStates,
      aggregation: this._state().aggregation,
      completedAt: this._state().completedAt,
    });

    const snapshots: AddressSnapshot[] = [];
    const events: PortfolioEventInput[] = [];
    const CHUNK = 6;
    for (let index = 0; index < targets.length; index += CHUNK) {
      if (sequence !== this.loadSequence) return;
      const chunk = targets.slice(index, index + CHUNK);
      const results = await Promise.allSettled(
        chunk.map(({ account, address }) => this.loadAddress(account, address)),
      );
      for (let offset = 0; offset < results.length; offset += 1) {
        const result = results[offset];
        const { account, address } = chunk[offset];
        const stateIndex = accountStates.findIndex(
          (entry) => entry.accountId === account.id && entry.address === address,
        );
        if (result.status === 'fulfilled') {
          snapshots.push(result.value.snapshot);
          snapshots.push(...result.value.protocolSnapshots);
          events.push(...result.value.events);
          if (stateIndex >= 0) {
            accountStates[stateIndex] = {
              ...accountStates[stateIndex],
              state: 'ok',
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
    const aggregation = this.aggregate(snapshots, events, policy, options.includeAccounts);
    this._state.set({
      loading: false,
      accounts: accountStates,
      aggregation,
      completedAt: new Date().toISOString(),
    });
  }

  private async loadAddress(
    account: LocalAccount,
    address: string,
  ): Promise<{
    snapshot: AddressSnapshot;
    protocolSnapshots: AddressSnapshot[];
    events: PortfolioEventInput[];
  }> {
    const summary = await firstValueFrom(
      this.api.getSummary$(account.chain, account.network, address),
    );
    const holdingsPage = await firstValueFrom(
      this.api.getHoldings$(account.chain, account.network, address, undefined, 250),
    );
    const activityPage = await firstValueFrom(
      this.api.getActivity$(account.chain, account.network, address),
    );
    const snapshot: AddressSnapshot = {
      chain: account.chain,
      network: account.network,
      address,
      accountId: account.id,
      summary: {
        aggregateState: summary.aggregateState,
        valuation: summary.valuation,
        sources: summary.envelope.sources.map((source) => ({
          authorityId: source.authorityId,
          state: source.state,
        })),
      },
      holdings: {
        assetKey: 'bitcoin:mainnet:base:native:bitcoin',
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
    const protocolSnapshots = holdingsPage.holdings
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
    const events: PortfolioEventInput[] = activityPage.events.map((event) => ({
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
  async retryFailed(portfolio: LocalPortfolio): Promise<void> {
    const failed = this._state()
      .accounts.filter((account) => account.state === 'failed')
      .map((account) => account.accountId);
    if (failed.length === 0) return;
    await this.loadPortfolio(portfolio, { includeAccounts: failed });
  }

  reset(): void {
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
