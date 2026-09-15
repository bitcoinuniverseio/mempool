// The service is exercised through an injected fixture index; the live factory must not open clients.
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: {}, bitcoinCoreApi: {} }));

import { txGraphService, GraphIndex, GraphInputError, GRAPH_LIMITS } from './tx-graph.service';
import { developerIdentity, AuthenticatedOwner } from '../identity/developer-identity';
import { MemoryOwnerStore, useOwnerStore } from '../identity/owner-store';
import { IEsploraApi } from '../../bitcoin/esplora-api.interface';

/**
 * A small fixture chain stands in for the Esplora index:
 *   A (coinbase) -> B -> C -> D, plus E spending B's second output.
 * Every node and edge the service returns must exist in this fixture.
 */
const id = (letter: string): string => letter.repeat(64);

function transaction(txid: string, inputs: { txid: string; vout: number; value: number; address: string }[], outputs: { value: number; address: string }[], height?: number): IEsploraApi.Transaction {
  return {
    txid, version: 2, locktime: 0, size: 200, weight: 800, fee: 100,
    vin: inputs.map(input => ({ txid: input.txid, vout: input.vout, is_coinbase: input.txid === '', scriptsig: '', scriptsig_asm: '', sequence: 0, witness: [], prevout: input.txid === '' ? null : { scriptpubkey: '', scriptpubkey_asm: '', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: input.address, value: input.value } })),
    vout: outputs.map(output => ({ scriptpubkey: '', scriptpubkey_asm: '', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: output.address, value: output.value })),
    status: height ? { confirmed: true, block_height: height, block_hash: 'h'.repeat(64), block_time: 1 } : { confirmed: false },
  } as unknown as IEsploraApi.Transaction;
}

const A = transaction(id('a'), [{ txid: '', vout: 0, value: 0, address: '' }], [{ value: 5000, address: 'addrA' }], 10);
const B = transaction(id('b'), [{ txid: id('a'), vout: 0, value: 5000, address: 'addrA' }], [{ value: 3000, address: 'tb1qaddrbfixture0000000000' }, { value: 1900, address: 'tb1qaddrb2fixture000000000' }], 11);
const C = transaction(id('c'), [{ txid: id('b'), vout: 0, value: 3000, address: 'tb1qaddrbfixture0000000000' }], [{ value: 2900, address: 'addrC' }], 12);
const D = transaction(id('d'), [{ txid: id('c'), vout: 0, value: 2900, address: 'addrC' }], [{ value: 2800, address: 'addrD' }]);
const E = transaction(id('e'), [{ txid: id('b'), vout: 1, value: 1900, address: 'tb1qaddrb2fixture000000000' }], [{ value: 1800, address: 'addrE' }], 12);
const txs = new Map([A, B, C, D, E].map(tx => [tx.txid, tx]));
const spends: Record<string, IEsploraApi.Outspend[]> = {
  [id('a')]: [{ spent: true, txid: id('b'), vin: 0, status: B.status }],
  [id('b')]: [{ spent: true, txid: id('c'), vin: 0, status: C.status }, { spent: true, txid: id('e'), vin: 0, status: E.status }],
  [id('c')]: [{ spent: true, txid: id('d'), vin: 0, status: D.status }],
  [id('d')]: [{ spent: false }],
  [id('e')]: [{ spent: false }],
} as unknown as Record<string, IEsploraApi.Outspend[]>;

let fetches: string[] = [];
const fixtureIndex: GraphIndex = {
  transaction: async txid => { fetches.push('tx:' + txid); const tx = txs.get(txid); if (!tx) { throw new Error('404'); } return tx; },
  outspends: async txid => { fetches.push('spends:' + txid); return spends[txid] ?? []; },
  addressTransactions: async address => { fetches.push('addr:' + address); const list = [...txs.values()].filter(tx => tx.vout.some(v => v.scriptpubkey_address === address) || tx.vin.some(v => v.prevout?.scriptpubkey_address === address)); if (!list.length) { throw new Error('404'); } return list; },
};

describe('transaction graph over the index', () => {
  beforeEach(() => { txGraphService.index = fixtureIndex; fetches = []; });

  it('expands from a transaction in both directions with real neighbours only', async () => {
    const result = await txGraphService.queryGraph(id('b'), 2, 'both');
    expect(result.root_type).toBe('transaction');
    expect(result.nodes.map(n => n.id).sort()).toEqual([id('a'), id('b'), id('c'), id('d'), id('e')].sort());
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_id: id('a'), target_id: id('b'), value_sats: 5000, vout: 0, edge_type: 'input' }),
      expect.objectContaining({ source_id: id('b'), target_id: id('c'), value_sats: 3000, vout: 0, edge_type: 'output' }),
      expect.objectContaining({ source_id: id('b'), target_id: id('e'), value_sats: 1900, vout: 1, edge_type: 'output' }),
      expect.objectContaining({ source_id: id('c'), target_id: id('d'), value_sats: 2900, vout: 0, edge_type: 'output' }),
    ]));
    expect(result.nodes.find(n => n.id === id('b'))).toMatchObject({ depth: 0, value_sats: 4900, status: 'confirmed', block_height: 11 });
    expect(result.nodes.find(n => n.id === id('d'))).toMatchObject({ depth: 2, status: 'mempool' });
    expect(result.truncated).toBe(false);
    expect(result.fetches).toBeGreaterThan(0);
  });

  it('respects direction, hops and the value floor', async () => {
    const up = await txGraphService.queryGraph(id('c'), 4, 'upstream');
    expect(up.nodes.map(n => n.id).sort()).toEqual([id('a'), id('b'), id('c')].sort());
    const one = await txGraphService.queryGraph(id('b'), 1, 'downstream');
    expect(one.nodes.map(n => n.id).sort()).toEqual([id('b'), id('c'), id('e')].sort());
    const floor = await txGraphService.queryGraph(id('b'), 2, 'downstream', 2500);
    expect(floor.nodes.map(n => n.id).sort()).toEqual([id('b'), id('c'), id('d')].sort());
    expect(floor.edges.every(e => e.value_sats >= 2500)).toBe(true);
  });

  it('starts from an address and links only its own outputs and spends', async () => {
    const result = await txGraphService.queryGraph('tb1qaddrbfixture0000000000', 1, 'both');
    expect(result.root_type).toBe('address');
    expect(result.nodes.map(n => n.id).sort()).toEqual(['tb1qaddrbfixture0000000000', id('b'), id('c')].sort());
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_id: id('b'), target_id: 'tb1qaddrbfixture0000000000', edge_type: 'output', value_sats: 3000 }),
      expect.objectContaining({ source_id: 'tb1qaddrbfixture0000000000', target_id: id('c'), edge_type: 'input', value_sats: 3000 }),
    ]));
  });

  it('an unknown transaction, a malformed entity or a bad direction are input errors', async () => {
    await expect(txGraphService.queryGraph(id('9'), 1)).rejects.toThrow(GraphInputError);
    await expect(txGraphService.queryGraph('not valid!', 1)).rejects.toThrow(GraphInputError);
    await expect(txGraphService.queryGraph(id('b'), 1, 'sideways' as never)).rejects.toThrow(GraphInputError);
  });

  it('finds a real downstream path or reports that none exists', async () => {
    const found = await txGraphService.findShortestPath(id('a'), id('d'));
    expect(found.path_found).toBe(true);
    expect(found.node_sequence).toEqual([id('a'), id('b'), id('c'), id('d')]);
    expect(found.total_hops).toBe(3);
    expect(found.total_value_transferred_sats).toBe(2900);
    const missing = await txGraphService.findShortestPath(id('d'), id('a'));
    expect(missing).toMatchObject({ path_found: false, total_hops: 0, node_sequence: [], edge_sequence: [] });
    expect(missing.search_exhausted).toBe(false);
    await expect(txGraphService.findShortestPath('tx-source-1111', 'tx-target-2222')).rejects.toThrow(GraphInputError);
  });

  it('stops at the node limit and says so', async () => {
    // A star: root pays 500 outputs, each spent by its own child.
    const root = 'f'.repeat(64);
    const many: GraphIndex = {
      transaction: async txid => txid === root
        ? transaction(root, [], Array.from({ length: 500 }, (_, i) => ({ value: 10, address: 'x' + i })), 1)
        : transaction(txid, [{ txid: root, vout: Number(txid.slice(0, 3)), value: 10, address: 'x' }], [{ value: 9, address: 'y' }], 2),
      outspends: async () => Array.from({ length: 500 }, (_, i) => ({ spent: true, txid: i.toString().padStart(3, '0') + '0'.repeat(61), vin: 0 })) as never,
      addressTransactions: async () => [],
    };
    txGraphService.index = many;
    const result = await txGraphService.queryGraph(root, 1, 'downstream');
    expect(result.truncated).toBe(true);
    expect(['node_limit', 'fetch_budget']).toContain(result.truncation_reason);
    expect(result.nodes.length).toBeLessThanOrEqual(GRAPH_LIMITS.maxNodes);
    expect(result.fetches).toBeLessThanOrEqual(GRAPH_LIMITS.fetchBudget);
  });
});

describe('graph cases belong to their owner', () => {
  let alice: AuthenticatedOwner;
  let bob: AuthenticatedOwner;

  beforeEach(async () => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    const a = await developerIdentity.bootstrapOwner('a', '203.0.113.1');
    const b = await developerIdentity.bootstrapOwner('b', '203.0.113.2');
    alice = (await developerIdentity.authenticateKey(a.secret_key))!;
    bob = (await developerIdentity.authenticateKey(b.secret_key))!;
  });

  it('starts with nothing seeded and isolates owners', async () => {
    expect(await txGraphService.getCases(alice)).toEqual([]);
    const saved = await txGraphService.saveCase(alice, 'Case one', id('b'), 2, { min_value_sats: 1 }, { mode: 'radial' }, 'notes', 5);
    expect(saved.owner_id).toBe(alice.owner_id);
    expect((await txGraphService.getCases(alice)).map(c => c.case_id)).toEqual([saved.case_id]);
    expect(await txGraphService.getCases(bob)).toEqual([]);
    expect(await txGraphService.getCaseById(bob, saved.case_id)).toBeNull();
    expect(await txGraphService.updateCase(bob, saved.case_id, { title: 'stolen' })).toBeNull();
    expect(await txGraphService.deleteCase(bob, saved.case_id)).toBe(false);
    const updated = await txGraphService.updateCase(alice, saved.case_id, { is_shared: true, notes: 'shared' });
    expect(updated?.share_token).toHaveLength(32);
    expect(updated?.notes).toBe('shared');
    expect(await txGraphService.deleteCase(alice, saved.case_id)).toBe(true);
  });

  it('validates the case input', async () => {
    await expect(txGraphService.saveCase(alice, '', id('b'), 2, {}, {}, '', 0)).rejects.toMatchObject({ code: 'invalid_title' });
    await expect(txGraphService.saveCase(alice, 'x', 'unknown!!', 2, {}, {}, '', 0)).rejects.toThrow(GraphInputError);
    await expect(txGraphService.saveCase(alice, 'x', id('b'), 2, {}, {}, 'n'.repeat(5000), 0)).rejects.toMatchObject({ code: 'invalid_notes' });
  });
});
