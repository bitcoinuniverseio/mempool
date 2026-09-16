import { EMPTY, catchError, defer, expand, last, map, of, timeout } from 'rxjs';
import { PortfolioV2ApiService } from './portfolio-v2-api.service';
import { AccountReadTarget, matchesAccount } from './account-read-scope';
import { PortfolioUtxo, PortfolioUtxoPage, PORTFOLIO_SOURCE_STATES } from '@app/shared/universe-portfolio-v2.types';

export function readUtxoPages(api: PortfolioV2ApiService, target: AccountReadTarget) {
  return defer(() => {
    const rows = new Map<string, PortfolioUtxo>();
    const cursors = new Set<string>();
    const warnings = new Set<string>();
    let pages = 0;
    const accept = (page: PortfolioUtxoPage) => {
      if (!matchesAccount(page, target) || !matchesAccount(page.account, target) || !Array.isArray(page.utxos)
        || page.utxos.length > 100 || !Array.isArray(page.warnings) || !page.warnings.every(warning => typeof warning === 'string') || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw Error('Malformed page');
      for (const row of page.utxos) {
        if (row.chain !== target.chain || row.network !== target.network || !/^[a-f0-9]{64}$/i.test(row.txid)
          || !Number.isSafeInteger(row.vout) || row.vout < 0 || row.vout > 0xffffffff || !/^\d{1,16}$/.test(row.valueAtomic)
          || !/^\d{1,16}$/.test(row.confirmationsAtomic) || typeof row.scriptType !== 'string'
          || !Array.isArray(row.assets) || !Array.isArray(row.warnings) || !row.warnings.every(warning => typeof warning === 'string')
          || !PORTFOLIO_SOURCE_STATES.includes(row.assetState)
          || typeof row.coinbase !== 'boolean' || typeof row.pending !== 'boolean' || typeof row.spent !== 'boolean') throw Error('Malformed output');
      }
      pages++;
      for (const row of page.utxos) {
        const key = `${row.chain}:${row.network}:${row.txid.toLowerCase()}:${row.vout}`;
        const prior = rows.get(key);
        if (prior && JSON.stringify(prior) !== JSON.stringify(row)) warnings.add('Conflicting repeated outpoint observations; first observation retained, coverage partial.');
        else rows.set(key, row);
      }
      page.warnings.forEach(warning => warnings.add(warning));
      if (page.sourceState !== 'proven') warnings.add(`Source coverage: ${page.sourceState}.`);
      if (page.nextCursor !== null) {
        if (!page.nextCursor || cursors.has(page.nextCursor)) throw Error('Repeated cursor');
        cursors.add(page.nextCursor);
        if (pages >= 50 || rows.size >= 5000) {
          warnings.add('Read limit reached; additional UTXOs were not requested.');
          return { ...page, nextCursor: null };
        }
      }
      return page;
    };
    const request = (cursor?: string) => api.getUtxos$(target.chain, target.network, target.address, cursor, 100).pipe(timeout(15000), map(accept));
    return request().pipe(
      expand(page => page.nextCursor === null ? EMPTY : request(page.nextCursor), 1),
      last(),
      map(() => ({ target, utxos: [...rows.values()], status: warnings.size ? 'Partial source coverage' : 'All returned pages read', warnings: [...warnings] })),
      catchError(() => of({ target, utxos: [...rows.values()], status: 'Unavailable or incomplete; retained earlier pages', warnings: [...warnings, 'A page could not be read or validated. Coverage is partial.'] })),
    );
  });
}
