import { readActivityRows, activitySummary } from './protocol-activity-view';
import type { ExplorerProtocolActivityPage } from './universe.types';

describe('readActivityRows', () => {
  it('reads the common identity, kind, transaction and height keys', () => {
    const rows = readActivityRows([
      {
        eventId: 'mezcal:0:0:deploy',
        kind: 'deploy',
        txid: 'ab'.repeat(32),
        heightAtomic: '898944',
        amountAtomic: '1000',
      },
    ]);
    expect(rows[0].id).toBe('mezcal:0:0:deploy');
    expect(rows[0].kind).toBe('deploy');
    expect(rows[0].txid).toBe('ab'.repeat(32));
    expect(rows[0].heightAtomic).toBe('898944');
    expect(rows[0].unnamedFields).toBe(1);
  });

  it('falls back through the alias key sets the authorities actually publish', () => {
    const rows = readActivityRows([
      { id: 'asset-1', type: 'mint', anchor_txid: 'cd'.repeat(32), block_height: 898945 },
    ]);
    expect(rows[0].id).toBe('asset-1');
    expect(rows[0].kind).toBe('mint');
    expect(rows[0].txid).toBe('cd'.repeat(32));
    expect(rows[0].heightAtomic).toBe('898945');
  });

  it('keeps a record it cannot name rather than guessing columns', () => {
    const rows = readActivityRows([{ customShape: { nested: true } }]);
    expect(rows[0].id).toBeNull();
    expect(rows[0].kind).toBeNull();
    expect(rows[0].txid).toBeNull();
    expect(rows[0].heightAtomic).toBeNull();
    expect(rows[0].unnamedFields).toBe(1);
    expect(rows[0].record).toEqual({ customShape: { nested: true } });
  });

  it('reads an empty page as empty', () => {
    expect(readActivityRows([])).toEqual([]);
  });
});

function page(overrides: Partial<ExplorerProtocolActivityPage> = {}): ExplorerProtocolActivityPage {
  return {
    schemaVersion: 'universe-protocol-activity-v1',
    protocolId: 'mezcal',
    state: 'served',
    authorityId: 'index-mezcal',
    feedPath: '/token-explorer/mezcal',
    source: null,
    assets: [],
    events: [],
    invalidations: [],
    holderSnapshots: [],
    nextCursor: null,
    hasMore: false,
    checkpoint: null,
    degradedReason: null,
    observedAt: '2026-09-02T12:00:00.000Z',
    ...overrides,
  };
}

describe('activitySummary', () => {
  it('counts what a served page carries without rounding to zero', () => {
    expect(activitySummary(page({ events: [{}], assets: [{}, {}] })))
      .toBe('The authority answered: 1 event, 2 assets in this page of its feed.');
    expect(activitySummary(page({ invalidations: [{}] })))
      .toBe('The authority answered: 1 invalidation in this page of its feed.');
  });

  it('says an empty served page is a real answer', () => {
    expect(activitySummary(page()))
      .toBe('The authority answered: no activity in this page of its feed.');
  });

  it('says what is missing for every unserved state', () => {
    expect(activitySummary(page({ state: 'unconfigured' })))
      .toBe('No authority for this protocol is configured in this deployment, so its activity is not shown.');
    expect(activitySummary(page({ state: 'unavailable', degradedReason: 'The index-mezcal authority did not answer with a usable feed page (transport).' })))
      .toBe('The index-mezcal authority did not answer with a usable feed page (transport).');
    expect(activitySummary(page({ state: 'unsupported' })))
      .toBe('This protocol has no activity feed this explorer reads yet.');
  });
});
