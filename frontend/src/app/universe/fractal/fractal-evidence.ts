import { Cat20Holder, Cat20Page, Cat20Token, Cat20TokenDetail, FractalObservation, FractalSourceProfile } from '../universe.types';

const hash = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const count = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const atomic = (v: unknown): boolean => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
export function requireCatTokenId(id: unknown): void {
  requireFractal(typeof id === 'string' && /^[0-9a-f]{64}_(0|[1-9][0-9]{0,9})$/.test(id) && Number(id.split('_')[1]) <= 0xffffffff, 'Invalid CAT-20 token ID.');
}
export function requireFractal(condition: unknown, message = 'The Fractal response does not match the configured source contract.'): asserts condition {
  if (!condition) throw new Error(message);
}
export function fractalProfile(value: unknown): FractalSourceProfile {
  const p = typeof value === 'string' ? JSON.parse(value) : value as FractalSourceProfile;
  requireFractal(p?.network === 'fractal-testnet' && p.release === '0.4.0' && p.sourceRevision === '8c22167f04250c7dd03afe46af4158bd08001183'
    && hash(p.configurationSha256) && hash(p.binarySha256), 'An independently measured Fractal testnet source profile is required.');
  return p;
}
export function validateFractalObservation(o: FractalObservation, p: FractalSourceProfile): void {
  requireFractal(o?.schema === 'fractal-observation-v1' && o.network === 'fractal-testnet'
    && o.genesisHash === '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
    && o.blockOneHash === '000000000021b22bb6a9718e5db62fca1eb2ac6e34535e70c67b374dcb29c570'
    && count(o.checkpoint?.height) && hash(o.checkpoint?.hash) && typeof o.ready === 'boolean'
    && typeof o.observedAt === 'string' && Number.isFinite(Date.parse(o.observedAt))
    && o.source?.network === p.network && o.source.release === p.release && o.source.sourceRevision === p.sourceRevision
    && o.source.configurationSha256 === p.configurationSha256 && o.source.binarySha256 === p.binarySha256);
}
export function validateCatToken(t: Cat20Token): void {
  requireCatTokenId(t?.tokenId);
  requireFractal(t?.schema === 'cat20-token-v1'
    && typeof t.name === 'string' && typeof t.symbol === 'string' && count(t.decimals)
    && atomic(t.circulatingSupplyAtomic) && (t.maxSupplyAtomic === null || atomic(t.maxSupplyAtomic))
    && (t.mintLimitAtomic === null || atomic(t.mintLimitAtomic)) && hash(t.deployTxid) && count(t.deployHeight)
    && t.minterAddress === null && hash(t.minterPubKey) && count(t.holderCount)
    && (t.transferCount === null || count(t.transferCount)) && [null,'open','closed','covenant'].includes(t.minterType)
    && [null,'active','minting','capped'].includes(t.state) && Array.isArray(t.unavailable) && t.unavailable.every(v => typeof v === 'string'));
}
export function validateCatHolder(h: Cat20Holder): void {
  requireFractal(h?.address === null && h.percentage === null && typeof h.ownerPubKeyHash === 'string'
    && /^[0-9a-f]{40}$/.test(h.ownerPubKeyHash) && atomic(h.balanceAtomic));
}
export function validateFractalRead<T>(data: T, schema: string, profile: FractalSourceProfile): T {
  const d = data as any;
  requireFractal(d?.schema === schema); validateFractalObservation(d.observation, profile);
  if (schema === 'fractal-tip-v1') requireFractal(d.network === 'fractal-testnet' && d.height === d.observation.checkpoint.height && d.hash === d.observation.checkpoint.hash && count(d.time));
  if (schema === 'fractal-block-v1') requireFractal(hash(d.hash) && count(d.height) && count(d.time) && count(d.txCount) && count(d.size) && count(d.weight) && hash(d.merkleRoot) && typeof d.difficulty === 'number' && Number.isFinite(d.difficulty) && d.difficulty >= 0);
  if (schema === 'fractal-mempool-v1') requireFractal(count(d.count) && count(d.totalBytes) && ['totalWeight','minFeeRate','maxFeeRate','medianFeeRate','pendingCat20TxCount'].every(k => d[k] === null) && Array.isArray(d.unavailable));
  if (schema === 'fractal-transaction-v1') {
    requireFractal(hash(d.txid) && hash(d.hash) && Number.isSafeInteger(d.version) && count(d.size) && count(d.weight) && count(d.locktime)
      && d.feeAtomic === null && d.feeState === 'unknown-prevouts' && d.cat20State === 'not-joined'
      && Array.isArray(d.vin) && Array.isArray(d.vout));
    d.vin.forEach(v => requireFractal(count(v.sequence) && (typeof v.coinbase === 'string' ? v.txid === undefined && v.vout === undefined : hash(v.txid) && count(v.vout))));
    d.vout.forEach(v => requireFractal(atomic(v.valueAtomic) && count(v.n) && typeof v.scriptPubKey?.hex === 'string' && /^(?:[0-9a-f]{2})*$/.test(v.scriptPubKey.hex)));
    requireFractal(d.blockHash === undefined || hash(d.blockHash));
  }
  if (schema === 'cat20-token-v1') { validateCatToken(d); validatePageSource(d); }
  if (schema === 'cat20-page-v1') {
    validatePageSource(d); requireFractal(Array.isArray(d.items) && d.items.length <= 500 && count(d.total) && d.items.length <= d.total
      && (d.nextCursor === null || (typeof d.nextCursor === 'string' && d.nextCursor.length > 0 && d.nextCursor.length <= 4096)));
    d.items.forEach(item => 'tokenId' in item ? validateCatToken(item) : validateCatHolder(item));
  }
  return data;
}
function validatePageSource(d: any): void {
  requireFractal(d.observation.ready && d.trackerSourceRevision === '8d5aeee7484bacc33d0014b44503c0b59d39aaff'
    && d.checkpoint?.height === d.observation.checkpoint.height && d.checkpoint?.hash === d.observation.checkpoint.hash);
}
export function mergeCatPage<T extends Cat20Token | Cat20Holder>(previous: Cat20Page<T> | undefined, page: Cat20Page<T>): Cat20Page<T> {
  const key = (row: T): string => 'tokenId' in row ? row.tokenId : row.ownerPubKeyHash;
  if (previous) requireFractal(previous.total === page.total && previous.trackerSourceRevision === page.trackerSourceRevision
    && previous.checkpoint.height === page.checkpoint.height && previous.checkpoint.hash === page.checkpoint.hash
    && ['network','release','sourceRevision','configurationSha256','binarySha256'].every(k => previous.observation.source[k] === page.observation.source[k]), 'The CAT-20 source or checkpoint changed. Restart this read.');
  const items = [...(previous?.items || []), ...page.items];
  requireFractal(new Set(items.map(key)).size === items.length && items.every((row,index) => index === 0 || key(items[index-1]) < key(row)) && items.length <= page.total
    && (page.nextCursor === null ? items.length === page.total : page.items.length > 0 && items.length < page.total)
    && (!previous || page.nextCursor === null || page.nextCursor !== previous.nextCursor), 'The CAT-20 page made no consistent progress. Retry or restart this read.');
  return {...page, items};
}
export function correlateCatHolders(token: Cat20TokenDetail, page: Cat20Page<unknown>): void {
  requireFractal(page.total === token.holderCount && page.checkpoint.height === token.checkpoint.height && page.checkpoint.hash === token.checkpoint.hash
    && page.trackerSourceRevision === token.trackerSourceRevision
    && ['network','release','sourceRevision','configurationSha256','binarySha256'].every(k => page.observation.source[k] === token.observation.source[k]),
  'The holder projection differs from the observed token source or checkpoint. Restart this read.');
}
export const fractalFailure = (error: unknown): string => (error as any)?.error?.error || (error as Error)?.message || 'The configured Fractal source is unavailable.';
