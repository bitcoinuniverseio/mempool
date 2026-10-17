import { describe, expect, it } from 'vitest';
import {
  AssetInventoryContractError,
  InventoryAccumulator,
  decodeAssetInventory,
} from './asset-inventory.types';
import {
  ADDRESS,
  BLOCK_HASH,
  OTHER_HASH,
  TXID,
  Wire,
  allCoverage,
  fungibleAsset,
  inscriptionAsset,
  inventory,
  key,
  pageOf,
} from './asset-inventory.test-fixtures';

const TX = { kind: 'transaction' as const, chain: 'bitcoin', network: 'mainnet', key: TXID };
const BLOCK = { kind: 'block' as const, chain: 'bitcoin', network: 'mainnet', key: BLOCK_HASH };
const ADDR = { kind: 'address' as const, chain: 'bitcoin', network: 'mainnet', key: ADDRESS };

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AssetInventoryContractError);
    return (error as AssetInventoryContractError).code;
  }
  throw new Error('expected a contract error');
}

describe('decodeAssetInventory', () => {
  it('accepts a valid transaction inventory and keeps every quantity a string', () => {
    const huge = '123456789012345678901234567890123456';
    const decoded = decodeAssetInventory(inventory('transaction', {
      assets: [fungibleAsset('brc20', 'ordi', 18, 'ordi')],
      groups: [{ protocolId: 'brc20', subprotocolId: null, assetKeys: [key('brc20', 'ordi')], eventCount: 0 }],
      placements: [{ assetKey: key('brc20', 'ordi'), txid: TXID, side: 'output', index: 0, outpoint: TXID + ':0', amountAtomic: huge, offsetAtomic: null }],
    }), TX);
    expect(decoded.placements[0].amountAtomic).toBe(huge);
    expect(typeof decoded.placements[0].amountAtomic).toBe('string');
    expect(decoded.scope.key).toBe(TXID);
  });

  it('rejects another schema version', () => {
    expect(code(() => decodeAssetInventory(inventory('transaction', { schemaVersion: 'universe-asset-inventory-v2' }), TX)))
      .toBe('schema-version');
  });

  it.each([
    ['network', { network: 'signet' }, 'scope-network'],
    ['chain', { chain: 'dogecoin' }, 'scope-chain'],
    ['key', { key: 'f'.repeat(64) }, 'scope-key'],
    ['kind', { kind: 'block' }, 'scope-kind'],
  ])('rejects a response for another %s', (_label, scope, expected) => {
    expect(code(() => decodeAssetInventory(inventory('transaction', { scope }), TX))).toBe(expected);
  });

  it('rejects a block page whose scope block hash is not the requested hash', () => {
    expect(code(() => decodeAssetInventory(inventory('block', { scope: { blockHash: OTHER_HASH } }), BLOCK)))
      .toBe('scope-block-hash');
  });

  it.each([
    ['a JSON number amount', 1000],
    ['a negative amount', '-1'],
    ['a decimal point', '1.5'],
    ['a leading zero', '01'],
  ])('rejects %s', (_label, amount) => {
    const body = inventory('transaction', {
      assets: [fungibleAsset('brc20', 'ordi', 18, 'ordi')],
      placements: [{ assetKey: key('brc20', 'ordi'), txid: TXID, side: 'input', index: 0, outpoint: null, amountAtomic: amount, offsetAtomic: null }],
    });
    expect(code(() => decodeAssetInventory(body, TX))).toBe('placement-amount');
  });

  it('rejects duplicate assets, unknown references and impossible balance splits', () => {
    const ordi = fungibleAsset('brc20', 'ordi', 18, 'ordi');
    expect(code(() => decodeAssetInventory(inventory('transaction', { assets: [ordi, ordi] }), TX))).toBe('asset-duplicate');
    expect(code(() => decodeAssetInventory(inventory('transaction', {
      groups: [{ protocolId: 'brc20', subprotocolId: null, assetKeys: ['missing'], eventCount: 0 }],
    }), TX))).toBe('group-asset-unknown');
    expect(code(() => decodeAssetInventory(inventory('address', {
      assets: [ordi],
      balances: [{ assetKey: ordi.key, overallAtomic: '10', availableAtomic: '8', reservedAtomic: '3', outpoints: [] }],
    }), ADDR))).toBe('balance-split');
  });

  it('rejects a complete claim while a protocol is partial or pages remain', () => {
    expect(code(() => decodeAssetInventory(inventory('transaction', {
      coverage: allCoverage({ tap: ['partial', ['x']] }), complete: true,
    }), TX))).toBe('complete-claim');
    const page = pageOf('block', 0, 2, 25, { coverage: allCoverage() });
    expect(code(() => decodeAssetInventory({ ...page, complete: true }, BLOCK))).toBe('complete-claim');
  });

  it('requires a page for block and address scopes and an echo of the requested cursor', () => {
    expect(code(() => decodeAssetInventory(inventory('block', { page: null }), BLOCK))).toBe('page-missing');
    expect(code(() => decodeAssetInventory(pageOf('block', 1, 3, 25), BLOCK, 'cursor-2'))).toBe('page-cursor-mismatch');
    expect(decodeAssetInventory(pageOf('block', 1, 3, 25), BLOCK, 'cursor-1').page?.nextCursor).toBe('cursor-2');
  });

  it('keeps cursed inscription numbers signed and rejects unknown coverage states', () => {
    const cursed = inscriptionAsset();
    cursed.inscription.numberAtomic = '-42';
    expect(decodeAssetInventory(inventory('transaction', { assets: [cursed] }), TX).assets[0].inscription?.numberAtomic).toBe('-42');
    const rows = allCoverage();
    rows[0].state = 'unknown-state';
    expect(code(() => decodeAssetInventory(inventory('transaction', { coverage: rows }), TX))).toBe('coverage-state');
  });
});

describe('InventoryAccumulator', () => {
  const decode = (body: Wire, cursor: string | null) => decodeAssetInventory(body, BLOCK, cursor);

  it('merges pages, de-duplicates assets and treats more-pages partial as complete after the last page', () => {
    const inscription = inscriptionAsset();
    const group = { protocolId: 'ordinals', subprotocolId: null, assetKeys: [inscription.key], eventCount: 1 };
    const accumulator = new InventoryAccumulator();
    accumulator.add(decode(pageOf('block', 0, 2, 25, { assets: [inscription], groups: [group] }), null));
    expect(accumulator.coverage().find((row) => row.protocolId === 'ordinals')?.state).toBe('partial');
    expect(accumulator.result()?.complete).toBe(false);
    accumulator.add(decode(pageOf('block', 1, 2, 25, { assets: [inscription], groups: [group] }), 'cursor-1'));
    const merged = accumulator.result();
    expect(merged?.assets).toHaveLength(1);
    expect(merged?.groups[0].eventCount).toBe(2);
    expect(merged?.coverage.every((row) => row.state === 'complete')).toBe(true);
    expect(merged?.complete).toBe(true);
    expect(merged?.page?.toIndex).toBe(50);
  });

  it('keeps a protocol partial for every reason other than remaining pages', () => {
    const accumulator = new InventoryAccumulator();
    accumulator.add(decode(pageOf('block', 0, 2, 25, { coverage: allCoverage({ tap: ['partial', ['more-pages', 'classify-timeout']] }) }), null));
    accumulator.add(decode(pageOf('block', 1, 2, 25), 'cursor-1'));
    const tap = accumulator.coverage().find((row) => row.protocolId === 'tap');
    expect(tap?.state).toBe('partial');
    expect(tap?.reasons).toEqual(['classify-timeout']);
    expect(accumulator.result()?.complete).toBe(false);
  });

  it('rejects a page from another block hash and never merges it', () => {
    const accumulator = new InventoryAccumulator();
    accumulator.add(decode(pageOf('block', 0, 2, 25), null));
    const foreign = decodeAssetInventory(pageOf('address', 1, 2, 100, { scope: { blockHash: OTHER_HASH } }), ADDR, 'cursor-1');
    const addressWalk = new InventoryAccumulator();
    addressWalk.add(decodeAssetInventory(pageOf('address', 0, 2, 100), ADDR, null));
    expect(() => addressWalk.add(foreign)).toThrow('asset-inventory-scope-changed');
    expect(addressWalk.pages).toBe(1);
    const moved = decode(pageOf('block', 1, 2, 25, {
      checkpoints: [{ sourceId: 'ord', heightAtomic: '900001', blockHash: OTHER_HASH, generation: null }],
    }), 'cursor-1');
    expect(() => accumulator.add(moved)).toThrow('asset-inventory-scope-changed');
    expect(accumulator.pages).toBe(1);
  });

  it('ignores a repeated ledger balance instead of adding it', () => {
    const ordi = fungibleAsset('brc20', 'ordi', 18, 'ordi');
    const balance = { assetKey: ordi.key, overallAtomic: '5000', availableAtomic: '4000', reservedAtomic: '1000', outpoints: [] };
    const accumulator = new InventoryAccumulator();
    accumulator.add(decodeAssetInventory(pageOf('address', 0, 2, 100, { assets: [ordi], balances: [balance] }), ADDR, null));
    accumulator.add(decodeAssetInventory(pageOf('address', 1, 2, 100, { assets: [ordi], balances: [balance] }), ADDR, 'cursor-1'));
    expect(accumulator.result()?.balances).toEqual([balance]);
  });
});
