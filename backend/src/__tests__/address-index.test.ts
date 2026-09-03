import { addressIndexState, type AddressIndexFacts } from '../api/bitcoin/address-index';

/**
 * The one rule that decides whether this deployment can serve address lookups.
 *
 * It is tested on its own, without a network or a config file, because it is
 * the thing four separate places agree to obey: the capability document the
 * frontend reads, the release preflight, the cutover verification, and the
 * production synthetic check. If any of them formed its own opinion instead,
 * the four would drift, and the drift would only be visible once an address
 * page was already showing somebody the wrong number.
 */

const current: AddressIndexFacts = {
  backendKind: 'esplora',
  configured: true,
  reachable: true,
  indexedTip: 964_769,
  chainTip: 964_769,
  summaryAnswered: true,
  utxoAnswered: true,
  maxBehindTip: 2,
};

describe('address index readiness', () => {
  it('is ready when the index is current and both real queries answered', () => {
    const verdict = addressIndexState(current);
    expect(verdict.state).toBe('ready');
    expect(verdict.lagBlocks).toBe(0);
    expect(verdict.degradedReason).toBeNull();
  });

  it('is disabled when this deployment reads Bitcoin Core alone', () => {
    // This is the configuration that shipped. It is a deliberate state rather
    // than a failure, and the page it backs has to say so in those terms.
    const verdict = addressIndexState({ ...current, backendKind: 'none' });
    expect(verdict.state).toBe('disabled');
  });

  it('is unavailable when a backend is selected with nothing configured for it', () => {
    expect(addressIndexState({ ...current, configured: false }).state).toBe('unavailable');
  });

  it('is unavailable when the index does not answer', () => {
    expect(addressIndexState({ ...current, reachable: false }).state).toBe('unavailable');
  });

  it('is syncing while the index is still building', () => {
    const verdict = addressIndexState({ ...current, indexedTip: 700_000 });
    expect(verdict.state).toBe('syncing');
    expect(verdict.lagBlocks).toBe(264_769);
    expect(verdict.degradedReason).toContain('700000');
    expect(verdict.degradedReason).toContain('964769');
  });

  it('tolerates exactly the configured lag and refuses one block more', () => {
    expect(addressIndexState({ ...current, indexedTip: 964_767 }).state).toBe('ready');
    expect(addressIndexState({ ...current, indexedTip: 964_766 }).state).toBe('syncing');
  });

  /**
   * A listening port is not readiness, and neither is a height. The index can
   * be exactly at the tip and still be unable to answer the question the page
   * is about, which is what happens while it is compacting or when its history
   * column family is damaged. Reporting ready in that state is how a capability
   * document ends up lying about a route that fails.
   */
  it('is degraded when it is current but an address summary did not answer', () => {
    const verdict = addressIndexState({ ...current, summaryAnswered: false });
    expect(verdict.state).toBe('degraded');
    expect(verdict.degradedReason).toContain('address summary');
  });

  it('is degraded when it is current but a UTXO query did not answer', () => {
    const verdict = addressIndexState({ ...current, utxoAnswered: false });
    expect(verdict.state).toBe('degraded');
    expect(verdict.degradedReason).toContain('UTXO');
  });

  it('is degraded rather than ready when the index will not say how far it has got', () => {
    expect(addressIndexState({ ...current, indexedTip: null }).state).toBe('degraded');
  });

  it('is degraded rather than ready when Core will not say how far the chain has got', () => {
    // Without a chain height there is nothing to hold the index to, and an
    // unchecked index must never be published as current.
    expect(addressIndexState({ ...current, chainTip: null }).state).toBe('degraded');
  });

  it('never reports a negative lag when the index is ahead of a stale Core reading', () => {
    const verdict = addressIndexState({ ...current, indexedTip: 964_770, chainTip: 964_769 });
    expect(verdict.lagBlocks).toBe(0);
    expect(verdict.state).toBe('ready');
  });

  it('never calls an Electrum deployment ready without an indexed height', () => {
    const verdict = addressIndexState({ ...current, backendKind: 'electrum', indexedTip: null });
    expect(verdict.state).not.toBe('ready');
  });
});
