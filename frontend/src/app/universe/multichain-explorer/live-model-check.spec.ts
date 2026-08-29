// Drives the chain presentation model with payloads captured from the live
// public origin rather than written by hand.
//
// The hand-written fixtures encode what the API was expected to send. These
// encode what it actually sent, and the difference between the two is where
// three real design faults were hiding. Every assertion here is about an
// invariant the model must hold for whatever the chain returns, never about a
// value the chain will move: a lag of one block becomes two while you read it.
import { describe, expect, it } from 'vitest';
import { LIVE_PAYLOADS } from '@app/universe/multichain-explorer/live-payloads';
import {
  chainProfile,
  classifyPayload,
  readCollection,
  readProtocolCoverage,
  readRecordFacts,
  readStatusRail,
  readTransaction,
  readTransactionList,
} from '@app/universe/multichain-explorer/multichain-view';

const PAYLOADS: Record<string, unknown> = {
  dogecoin_status: LIVE_PAYLOADS.dogecoinStatus,
  zcash_status: LIVE_PAYLOADS.zcashStatus,
  dogecoin_mempool: LIVE_PAYLOADS.dogecoinMempool,
  zcash_mempool: LIVE_PAYLOADS.zcashMempool,
  dogecoin_protocols: LIVE_PAYLOADS.dogecoinProtocols,
  zcash_protocols: LIVE_PAYLOADS.zcashProtocols,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- captured payloads are read as the API sends them
const load = (name: string): any => structuredClone(PAYLOADS[name]);

const DOGE = chainProfile('dogecoin');
const ZEC = chainProfile('zcash');
const NOW = Date.parse('2026-08-29T08:30:00.000Z');

describe('live dogecoin status', () => {
  const status = load('dogecoin_status');

  it('fills all five rail readings from the real envelope', () => {
    const rail = readStatusRail(status, DOGE, NOW);
    expect(rail.map((r) => r.id)).toEqual(['state', 'tip', 'lag', 'freshness', 'mempool']);
    expect(rail.every((r) => r.value && r.value.length > 0)).toBe(true);
  });

  it('reports a null lag as not stated rather than as zero', () => {
    // Production sends lagBlocksAtomic: null on this chain right now. Reading
    // that as zero would claim the page is describing the tip.
    expect(status.lagBlocksAtomic).toBeNull();
    const lag = readStatusRail(status, DOGE, NOW).find((r) => r.id === 'lag');
    expect(lag?.tone).toBe('neutral');
    expect(lag?.exact).toBeNull();
  });

  it('lists each protocol once, and offers no route to one it cannot open', () => {
    const readings = readProtocolCoverage(status, DOGE);
    const labels = readings.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);

    // tap_doge in the envelope, doge-tap on the route.
    const tap = readings.filter((r) => r.label === 'TAP on Doge');
    expect(tap).toHaveLength(1);
    expect(tap[0].routeId).toBe('doge-tap');

    // dunes is reported by the chain and has no page here.
    const dunes = readings.find((r) => r.protocolId === 'dunes');
    expect(dunes).toBeDefined();
    expect(dunes?.routeId).toBeNull();
  });
});

describe('live zcash status', () => {
  it('reads any non-zero lag as partly proven, not as proven', () => {
    const status = load('zcash_status');
    const lag = readStatusRail(status, ZEC, NOW).find((r) => r.id === 'lag');
    expect(lag?.exact).toBe(status.lagBlocksAtomic);
    expect(lag?.tone).toBe(status.lagBlocksAtomic === '0' ? 'proven' : 'partial');
  });
});

describe('live mempool payloads', () => {
  for (const [name, profile] of [
    ['dogecoin_mempool', DOGE],
    ['zcash_mempool', ZEC],
  ] as const) {
    it(`${name} reads as transactions, not as a table of field names`, () => {
      const payload = load(name);
      const list = readTransactionList(payload, profile);
      expect(list).not.toBeNull();
      expect(list!.rows.length).toBeGreaterThan(0);

      for (const row of list!.rows) {
        expect(row.txid).toMatch(/^[0-9a-f]{64}$/);
        expect(row.statusLabel.length).toBeGreaterThan(0);
        expect(['proven', 'partial', 'pending', 'unavailable', 'neutral']).toContain(row.statusTone);
      }
    });

    it(`${name} keeps every reported cost exact`, () => {
      const payload = load(name);
      const list = readTransactionList(payload, profile)!;
      for (const row of list.rows) {
        if (row.fee) {
          expect(row.fee.exact).toMatch(/^-?(0|[1-9][0-9]*)$/);
        }
        if (row.logicalActions) {
          expect(row.logicalActions.exact).toMatch(/^(0|[1-9][0-9]*)$/);
        }
      }
    });

    it(`${name} picks a cost column its rows can actually fill`, () => {
      const payload = load(name);
      const list = readTransactionList(payload, profile)!;
      if (list.costColumn === 'amount') {
        expect(list.rows.some((row) => row.fee)).toBe(true);
      } else if (list.costColumn === 'logical-actions') {
        // No row reports an amount, so an amount column would have been empty.
        expect(list.rows.every((row) => !row.fee)).toBe(true);
        expect(list.rows.some((row) => row.logicalActions)).toBe(true);
      }
    });
  }

  it('does not fall through to the generic table for a transaction list', () => {
    const payload = load('dogecoin_mempool');
    expect(classifyPayload(payload)).toBe('collection');
    expect(readTransactionList(payload, DOGE)).not.toBeNull();
  });
});

describe('live transaction envelopes', () => {
  it('every pending dogecoin transaction reads without loss', () => {
    const payload = load('dogecoin_mempool');
    for (const raw of payload.transactions) {
      const tx = readTransaction(raw, DOGE);
      expect(tx).not.toBeNull();
      expect(tx!.txid).toBe(raw.txid);
      // A total is only shown when every side carried an amount.
      if (tx!.inputTotal) {
        expect(tx!.inputs.every((input) => input.amount)).toBe(true);
      }
    }
  });

  it('a real zcash transaction reports shielded structure without participants', () => {
    const payload = load('zcash_mempool');
    const shielded = payload.transactions.find(
      (t: { shielded?: unknown }) => t.shielded
    );
    if (!shielded) {
      return; // none pending in this capture, which is itself a valid state
    }
    const tx = readTransaction(shielded, ZEC);
    expect(tx!.shielded).not.toBeNull();
    expect(tx!.shielded!.notice.length).toBeGreaterThan(0);
    expect(tx!.shielded!.components).toHaveLength(5);
  });
});

describe('live protocol manifests', () => {
  for (const [name, profile] of [
    ['dogecoin_protocols', DOGE],
    ['zcash_protocols', ZEC],
  ] as const) {
    it(`${name} renders as a table with no constant column wasting a slot`, () => {
      const payload = load(name);
      const collection = readCollection(payload, profile);
      expect(collection).not.toBeNull();
      const keys = collection!.columns.map((c) => c.key);
      // chain and schemaVersion are identical on every registry row.
      expect(keys).not.toContain('schemaVersion');
      expect(keys).not.toContain('chain');
    });

    it(`${name} leaves no scalar unreported`, () => {
      const payload = load(name);
      const collection = readCollection(payload, profile);
      const facts = readRecordFacts(payload, profile, [
        'chain',
        'network',
        collection!.sourceKey,
      ]);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts.every((f) => f.label.length > 0)).toBe(true);
    });
  }
});
