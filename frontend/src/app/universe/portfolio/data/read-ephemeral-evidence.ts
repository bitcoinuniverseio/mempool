import { firstValueFrom, Observable, Subject, takeUntil, timeout } from 'rxjs';
import { PORTFOLIO_SOURCE_STATES, portfolioAssetKey } from '@app/shared/universe-portfolio-v2.types';
import type { ExplorerCheckpoint, PortfolioV2HoldingsPage, PortfolioSemanticActivityPage, PortfolioV2SummaryResponse } from '@app/shared/universe-portfolio-v2.types';
import { PortfolioV2ApiService } from './portfolio-v2-api.service';
import { readEvidencePages } from './read-evidence-pages';

export interface EphemeralEvidence {
  summary: PortfolioV2SummaryResponse;
  holdings: PortfolioV2HoldingsPage | null;
  activity: PortfolioSemanticActivityPage | null;
  warnings: string[];
}

/** Public transient read only. The observable teardown cancels every pending HTTP page. */
export function readEphemeralEvidence(api: PortfolioV2ApiService, chain: string, network: string, address: string): Observable<EphemeralEvidence> {
  return new Observable(observer => {
    const cancel = new Subject<void>();
    const same = (value: { chain: string; network: string; address: string } | undefined) => !!value && value.chain === chain && value.network === network && value.address === address;
    const checkpoint = (value: ExplorerCheckpoint | null): string => {
      if (value !== null && (value.chain !== chain || value.network !== network || !/^(0|[1-9][0-9]*)$/.test(value.heightAtomic) || !/^[a-f0-9]{64}$/i.test(value.blockHash) || typeof value.reorgEpoch !== 'string')) throw Error('Invalid checkpoint');
      return value === null ? 'null' : JSON.stringify([value.chain, value.network, value.heightAtomic, value.blockHash, value.reorgEpoch]);
    };
    void (async () => {
      const summary = await firstValueFrom(api.getSummary$(chain, network, address).pipe(timeout(15000), takeUntil(cancel)));
      if (observer.closed) return;
      if (!same(summary.account) || !same(summary.envelope) || summary.schemaVersion !== 'universe-portfolio-v2-summary-v1' || !PORTFOLIO_SOURCE_STATES.includes(summary.aggregateState)) throw Error('Invalid summary identity');
      const initial = checkpoint(summary.envelope.chainTip);
      let holdingsCheckpoint: string | undefined = initial === 'null' ? undefined : initial;
      let activityCheckpoint: string | undefined = initial === 'null' ? undefined : initial;
      let holdingsPage: PortfolioV2HoldingsPage | null = null;
      let activityPage: PortfolioSemanticActivityPage | null = null;
      const [holdings, activity] = await Promise.all([
        readEvidencePages(cursor => api.getHoldings$(chain, network, address, cursor, 250), page => {
          if (!same(page.account) || !same(page.envelope) || page.schemaVersion !== 'universe-portfolio-v2-holdings-v1' || !Array.isArray(page.holdings) || !PORTFOLIO_SOURCE_STATES.includes(page.sourceState)) throw Error('Invalid holdings identity');
          const current = checkpoint(page.envelope.chainTip);
          if (holdingsCheckpoint !== undefined && current !== holdingsCheckpoint) throw Error('Holdings checkpoint changed');
          if (!page.holdings.every(row => row.holding?.identity?.chain === chain && row.holding.identity.network === network && portfolioAssetKey(row.holding.identity) === row.holding.assetKey && PORTFOLIO_SOURCE_STATES.includes(row.holding.sourceState) && Array.isArray(row.locations) && row.locations.every(location => same(location.account)))) throw Error('Invalid holding identity');
          holdingsCheckpoint = current; holdingsPage = page; return page.holdings;
        }, row => row.holding.assetKey, cancel),
        readEvidencePages(cursor => api.getActivity$(chain, network, address, cursor), page => {
          if (!same(page) || !same(page.account) || page.schemaVersion !== 'universe-portfolio-activity-v2' || !Array.isArray(page.events) || !PORTFOLIO_SOURCE_STATES.includes(page.sourceState)) throw Error('Invalid activity identity');
          const current = checkpoint(page.checkpoint);
          if (activityCheckpoint !== undefined && current !== activityCheckpoint) throw Error('Activity checkpoint changed');
          if (!page.events.every(event => event.chain === chain && event.network === network && typeof event.eventId === 'string')) throw Error('Invalid event identity');
          activityCheckpoint = current; activityPage = page; return page.events;
        }, row => row.eventId, cancel),
      ]);
      if (observer.closed) return;
      const warnings: string[] = [];
      if (!holdings.complete) warnings.push(holdings.error ? 'Holdings read is incomplete or unavailable; accepted rows retained.' : 'Holdings source coverage is not complete.');
      if (!activity.complete) warnings.push(activity.error ? 'Activity read is incomplete or unavailable; accepted events retained.' : 'Activity source coverage is not complete.');
      if (holdings.nextCursor) warnings.push('More holdings remain beyond the bounded read; this view is partial.');
      if (activity.nextCursor) warnings.push('More activity remains beyond the bounded read; this view is partial.');
      const acceptedHoldings = holdingsPage as PortfolioV2HoldingsPage | null;
      const acceptedActivity = activityPage as PortfolioSemanticActivityPage | null;
      observer.next({ summary: { ...summary, aggregateState: holdings.complete && activity.complete ? summary.aggregateState : 'partial' }, holdings: acceptedHoldings ? { ...acceptedHoldings, holdings: holdings.rows, nextCursor: holdings.nextCursor ?? null, sourceState: holdings.complete ? acceptedHoldings.sourceState : 'partial' } : null, activity: acceptedActivity ? { ...acceptedActivity, events: activity.rows, nextCursor: activity.nextCursor ?? null, sourceState: activity.complete ? acceptedActivity.sourceState : 'partial' } : null, warnings });
      observer.complete();
    })().catch(error => { if (!observer.closed) observer.error(error); });
    return () => { cancel.next(); cancel.complete(); };
  });
}
