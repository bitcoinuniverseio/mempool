import { RbfTree } from '@interfaces/node-api.interface';
import { GraphOutspend, GraphTx, MAX_NODES } from './provenance-graph';

const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const txid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const sats = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const confirmation = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

/** Decode Esplora's actual input shape. Never renumber outputs or substitute zero. */
export function readGraphTransaction(value: unknown, requested: string): GraphTx | null {
  if (!object(value) || !txid(value.txid) || value.txid.toLowerCase() !== requested.toLowerCase()
    || !Array.isArray(value.vin) || !value.vin.length || !Array.isArray(value.vout) || !value.vout.length
    || value.vin.length > 100000 || value.vout.length > 100000) { return null; }
  const inputs: Array<GraphTx['inputs'][number]> = [];
  for (const vin of value.vin) {
    if (!object(vin)) { return null; }
    if (vin.is_coinbase === true) {
      if (value.vin.length !== 1) { return null; }
      continue;
    }
    if (!txid(vin.txid) || !sats(vin.vout) || vin.vout > 0xffffffff) { return null; }
    const amount = vin.prevout?.value;
    if (amount != null && !sats(amount)) { return null; }
    inputs.push({ txid: vin.txid.toLowerCase(), vout: vin.vout, valueSat: amount ?? null });
  }
  if (value.vout.some(output => !object(output) || !sats(output.value))) { return null; }
  if (value.fee != null && !sats(value.fee)) { return null; }
  return {
    txid: requested.toLowerCase(), confirmed: confirmation(value.status?.confirmed), feeSat: value.fee ?? null,
    inputs, outputs: value.vout.map((output, index) => ({ vout: index, valueSat: output.value })),
  };
}

export function readGraphOutspends(value: unknown, outputs: number): readonly GraphOutspend[] {
  if (!Array.isArray(value) || value.length !== outputs) { return []; }
  return value.map(item => {
    if (!object(item)) { return { spent: null, txid: null }; }
    if (item.spent === false) { return { spent: false, txid: null }; }
    if (item.spent === true && txid(item.txid)) {
      return { spent: true, txid: item.txid.toLowerCase(), confirmed: confirmation(item.status?.confirmed) };
    }
    return { spent: null, txid: null };
  });
}

/** Reject malformed, unrelated or unbounded replacement trees before traversal. */
export function readGraphReplacements(value: unknown, requested: string): { rbf: RbfTree | null; replaces: string[]; available: boolean } {
  const unavailable = { rbf: null, replaces: [], available: false };
  if (!object(value) || !Array.isArray(value.replaces) || value.replaces.length > MAX_NODES * 4
    || !value.replaces.every(txid)) { return unavailable; }
  const tree = value.replacements;
  if (tree != null) {
    const queue = [tree], seen = new Set<object>(), ids = new Set<string>();
    while (queue.length) {
      const node = queue.shift();
      if (!object(node) || seen.has(node) || seen.size >= MAX_NODES * 4 || !txid(node.tx?.txid)
        || !Array.isArray(node.replaces) || node.replaces.length > MAX_NODES * 4) { return unavailable; }
      seen.add(node); ids.add(node.tx.txid.toLowerCase()); queue.push(...node.replaces);
    }
    if (!ids.has(requested.toLowerCase())) { return unavailable; }
  }
  return { rbf: tree ?? null, replaces: value.replaces.map(id => id.toLowerCase()), available: true };
}

export function readGraphPackage(value: unknown, requested: string): string[] | null {
  if (!object(value) || value.freshness?.withinBudget !== true) { return null; }
  const entries = value.cluster?.transactions ?? value.cluster?.txids;
  if (!Array.isArray(entries) || entries.length > 100000) { return null; }
  const ids = entries.map(entry => typeof entry === 'string' ? entry : entry?.txid);
  if (!ids.every(txid) || !ids.some(id => id.toLowerCase() === requested.toLowerCase())) { return null; }
  return [...new Set<string>(ids.map(id => id.toLowerCase()))];
}
