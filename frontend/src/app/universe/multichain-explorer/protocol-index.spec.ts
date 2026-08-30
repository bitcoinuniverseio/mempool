import { describe, expect, it } from 'vitest';
import { LIVE_PAYLOADS } from '@app/universe/multichain-explorer/live-payloads';
import { chainProfile } from '@app/universe/multichain-explorer/multichain-view';
import { readProtocolIndex } from '@app/universe/multichain-explorer/protocol-index';

const DOGE = chainProfile('dogecoin');
const ZEC = chainProfile('zcash');
const NOW = Date.parse('2026-08-29T08:30:00.000Z');

describe('the chain protocols index, read as a designed page', () => {
  it('lists every registry entry with its release verdict and a route', () => {
    const reading = readProtocolIndex(
      structuredClone(LIVE_PAYLOADS.dogecoinProtocols),
      DOGE,
      NOW
    );
    expect(reading).not.toBeNull();
    expect(reading!.rows.map((row) => row.id)).toEqual([
      'doginals', 'drc20', 'tap_doge', 'dunes',
    ]);
    // tap_doge routes through its alias; every entry has a page now.
    expect(reading!.rows.map((row) => row.routeId)).toEqual([
      'doginals', 'drc20', 'doge-tap', 'dunes',
    ]);
    const blocked = reading!.rows[0];
    expect(blocked.releaseLabel).toBe('Not yet verified');
    expect(blocked.releaseTone).toBe('unavailable');
    expect(blocked.authorityId).toBe('ord-dogecoin');
    expect(blocked.coverageLabel).toBe('Coverage not established');
  });

  it('turns each authority record into a verdict with its evidence beside it', () => {
    const reading = readProtocolIndex(
      structuredClone(LIVE_PAYLOADS.dogecoinProtocols),
      DOGE,
      NOW
    );
    const byKey = new Map(
      reading!.authorities.map((authority) => [authority.key, authority])
    );
    // The exact dump from the screenshot, now a verdict with the code kept.
    const confirmed = byKey.get('confirmedHistory');
    expect(confirmed?.stateLabel).toBe('Not configured');
    expect(confirmed?.tone).toBe('unavailable');
    expect(confirmed?.failureCode).toBe('blockbook-unconfigured');

    const mempool = byKey.get('mempool');
    expect(mempool?.stateLabel).toBe('Configured, not polling');
    expect(mempool?.checkpointHeight?.exact).toBe('6351906');

    const protocol = byKey.get('protocolAuthority');
    expect(protocol?.stateLabel).toBe('Not answering');
    expect(protocol?.failureCode).toBe('transport');
    expect(protocol?.authorityId).toBe('ord-dogecoin');
  });

  it('reads the zcash manifest, whose status names no failure at all', () => {
    const reading = readProtocolIndex(
      structuredClone(LIVE_PAYLOADS.zcashProtocols),
      ZEC,
      NOW
    );
    expect(reading!.rows.map((row) => row.routeId)).toEqual([
      'zerdinals', 'zrunes', 'zrc20',
    ]);
    const status = reading!.authorities.find((authority) => authority.key === 'status');
    expect(status?.stateLabel).toBe('Answering');
    expect(status?.tone).toBe('proven');
    expect(status?.failureCode).toBeNull();
  });

  it('is not this reading at all for other payloads', () => {
    expect(readProtocolIndex({ items: [{ tick: 'ZERO' }] }, ZEC, NOW)).toBeNull();
    expect(readProtocolIndex({ transactions: [] }, DOGE, NOW)).toBeNull();
    expect(readProtocolIndex(null, DOGE, NOW)).toBeNull();
  });
});
