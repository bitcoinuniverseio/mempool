import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checksumCreate } from 'utxo-descriptors';
import type { DiscoveryRequest, DiscoveryResponse } from './discovery.worker';

const key = 'xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A';
const expression = `wpkh(${key}/0/*)`;
const descriptor = expression + '#' + checksumCreate(expression);
let listener: (event: { data: DiscoveryRequest }) => void;
let reply: DiscoveryResponse;
beforeAll(async () => {
  vi.stubGlobal('self', { addEventListener: (_type, callback) => { listener = callback; }, postMessage: response => { reply = response; } });
  await import('./discovery.worker');
});
afterAll(() => vi.unstubAllGlobals());
const dispatch = (request: DiscoveryRequest) => { listener({ data: request }); return reply; };

describe('actual public discovery worker dispatcher', () => {
  it('derives the pinned public SegWit fixture through both worker request forms', () => {
    const a = dispatch({ id: 1, op: 'derive-batch', key, script: 'p2wpkh', testnet: false, branch: 'external', start: 0, count: 2 });
    expect(a.ok).toBe(true);
    expect('addresses' in a && a.addresses[0]).toEqual({ index: 0, address: 'bc1qe0g7q5f92pqjy3jfaana4qyzs5y9d2vrdx64ff' });
    const b = dispatch({ id: 2, op: 'descriptor-batch', descriptor, testnet: false, start: 0, count: 2 });
    expect(b.ok).toBe(true);
    expect('addresses' in b && b.addresses).toEqual('addresses' in a && a.addresses);
    expect('addresses' in a && a.addresses[0].address).not.toBe('addresses' in a && a.addresses[1].address);
  });
  it.each([
    { id: 3, op: 'descriptor-batch', descriptor: expression, testnet: false, start: 0, count: 1 },
    { id: 4, op: 'descriptor-batch', descriptor, testnet: true, start: 0, count: 1 },
    { id: 5, op: 'derive-batch', key, script: 'p2wpkh', testnet: false, branch: 'external', start: 0, count: 21 },
    { id: 6, op: 'derive-batch', key: 'xprvPRIVATE', script: 'p2wpkh', testnet: false, branch: 'external', start: 0, count: 1 },
  ] as DiscoveryRequest[])('rejects unsupported unchecked/private/network/range input %#', request => {
    const result = dispatch(request); expect(result.id).toBe(request.id); expect(result.ok).toBe(false);
    expect('addresses' in result).toBe(false);
  });
});
