import { describe, expect, it } from 'vitest';
import {
  describeChainReason,
  describeChainReasons,
} from '@app/universe/multichain-explorer/chain-reasons';

describe('describeChainReason', () => {
  it('reads a fault as a sentence rather than a code', () => {
    const reading = describeChainReason('base-chain-authority-unavailable');
    expect(reading.kind).toBe('fault');
    expect(reading.text).toContain('did not answer');
    expect(reading.text).not.toContain('-');
  });

  it('separates a working authority stating its edges from one that is broken', () => {
    // tap_doge publishes both of these while ready and complete. Read as
    // faults they describe an outage that is not happening.
    expect(describeChainReason('pending-protocol-coverage-unavailable').kind).toBe('limit');
    expect(describeChainReason('reorg-evidence-tail-only').kind).toBe('limit');
    expect(describeChainReason('protocol-authority-unavailable').kind).toBe('fault');
  });

  it('keeps an unrecognised code, and does not claim to know what it means', () => {
    const reading = describeChainReason('some-future-authority-problem');
    expect(reading.kind).toBe('unstated');
    expect(reading.text).toBe('Some future authority problem');
    expect(reading.code).toBe('some-future-authority-problem');
  });

  it('says the index cannot serve a protocol at all, not that it is merely behind', () => {
    // The flag is fixed when the index is created, so this is not something
    // that heals by waiting, and the wording has to say so.
    expect(describeChainReason('authority-capability-disabled').text).toContain('rebuilt');
    expect(describeChainReason('protocol-authority-stale').text).toContain('behind the chain tip');
  });

  it('reads a list in the order it was given', () => {
    expect(
      describeChainReasons(['protocol-history-unavailable', 'reorg-evidence-tail-only']).map((r) => r.kind)
    ).toEqual(['fault', 'limit']);
  });
});
