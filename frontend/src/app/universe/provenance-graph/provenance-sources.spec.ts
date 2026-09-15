import { describe, expect, it } from 'vitest';
import { readGraphTransaction, readGraphOutspends, readGraphReplacements, readGraphPackage } from './provenance-sources';
import { buildProvenanceGraph, layoutGraph, MAX_NODES, replacementPairs } from './provenance-graph';

const id = 'a'.repeat(64), parent = 'b'.repeat(64), spender = 'c'.repeat(64);
const source = () => ({ txid: id, vin: [{ txid: parent, vout: 3, prevout: { value: 1000 } }], vout: [{ value: 700 }, { value: 200 }], fee: 100, status: { confirmed: true } });

describe('actual Esplora provenance decoding', () => {
  it('uses vin identity and preserves canonical output positions', () => {
    const tx = readGraphTransaction(source(), id)!;
    expect(tx.inputs).toEqual([{ txid: parent, vout: 3, valueSat: 1000 }]);
    expect(tx.outputs).toEqual([{ vout: 0, valueSat: 700 }, { vout: 1, valueSat: 200 }]);
    expect(readGraphTransaction({ ...source(), vout: [{ value: 700 }, {}, { value: 200 }] }, id)).toBeNull();
  });
  it('rejects mismatched identity and malformed amounts without inventing zero', () => {
    expect(readGraphTransaction(source(), parent)).toBeNull();
    expect(readGraphTransaction({ ...source(), vin: [{ txid: parent, vout: 3 }] }, id)?.inputs[0].valueSat).toBeNull();
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1000']) {
      expect(readGraphTransaction({ ...source(), vout: [{ value }] }, id)).toBeNull();
    }
    expect(readGraphTransaction({ ...source(), status: {} }, id)?.confirmed).toBeNull();
  });
  it('handles coinbase without creating an input edge', () => {
    expect(readGraphTransaction({ ...source(), vin: [{ is_coinbase: true }] }, id)?.inputs).toEqual([]);
  });
  it('keeps missing spend status and spender confirmation unknown', () => {
    const tx = readGraphTransaction(source(), id)!;
    const graph = buildProvenanceGraph(tx, readGraphOutspends(null, 2));
    expect(graph.nodes.filter(node => node.kind === 'output').map(node => node.state)).toEqual(['unknown', 'unknown']);
    expect(graph.notes.join(' ')).toContain('Spend status is unknown');
    const observed = buildProvenanceGraph(tx, readGraphOutspends([{ spent: true, txid: spender }, { spent: false }], 2));
    expect(observed.nodes.find(node => node.kind === 'spender')?.state).toBe('unknown');
    expect(readGraphOutspends([{ spent: 'false' }, { spent: true, txid: 'bad' }], 2).every(item => item.spent === null)).toBe(true);
  });
  it('rejects unbound and stale package evidence', () => {
    const pack = { cluster: { txids: [id, parent] }, freshness: { withinBudget: true } };
    expect(readGraphPackage(pack, id)).toEqual([id, parent]);
    expect(readGraphPackage(pack, spender)).toBeNull();
    expect(readGraphPackage({ ...pack, freshness: { withinBudget: false } }, id)).toBeNull();
  });
  it('bounds replacement history and refuses unrelated or malformed IDs', () => {
    const tree: any = { tx: { txid: id }, replaces: [{ tx: { txid: parent }, replaces: [] }] };
    expect(readGraphReplacements({ replacements: tree, replaces: [] }, id).available).toBe(true);
    expect(readGraphReplacements({ replacements: tree, replaces: [] }, spender).available).toBe(false);
    tree.replaces.push(tree);
    expect(readGraphReplacements({ replacements: tree, replaces: [] }, id).available).toBe(false);
    expect(replacementPairs(tree).length).toBeLessThanOrEqual(MAX_NODES * 4);
  });
  it('never creates edges to omitted nodes and encloses every rendered node', () => {
    const tx = readGraphTransaction(source(), id)!;
    const graph = buildProvenanceGraph({ ...tx, inputs: Array.from({ length: MAX_NODES - 2 }, (_, vout) => ({ txid: parent, vout, valueSat: null })) }, [{ spent: true, txid: spender }, { spent: false, txid: null }]);
    const ids = new Set(graph.nodes.map(node => node.id));
    expect(graph.edges.every(edge => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    expect(graph.notes.join(' ')).toContain('spenders are not drawn');
    const full = layoutGraph(buildProvenanceGraph(tx, [{ spent: true, txid: spender }, { spent: false, txid: null }]));
    expect(full.nodes.every(node => node.x + 90 < full.width && node.y + 40 < full.height)).toBe(true);
  });
  it('labels a replaced transaction as replaced without declaring it confirmed', () => {
    const graph = buildProvenanceGraph(readGraphTransaction(source(), id)!, [], { rbfHistory: null, replaces: [parent], packageTxids: [] });
    expect(graph.nodes.find(node => node.id === `tx:${parent}`)?.state).toBe('replaced');
  });
});
