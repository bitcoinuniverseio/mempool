import { describe, expect, it } from 'vitest';
import { parseUniverseLiveEnvelope } from '@app/universe/universe-websocket.service';

const envelope = {
  schemaVersion: 'universe-websocket-v1',
  chain: 'dogecoin',
  network: 'mainnet',
  channel: 'mempool-snapshot',
  snapshotId: 'snapshot-1',
  sequenceAtomic: '9',
  observedAt: '2026-08-29T00:00:00.000Z',
  completeness: 'complete',
  data: { countAtomic: '1' },
};

describe('parseUniverseLiveEnvelope', () => {
  it('accepts an exact envelope for the requested chain', () => {
    expect(parseUniverseLiveEnvelope(envelope, 'dogecoin')).toEqual(envelope);
  });

  it('rejects cross-chain, unsafe sequence, and unknown-channel messages', () => {
    expect(parseUniverseLiveEnvelope(envelope, 'zcash')).toBeNull();
    expect(
      parseUniverseLiveEnvelope(
        { ...envelope, sequenceAtomic: '1e9' },
        'dogecoin'
      )
    ).toBeNull();
    expect(
      parseUniverseLiveEnvelope({ ...envelope, channel: 'admin' }, 'dogecoin')
    ).toBeNull();
  });
});
