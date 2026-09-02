import { describe, expect, it } from 'vitest';
import {
  bytes,
  chainHealth,
  duration,
  firstArgumentProblem,
  groupByCategory,
  isReady,
  mempoolFullness,
  peerBalance,
  percent,
  policyLines,
  round,
  searchMethods,
  sectionsAnswered,
} from './node-view';
import {
  ChainSection,
  MempoolSection,
  NodeOverview,
  PeersSection,
  RpcMethod,
  RpcParam,
  Section,
} from './node-console.types';

function ready<T>(data: T): Section<T> {
  return { state: 'ready', data, reason: null };
}

function down<T>(reason = 'Could not connect'): Section<T> {
  return { state: 'unavailable', data: null, reason };
}

function chain(options: Partial<ChainSection> = {}): Section<ChainSection> {
  return ready({
    chain: 'main',
    blocks: 900_000,
    headers: 900_000,
    initialBlockDownload: false,
    verificationProgress: 1,
    pruned: false,
    sizeOnDiskBytes: 700_000_000_000,
    difficulty: 1e14,
    blocksBehindHeaders: 0,
    ...options,
  });
}

function policy(options: Partial<MempoolSection> = {}): Section<MempoolSection> {
  return ready({
    transactionCount: 12_000,
    virtualSize: 8_000_000,
    usageBytes: 40_000_000,
    maxMempoolBytes: 300_000_000,
    minRelayFeeSatPerVb: 1,
    incrementalRelayFeeSatPerVb: 1,
    mempoolMinFeeSatPerVb: 1,
    fullReplacementEnabled: true,
    fullReplacementReported: true,
    ...options,
  });
}

function peers(options: Partial<PeersSection> = {}): Section<PeersSection> {
  return ready({
    total: 10,
    byNetwork: [{ network: 'ipv4', inbound: 3, outbound: 7, relaying: 9 }],
    versions: [{ subversion: '/Satoshi:28.0.0/', count: 10 }],
    oldestConnectionSeconds: 90_000,
    ...options,
  });
}

describe('isReady', () => {
  it('is true only for a section that answered with data', () => {
    expect(isReady(ready({ a: 1 }))).toBe(true);
    expect(isReady(down())).toBe(false);
    expect(isReady(null)).toBe(false);
    expect(isReady(undefined)).toBe(false);
  });

  it('is false for a section that claims ready with no data', () => {
    expect(isReady({ state: 'ready', data: null, reason: null })).toBe(false);
  });
});

describe('chainHealth', () => {
  it('says a node at the tip is ready', () => {
    const line = chainHealth(chain());
    expect(line.health).toBe('ready');
    expect(line.text).toContain('900000');
  });

  it('puts catching up ahead of everything else', () => {
    // A node still catching up answers every question, and some of them
    // wrongly, so nothing else about it matters yet.
    const line = chainHealth(chain({
      initialBlockDownload: true,
      blocks: 800_000,
      headers: 900_000,
      verificationProgress: 0.88,
    }));
    expect(line.health).toBe('catching-up');
    expect(line.text).toContain('800000');
    expect(line.text).toContain('900000');
  });

  it('reports a node behind its own headers', () => {
    const line = chainHealth(chain({ blocks: 899_990, blocksBehindHeaders: 10 }));
    expect(line.health).toBe('catching-up');
    expect(line.text).toContain('10 behind');
  });

  it('does not call an unverified node ready', () => {
    const line = chainHealth(chain({ verificationProgress: 0.9997 }));
    expect(line.health).toBe('degraded');
    expect(line.text).toContain('99.97%');
  });

  it('carries the node own words when it said nothing', () => {
    const line = chainHealth(down('Could not connect to the server'));
    expect(line.health).toBe('unavailable');
    expect(line.text).toContain('Could not connect to the server');
  });

  it('still answers when a silent section gave no reason', () => {
    const line = chainHealth({ state: 'unavailable', data: null, reason: null });
    expect(line.health).toBe('unavailable');
    expect(line.text.length).toBeGreaterThan(10);
  });
});

describe('percent', () => {
  it('truncates rather than rounding up', () => {
    // 99.996 shown as 100 would say a node had finished when it had not,
    // which is the one thing this figure is read for.
    expect(percent(0.99996)).toBe('99.99%');
    expect(percent(1)).toBe('100.00%');
    expect(percent(0.5)).toBe('50.00%');
  });

  it('says unknown rather than showing a number for one', () => {
    expect(percent(Number.NaN)).toBe('unknown');
  });
});

describe('bytes', () => {
  it('scales to the largest readable unit', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 KiB');
    expect(bytes(700_000_000_000)).toBe('651.9 GiB');
  });

  it('says unknown for an absent size rather than zero', () => {
    expect(bytes(null)).toBe('unknown');
  });

  it('handles zero, which is a size and not an absence', () => {
    expect(bytes(0)).toBe('0 B');
  });
});

describe('duration', () => {
  it('picks the largest unit that stays readable', () => {
    expect(duration(45)).toBe('45s');
    expect(duration(600)).toBe('10m');
    expect(duration(7200)).toBe('2h');
    expect(duration(90_000)).toBe('1d');
  });

  it('says unknown for an absent or impossible duration', () => {
    expect(duration(null)).toBe('unknown');
    expect(duration(-5)).toBe('unknown');
  });
});

describe('policyLines', () => {
  it('states the relay floor', () => {
    expect(policyLines(policy())[0]).toContain('1.00 sat/vB');
  });

  it('says when the floor has risen because the mempool is full', () => {
    // The configured minimum and the current minimum are different things
    // and a reader will conflate them unless both are named.
    const lines = policyLines(policy({ minRelayFeeSatPerVb: 1, mempoolMinFeeSatPerVb: 4.2 }));
    expect(lines.some((line) => line.includes('risen to 4.20'))).toBe(true);
  });

  it('stays quiet about a floor that has not risen', () => {
    expect(policyLines(policy()).some((line) => line.includes('risen'))).toBe(false);
  });

  it('states the replacement setting when the node reports it', () => {
    expect(policyLines(policy({ fullReplacementEnabled: true })).some(
      (line) => line.includes('whether or not'))).toBe(true);
    expect(policyLines(policy({ fullReplacementEnabled: false })).some(
      (line) => line.includes('only a transaction that signalled'))).toBe(true);
  });

  it('says the setting is not known on a release that does not report it', () => {
    // Not the same as reporting it off, and saying so would be wrong.
    const lines = policyLines(policy({ fullReplacementReported: false, fullReplacementEnabled: false }));
    expect(lines.some((line) => line.includes('not known here'))).toBe(true);
    expect(lines.some((line) => line.includes('only a transaction that signalled'))).toBe(false);
  });

  it('says nothing at all for a section that did not answer', () => {
    expect(policyLines(down())).toEqual([]);
  });
});

describe('mempoolFullness', () => {
  it('is the fraction of the limit in use', () => {
    expect(mempoolFullness(policy({ usageBytes: 150_000_000, maxMempoolBytes: 300_000_000 })))
      .toBeCloseTo(0.5);
  });

  it('never exceeds one', () => {
    expect(mempoolFullness(policy({ usageBytes: 400_000_000, maxMempoolBytes: 300_000_000 })))
      .toBe(1);
  });

  it('is null rather than zero when the limit is not known', () => {
    // A mempool of unknown capacity is not an empty one.
    expect(mempoolFullness(policy({ maxMempoolBytes: 0 }))).toBeNull();
    expect(mempoolFullness(down())).toBeNull();
  });
});

describe('peerBalance', () => {
  it('separates inbound from outbound', () => {
    const balance = peerBalance(peers());
    expect(balance?.inbound).toBe(3);
    expect(balance?.outbound).toBe(7);
  });

  it('flags a node with no outbound connections', () => {
    // Such a node is isolated from the network it thinks it is on, whatever
    // its inbound count says.
    const balance = peerBalance(peers({
      byNetwork: [{ network: 'ipv4', inbound: 8, outbound: 0, relaying: 8 }],
    }));
    expect(balance?.noOutbound).toBe(true);
  });

  it('says whether the node is reachable from outside', () => {
    expect(peerBalance(peers())?.acceptsInbound).toBe(true);
    expect(peerBalance(peers({
      byNetwork: [{ network: 'ipv4', inbound: 0, outbound: 8, relaying: 8 }],
    }))?.acceptsInbound).toBe(false);
  });

  it('sums across networks', () => {
    const balance = peerBalance(peers({
      byNetwork: [
        { network: 'ipv4', inbound: 3, outbound: 5, relaying: 8 },
        { network: 'onion', inbound: 1, outbound: 2, relaying: 3 },
      ],
    }));
    expect(balance?.inbound).toBe(4);
    expect(balance?.outbound).toBe(7);
  });

  it('is null for a section that did not answer', () => {
    expect(peerBalance(down())).toBeNull();
  });
});

describe('sectionsAnswered', () => {
  function overview(overrides: Partial<NodeOverview> = {}): NodeOverview {
    return {
      observedAt: '2026-09-02T00:00:00.000Z',
      chain: chain(),
      indexes: ready([]),
      mempool: policy(),
      network: ready({
        version: 280000, subversion: '/Satoshi:28.0.0/', protocolVersion: 70016,
        connections: 10, connectionsIn: 3, connectionsOut: 7,
        reachable: ['ipv4'], relayFeeSatPerVb: 1,
      }),
      peers: peers(),
      ...overrides,
    };
  }

  it('counts the sections that answered', () => {
    expect(sectionsAnswered(overview())).toEqual({ ready: 5, total: 5 });
  });

  it('counts a silent section as not answered but still as a section', () => {
    expect(sectionsAnswered(overview({ peers: down() }))).toEqual({ ready: 4, total: 5 });
  });

  it('is zero of zero before anything has loaded', () => {
    expect(sectionsAnswered(null)).toEqual({ ready: 0, total: 0 });
  });
});

function method(options: Partial<RpcMethod> = {}): RpcMethod {
  return {
    name: 'getblockcount',
    category: 'chain',
    summary: 'The height of the tip.',
    params: [],
    immutable: false,
    redacted: false,
    redactionNote: null,
    ...options,
  };
}

describe('groupByCategory', () => {
  it('groups in a fixed order rather than the order they arrived', () => {
    const groups = groupByCategory([
      method({ name: 'decodescript', category: 'decode' }),
      method({ name: 'getpeerinfo', category: 'network' }),
      method({ name: 'getblockcount', category: 'chain' }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(['chain', 'network', 'decode']);
  });

  it('leaves out a category with nothing in it', () => {
    const groups = groupByCategory([method({ category: 'chain' })]);
    expect(groups).toHaveLength(1);
  });

  it('keeps the catalog order inside a group', () => {
    const groups = groupByCategory([
      method({ name: 'b', category: 'chain' }),
      method({ name: 'a', category: 'chain' }),
    ]);
    expect(groups[0].methods.map((m) => m.name)).toEqual(['b', 'a']);
  });
});

describe('searchMethods', () => {
  const catalog = [
    method({ name: 'getblockcount', summary: 'The height of the tip.' }),
    method({ name: 'getpeerinfo', summary: 'Every connection and what it relays.' }),
  ];

  it('matches on the name', () => {
    expect(searchMethods(catalog, 'peer').map((m) => m.name)).toEqual(['getpeerinfo']);
  });

  it('matches on the summary, so a reader can search by what they want', () => {
    expect(searchMethods(catalog, 'height').map((m) => m.name)).toEqual(['getblockcount']);
  });

  it('ignores case and surrounding space', () => {
    expect(searchMethods(catalog, '  PEER ')).toHaveLength(1);
  });

  it('returns everything for an empty query', () => {
    expect(searchMethods(catalog, '')).toHaveLength(2);
    expect(searchMethods(catalog, '   ')).toHaveLength(2);
  });

  it('returns nothing when nothing matches, rather than everything', () => {
    expect(searchMethods(catalog, 'wallet')).toEqual([]);
  });
});

describe('firstArgumentProblem', () => {
  const txid: RpcParam = { name: 'txid', type: 'txid', required: true, description: '' };
  const height: RpcParam = { name: 'height', type: 'height', required: true, description: '' };
  const verbose: RpcParam = { name: 'verbose', type: 'bool', required: false, description: '' };
  const target: RpcParam = { name: 'conf_target', type: 'count', required: true, description: '', max: 1008 };

  it('is null when everything is fine', () => {
    expect(firstArgumentProblem([height], ['800000'])).toBeNull();
    expect(firstArgumentProblem([], [])).toBeNull();
  });

  it('names the position of the field at fault', () => {
    const problem = firstArgumentProblem([height, verbose], ['800000', 'maybe']);
    expect(problem?.index).toBe(1);
    expect(problem?.message).toContain('true or false');
  });

  it('reports a missing required argument', () => {
    expect(firstArgumentProblem([txid], [''])?.message).toContain('needed');
    expect(firstArgumentProblem([txid], [])?.index).toBe(0);
  });

  it('stops at a blank optional argument rather than checking past it', () => {
    // Anything after a blank optional is not sent either, so there is
    // nothing further to check and no problem to report.
    expect(firstArgumentProblem([height, verbose], ['800000', ''])).toBeNull();
  });

  it('checks a transaction id for exactly 64 hexadecimal characters', () => {
    expect(firstArgumentProblem([txid], ['a'.repeat(64)])).toBeNull();
    expect(firstArgumentProblem([txid], ['a'.repeat(63)])?.message).toContain('64');
    expect(firstArgumentProblem([txid], ['z'.repeat(64)])?.message).toContain('64');
  });

  it('checks hexadecimal for an even length', () => {
    const hex: RpcParam = { name: 'hexstring', type: 'hex', required: true, description: '' };
    expect(firstArgumentProblem([hex], ['deadbeef'])).toBeNull();
    expect(firstArgumentProblem([hex], ['abc'])?.message).toContain('odd');
    expect(firstArgumentProblem([hex], ['nothex'])?.message).toContain('hexadecimal');
  });

  it('checks a count against its own maximum', () => {
    expect(firstArgumentProblem([target], ['6'])).toBeNull();
    expect(firstArgumentProblem([target], ['1008'])).toBeNull();
    expect(firstArgumentProblem([target], ['1009'])?.message).toContain('1008');
    expect(firstArgumentProblem([target], ['0'])?.message).toContain('1 to 1008');
  });

  it('trims before checking, so a pasted value with spaces works', () => {
    expect(firstArgumentProblem([height], ['  800000  '])).toBeNull();
  });

  it('accepts a type it does not know rather than blocking on it', () => {
    // The server rechecks everything, so an unknown type here must not stop
    // a call the server would have accepted.
    const odd: RpcParam = { name: 'thing', type: 'something-new', required: true, description: '' };
    expect(firstArgumentProblem([odd], ['whatever'])).toBeNull();
  });
});

describe('round', () => {
  it('shows two decimals', () => {
    expect(round(1)).toBe('1.00');
    expect(round(4.205)).toBe('4.21');
  });

  it('says unknown rather than showing a number for one', () => {
    expect(round(Number.NaN)).toBe('unknown');
  });
});
