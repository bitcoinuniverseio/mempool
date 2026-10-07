import type { Bolt12Offer, Bolt12OfferPage } from '../universe.types';

export class OfferCatalogChangedError extends Error {}
const fail = (): never => { throw new OfferCatalogChangedError('Offer catalog evidence changed or is incomplete. Restart the offer list.'); };
const hash = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const u64 = (value: unknown): boolean => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
const height = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const genesis: Record<string, string> = {
  mainnet:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  testnet:'000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4:'00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  signet:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  regtest:'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};
const sourceKey = (source: Bolt12OfferPage['source']): string => JSON.stringify([
  source.implementation, source.version, source.nodeId, source.network, source.genesisHash,
  source.signetChallenge, source.publicationSha256, source.catalogAnchor.height, source.catalogAnchor.hash,
]);

/** Validates the owned node's bounded observation, never invoice or payment availability. */
export function checkedOfferPage(raw: unknown, network: string, limit: number, prior?: Bolt12OfferPage): Bolt12OfferPage {
  if (!raw || typeof raw !== 'object' || JSON.stringify(raw).length > 1024 * 1024) return fail();
  const page = raw as Bolt12OfferPage, source = page.source;
  if (!Array.isArray(page.offers) || page.offers.length > limit || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 128
    || !(page.nextCursor === null || typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 2048)
    || !source || source.implementation !== 'CoreLightning' || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(source.version)
    || !/^(02|03)[a-f0-9]{64}$/.test(source.nodeId) || source.network !== network || !genesis[network] || source.genesisHash !== genesis[network]
    || !hash(source.publicationSha256) || typeof source.observedAt !== 'string' || !Number.isFinite(Date.parse(source.observedAt))
    || typeof source.scope !== 'string' || !source.scope.length || source.scope.length > 2048
    || !source.checkpoint || !height(source.checkpoint.height) || !hash(source.checkpoint.hash)
    || !source.catalogAnchor || !height(source.catalogAnchor.height) || !hash(source.catalogAnchor.hash)
    || source.checkpoint.height < source.catalogAnchor.height
    || source.checkpoint.height === source.catalogAnchor.height && source.checkpoint.hash !== source.catalogAnchor.hash
    || (network === 'signet' ? typeof source.signetChallenge !== 'string' || !/^(?:[a-f0-9]{2}){1,10000}$/.test(source.signetChallenge) : source.signetChallenge !== undefined)) return fail();
  const rows = prior?.offers ?? [];
  if (page.offers.length !== Math.min(limit, page.total - rows.length)) return fail();
  let lastId = rows.length ? rows[rows.length - 1].offerId : '';
  const observedSeconds = BigInt(Math.floor(Date.parse(source.observedAt) / 1000));
  for (const offer of page.offers) {
    if (!offer || !hash(offer.offerId) || !hash(offer.decoderOfferId) || offer.offerId <= lastId
      || typeof offer.offerString !== 'string' || !/^lno1/i.test(offer.offerString) || new TextEncoder().encode(offer.offerString).length > 16384
      || typeof offer.description !== 'string' || offer.description.length > 16384
      || offer.issuer !== undefined && (typeof offer.issuer !== 'string' || offer.issuer.length > 16384)
      || !Number.isSafeInteger(offer.blindRoutesCount) || offer.blindRoutesCount < 0
      || ![offer.valid, offer.sourceActive, offer.sourceUsed, offer.singleUse, offer.networkCompatible, offer.unknownRequiredFeatures].every(value => typeof value === 'boolean')
      || offer.syntaxValid !== true || offer.invoiceAvailability !== 'unverified' || offer.paymentVerified !== false
      || !(offer.expiryAtomic === null || u64(offer.expiryAtomic))
      || offer.amountMsat !== undefined && !u64(offer.amountMsat)
      || (offer.currency === undefined ? offer.currencyAmountAtomic !== undefined : !/^[A-Z]{3}$/.test(offer.currency) || !u64(offer.currencyAmountAtomic) || offer.amountMsat !== undefined)) return fail();
    const validity = !offer.sourceActive ? 'source-disabled' : offer.singleUse && offer.sourceUsed ? 'already-used'
      : offer.expiryAtomic !== null && observedSeconds > BigInt(offer.expiryAtomic) ? 'expired'
      : !offer.networkCompatible ? 'wrong-chain' : offer.unknownRequiredFeatures ? 'unsupported-required-features' : 'usable-unverified';
    if (offer.validity !== validity || offer.valid !== (validity === 'usable-unverified')) return fail();
    lastId = offer.offerId;
  }
  if (prior && (page.total !== prior.total || sourceKey(source) !== sourceKey(prior.source)
    || source.checkpoint.height < prior.source.checkpoint.height
    || source.checkpoint.height === prior.source.checkpoint.height && source.checkpoint.hash !== prior.source.checkpoint.hash
    || Date.parse(source.observedAt) < Date.parse(prior.source.observedAt)
    || page.nextCursor !== null && page.nextCursor === prior.nextCursor)) return fail();
  const loaded = rows.length + page.offers.length;
  if (loaded > page.total || (page.nextCursor === null ? loaded !== page.total : loaded >= page.total || !page.offers.length)
    || prior && !page.offers.length) return fail();
  return {...page, offers: [...rows, ...page.offers]};
}

export function listedOfferAmount(offer: Bolt12Offer): string {
  return offer.currency !== undefined ? `${offer.currencyAmountAtomic} ${offer.currency} minor units`
    : offer.amountMsat !== undefined ? `${offer.amountMsat} msat` : 'Not specified';
}
