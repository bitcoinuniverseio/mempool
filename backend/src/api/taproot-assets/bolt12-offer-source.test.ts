import { createHash } from 'crypto';
import { Bolt12OfferSource, OfferPublication } from './bolt12-offer-source';
import { GENESIS } from '../intelligence/utxo/utxo-evidence';
import { Bolt12DecodedOffer, decodeBolt12Offer } from './bolt12-decoder';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const genesis = '01000000' + '00'.repeat(32) + '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' + 'dae5494dffff7f2002000000';
function harness(infoLag = 0) {
  let now = 1800000000000, tip = 10;
  const header = (at: number) => at === 0 ? genesis : Buffer.alloc(80, at).toString('hex');
  const blockHash = (at: number) => createHash('sha256').update(createHash('sha256').update(Buffer.from(header(at), 'hex')).digest()).digest().reverse().toString('hex');
  const rows = ['01', '02', '03', '04'].map((tlv, i) => ({ offer_id: digest(Buffer.from(tlv, 'hex')), bolt12: 'lno1controlled-' + i,
    active: i !== 2, used: false, single_use: false, label: i === 3 ? 'PRIVATE DO NOT PUBLISH' : 'private administrative label' }));
  const publication: OfferPublication = { schema: 'universe-bolt12-publication-v1', revision: 'controlled-test-only', network: 'regtest',
    genesisHash: GENESIS.regtest, nodeId: '02' + '01'.repeat(32), implementationVersion: 'v26.06.8', updatedAt: new Date(now - 1).toISOString(),
    publishedOfferIds: rows.slice(0, 3).map(row => row.offer_id) };
  const core = jest.fn(async (method: string, params: any[]): Promise<any> => method === 'getblockchaininfo' ?
    { chain: 'regtest', initialblockdownload: false, blocks: tip, bestblockhash: blockHash(tip) } : blockHash(params[0]));
  const lightning = jest.fn(async (method: string, params: any): Promise<any> => {
    if (method === 'getinfo') return { network: 'regtest', id: publication.nodeId, version: publication.implementationVersion, blockheight: tip - infoLag };
    if (method === 'getchaininfo') return { chain: 'regtest', blockcount: tip, headercount: tip, ibd: false };
    if (method === 'getrawblockbyheight') return { blockhash: blockHash(params.height), block: header(params.height) + '00' };
    return { offers: rows };
  });
  const decode = jest.fn(async (offer: string): Promise<Bolt12DecodedOffer> => {
    const i = rows.findIndex(row => row.bolt12 === offer);
    return { status: 'decoded', syntax_valid: true, engine: 'lightning-0.2.6', network: 'regtest',
      input_sha256: digest(offer), offer_id: 'ab'.repeat(32), normalized_offer: offer, tlv_hex: ['01', '02', '03', '04'][i],
      description: 'Controlled test ' + i, issuer: null, issuer_signing_pubkey: null,
      amount: { kind: 'bitcoin', amount_msat: '9007199254740993' }, quantity: { kind: 'one' },
      absolute_expiry: i === 1 ? String(Math.floor(now / 1000) - 1) : null, expired: i === 1,
      network_compatible: true, unknown_required_features: false, usable_for_invoice_request: i !== 1,
      chain_hashes_wire_order: [], blinded_path_count: 0, signature_status: 'not-applicable-unsigned-offer', payment_verified: false, scope: 'Controlled reader test' };
  });
  const source = new Bolt12OfferSource('regtest', { publication: async () => Buffer.from(JSON.stringify(publication)), core, lightning, decode, now: () => now });
  return { source, publication, core, lightning, decode, rows, advance: () => { tip++; }, expire: () => { now += 300001; } };
}

describe('bounded owned public offer catalog', () => {
  it('independently verifies the common height when native chain and Lightning observations differ within two blocks', async () => {
    const h = harness(2), page = await h.source.page();
    expect(page.source.checkpoint.height).toBe(8);
    expect(h.core).toHaveBeenCalledWith('getblockhash', [8], expect.anything());
    expect(h.lightning.mock.calls.filter(([method, params]) => method === 'getrawblockbyheight' && params.height === 8)).toHaveLength(2);
    await expect(harness(3).source.page()).rejects.toMatchObject({ status: 503 });
    await expect(harness(-3).source.page()).rejects.toMatchObject({ status: 503 });
  });
  it('projects only published IDs and distinguishes syntax, active, expiry and payment evidence', async () => {
    const h = harness(), page = await h.source.page();
    expect(page.total).toBe(3); expect(page.nextCursor).toBeNull();
    expect(page.offers.map(row => row.validity).sort()).toEqual(['expired', 'source-disabled', 'usable-unverified']);
    expect(page.offers.every(row => row.amountMsat === '9007199254740993' && row.paymentVerified === false && row.invoiceAvailability === 'unverified')).toBe(true);
    expect(JSON.stringify(page)).not.toContain('private');
    expect(page.offers.some(row => row.offerId === h.rows[3].offer_id)).toBe(false);
    expect(page.offers.every(row => row.decoderOfferId !== row.offerId)).toBe(true);
  });
  it('continues a stable catalog across ordinary tip growth without duplicate rows', async () => {
    const h = harness(), first = await h.source.page({ limit: '1' }); h.advance();
    const second = await h.source.page({ limit: '1', cursor: first.nextCursor! });
    const third = await h.source.page({ limit: '1', cursor: second.nextCursor! });
    expect(new Set([...first.offers, ...second.offers, ...third.offers].map(row => row.offerId)).size).toBe(3);
    expect(third.nextCursor).toBeNull(); expect(second.source.catalogAnchor).toEqual(first.source.catalogAnchor);
    expect(second.source.checkpoint.height).toBe(11);
  });
  it('uses only the two independently measured fences for the current anchor, while re-observing an older cursor anchor', async () => {
    const h = harness(), first = await h.source.page({ limit: '1' });
    expect(h.lightning.mock.calls.filter(([method, params]) => method === 'getrawblockbyheight' && params.height === 10)).toHaveLength(2);
    h.advance(); h.lightning.mockClear();
    await h.source.page({ limit: '1', cursor: first.nextCursor! });
    for (const at of [10, 11]) expect(h.lightning.mock.calls.filter(([method, params]) => method === 'getrawblockbyheight' && params.height === at)).toHaveLength(2);
  });
  it.each([{ limit: '0' }, { limit: '51' }, { limit: ['1'] }, { source: '/secret' }, { cursor: ['x'] }])('rejects unsupported query before source I/O: %j', async query => {
    const h = harness(); await expect(h.source.page(query)).rejects.toMatchObject({ status: 400 }); expect(h.core).not.toHaveBeenCalled();
  });
  it('rejects tampered, changed-limit, cross-process and expired cursors before I/O', async () => {
    const h = harness(), first = await h.source.page({ limit: '1' }), cursor = first.nextCursor!;
    h.core.mockClear();
    for (const query of [{ limit: '1', cursor: cursor + 'x' }, { limit: '2', cursor }]) {
      await expect(h.source.page(query)).rejects.toMatchObject({ status: 409 });
    }
    await expect(harness().source.page({ limit: '1', cursor })).rejects.toMatchObject({ status: 409 });
    h.expire(); await expect(h.source.page({ limit: '1', cursor })).rejects.toMatchObject({ status: 409 });
    expect(h.core).not.toHaveBeenCalled();
  });
  it.each(['revocation', 'publication', 'unknown-public-ID'])('does not reuse a cursor after %s', async change => {
    const h = harness(), first = await h.source.page({ limit: '1' });
    if (change === 'revocation') h.rows[0].active = false;
    else if (change === 'publication') h.publication.revision = 'new-intent';
    else h.publication.publishedOfferIds.push('ff'.repeat(32));
    await expect(h.source.page({ limit: '1', cursor: first.nextCursor! })).rejects.toMatchObject({ status: 409 });
  });
  it('rejects a live source whose original catalog block was reorganized', async () => {
    const h = harness(), first = await h.source.page({ limit: '1' });
    h.core.mockImplementation(async () => 'ff'.repeat(32));
    await expect(h.source.page({ limit: '1', cursor: first.nextCursor! })).rejects.toMatchObject({ status: 503 });
  });
  it.each(['ibd', 'wrong-network', 'wrong-node', 'wrong-version', 'header-mismatch', 'duplicate-ID', 'unpublished-missing', 'malformed-offer'])('fails closed on %s', async failure => {
    const h = harness();
    if (failure === 'ibd' || failure === 'wrong-network') h.core.mockImplementation(async () => ({ chain: failure === 'ibd' ? 'regtest' : 'signet', initialblockdownload: true }));
    if (failure === 'wrong-node' || failure === 'wrong-version') h.lightning.mockImplementation(async () => ({ network: 'regtest', id: '03' + 'ff'.repeat(32), version: 'v1.0.0' }));
    if (failure === 'header-mismatch') h.core.mockImplementation(async (method: string) => method === 'getblockhash' ? 'ff'.repeat(32) : ({ chain: 'regtest', initialblockdownload: false, blocks: 10, bestblockhash: 'ff'.repeat(32) }));
    if (failure === 'duplicate-ID') h.rows.push(h.rows[0]);
    if (failure === 'unpublished-missing') h.publication.publishedOfferIds.push('ff'.repeat(32));
    if (failure === 'malformed-offer') h.decode.mockRejectedValue(new Error('private decoder details must not leak'));
    await expect(h.source.page()).rejects.toMatchObject({ status: 503 });
  });
  it('allows a genuinely healthy explicitly empty publication', async () => {
    const h = harness(); h.publication.publishedOfferIds = [];
    await expect(h.source.page()).resolves.toMatchObject({ offers: [], total: 0, nextCursor: null });
    expect(h.lightning).toHaveBeenCalledWith('listoffers', {}, expect.anything());
  });
  it('enforces the fixed deadline, cancellation and capacity while uncooperative I/O remains pending', async () => {
    jest.useFakeTimers();
    let release!: (value: Buffer) => void;
    const held = new Promise<Buffer>(accept => { release = accept; });
    const source = new Bolt12OfferSource('regtest', { publication: () => held, core: jest.fn(), lightning: jest.fn() });
    try {
      const first = source.page().catch(error => error), second = source.page().catch(error => error);
      await expect(source.page()).rejects.toMatchObject({ code: 'offer-source-busy' });
      await jest.advanceTimersByTimeAsync(15000);
      expect(await first).toMatchObject({ status: 503 }); expect(await second).toMatchObject({ status: 503 });
      await expect(source.page()).rejects.toMatchObject({ code: 'offer-source-busy' });
      release(Buffer.from('{}')); await Promise.resolve(); await Promise.resolve();
    } finally { jest.useRealTimers(); }
  });
});

describe('native decoding of intentionally published owned CLN26.06.8 Signet fixtures', () => {
  const fixtures: Array<{ role: string; offerId: string; offerString: string; sourceActive: boolean }> =
    JSON.parse(readFileSync(resolve(__dirname, 'bolt12-owned-public-fixtures.json'), 'utf8'));
  it.each(fixtures)('$role preserves the actual CLN catalog key independently of LDK merkle identity', async fixture => {
    const decoded = await decodeBolt12Offer({ offer: fixture.offerString, network: 'signet' }, 'signet');
    expect(digest(Buffer.from(decoded.tlv_hex, 'hex'))).toBe(fixture.offerId);
    expect(decoded.offer_id).not.toBe(fixture.offerId);
    expect(decoded.network_compatible).toBe(true); expect(decoded.amount).toEqual({ kind: 'bitcoin', amount_msat: '1000' });
    expect(decoded.expired).toBe(fixture.role === 'expiry'); expect(decoded.payment_verified).toBe(false);
  });
});
