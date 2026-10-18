import { describe, expect, it } from 'vitest';
import { decodeAssetInventory } from './asset-inventory.types';
import { buildInventoryView, coverageStateLabel, quantityText } from './asset-inventory.view';
import {
  ADDRESS,
  TXID,
  allCoverage,
  fungibleAsset,
  inscriptionAsset,
  inventory,
  key,
  satAsset,
} from './asset-inventory.test-fixtures';

const TX = { kind: 'transaction' as const, chain: 'bitcoin', network: 'mainnet', key: TXID };
const U128_MAX = '340282366920938463463374607431768211455';

function transferTransaction() {
  const ordi = fungibleAsset('brc20', 'ordi', 18, 'ordi');
  const inscription = inscriptionAsset(undefined, [{
    protocolId: 'brc20', subprotocolId: null, kind: 'fungible', label: 'ordi', amountAtomic: '1000000000000000000000',
    decimals: 18, unit: 'ordi', relation: 'transferable', assetKey: ordi.key,
  }]);
  const sat = satAsset('1968750000000000', 'epic', '840000');
  return inventory('transaction', {
    coverage: allCoverage({ names: ['unconfigured', ['no-reader']], tap: ['stale'], dmt: ['not-indexed'], bitmap: ['unavailable'] }),
    assets: [inscription, ordi, sat],
    groups: [
      { protocolId: 'brc20', subprotocolId: null, assetKeys: [inscription.key, ordi.key], eventCount: 3 },
      { protocolId: 'ordinals', subprotocolId: null, assetKeys: [inscription.key], eventCount: 0 },
      { protocolId: 'rare_sats', subprotocolId: 'epic', assetKeys: [sat.key], eventCount: 0 },
    ],
    placements: [
      { assetKey: inscription.key, txid: TXID, side: 'input', index: 0, outpoint: 'e'.repeat(64) + ':0', amountAtomic: '1', offsetAtomic: '0' },
      { assetKey: inscription.key, txid: TXID, side: 'output', index: 1, outpoint: TXID + ':1', amountAtomic: '1', offsetAtomic: '0' },
      { assetKey: sat.key, txid: TXID, side: 'fee', index: null, outpoint: null, amountAtomic: '1', offsetAtomic: '42' },
    ],
    events: [
      event('e1', 'transfer', true, ordi.key, U128_MAX),
      event('e2', 'transfer', false, ordi.key, '5', 'insufficient-balance'),
      { ...event('e3', 'reward', true, ordi.key, '7'), txid: null, txIndex: null, blockEffect: true },
    ],
  });
}

function event(eventId: string, operation: string, accepted: boolean, assetKey: string, amountAtomic: string, reason: string | null = null) {
  return {
    eventId, sourceId: 'index-brc20', protocolId: 'brc20', subprotocolId: null, txid: TXID, txIndex: 3, operation,
    accepted, reason, assetKey, amountAtomic, fromAddress: null, fromOutpoint: null, toAddress: ADDRESS, toOutpoint: null,
    inscriptionId: null, blockEffect: false,
  };
}

describe('inventory presenter model', () => {
  const model = buildInventoryView(decodeAssetInventory(transferTransaction(), TX), new Map([['brc20', 'BRC-20']]));

  it('groups by protocol in the producer order, then by subprotocol', () => {
    expect(model.sections.map((section) => section.protocolId)).toEqual(['ordinals', 'rare_sats', 'brc20']);
    const rare = model.sections.find((section) => section.protocolId === 'rare_sats');
    expect(rare?.subgroups.map((group) => group.subprotocolId)).toEqual(['epic']);
  });

  it('counts an inscription classified by two protocols once and never doubles its quantity', () => {
    expect(model.distinctAssets).toBe(3);
    const brc20 = model.sections.find((section) => section.protocolId === 'brc20');
    expect(brc20?.assetCount).toBe(2);
    const ordinalsRow = model.sections[0].subgroups[0].assets[0];
    const brc20Row = brc20?.subgroups[0].assets.find((row) => row.key === ordinalsRow.key);
    // One inscription moving needs no In/Out count; it is a full card under its
    // own protocol and a one-line reference under the protocol that classifies it.
    for (const row of [ordinalsRow, brc20Row]) {
      expect(row?.totals).toBeNull();
    }
    expect(ordinalsRow.compact).toBe(false);
    expect(brc20Row?.compact).toBe(true);
    expect(brc20?.countLabel).toBe('2 assets, 3 events');
    expect(brc20Row?.facets).toHaveLength(1);
    expect(ordinalsRow.facets).toHaveLength(0);
    expect(quantityText(brc20Row!.facets[0].amount, brc20Row!.facets[0].unit)).toBe('1,000 ordi');
  });

  it('keeps quantities above the safe integer range exact with their decimals and unit', () => {
    const brc20 = model.sections.find((section) => section.protocolId === 'brc20')!;
    const applied = brc20.subgroups[0].accepted.find((row) => row.id.endsWith('e1'))!;
    expect(applied.amount?.exact).toBe('340282366920938463463.374607431768211455');
    expect(quantityText(applied.amount, applied.unit)).toBe('340,282,366,920,938,463,463.374607431768211455 ordi');
    const unknownScale = buildInventoryView(decodeAssetInventory(inventory('transaction', {
      assets: [fungibleAsset('tap', 'x', null, 'x')],
      groups: [{ protocolId: 'tap', subprotocolId: null, assetKeys: [key('tap', 'x')], eventCount: 0 }],
      placements: [{ assetKey: key('tap', 'x'), txid: TXID, side: 'output', index: 0, outpoint: null, amountAtomic: U128_MAX, offsetAtomic: null }],
    }), TX));
    const total = unknownScale.sections[0].subgroups[0].assets[0].totals!.output!;
    expect(total.kind).toBe('raw');
    expect(quantityText(total, 'x')).toBe('340,282,366,920,938,463,463,374,607,431,768,211,455 smallest units');
  });

  it('labels applied events, observations and block effects distinctly', () => {
    const group = model.sections.find((section) => section.protocolId === 'brc20')!.subgroups[0];
    expect(group.accepted.map((row) => row.statusLabel)).toEqual(['Applied', 'Applied']);
    expect(group.observations).toHaveLength(1);
    expect(group.observations[0].statusLabel).toBe('Observation, not applied');
    expect(group.observations[0].reason).toBe('Insufficient balance.');
    expect(group.accepted.find((row) => row.blockEffect)?.txid).toBeNull();
  });

  it('never states zero for a protocol that is not complete', () => {
    const row = (id: string) => model.coverage.find((entry) => entry.protocolId === id)!;
    expect(row('names').findingLabel).toBe('Unknown, not proven empty');
    expect(row('names').reasons).toEqual(['No source reads this protocol on this deployment.']);
    expect(row('unat').findingLabel).toBe('None, proven by the source');
    expect(row('ordinals').findingLabel).toBe('1 found');
    for (const id of ['names', 'tap', 'dmt', 'bitmap']) {
      expect(row(id).findingLabel).not.toMatch(/\b0\b/);
    }
    expect(new Set(['complete', 'partial', 'unavailable', 'unconfigured', 'stale', 'not-indexed']
      .map((state) => coverageStateLabel(state as never))).size).toBe(6);
    expect(model.complete).toBe(false);
    expect(model.retryable).toBe(true);
  });

  it('separates proven empty from unproven empty in the headline', () => {
    const proven = buildInventoryView(decodeAssetInventory(inventory('transaction'), TX));
    expect(proven.headline).toBe('No protocol assets. Every expected protocol proved it.');
    const unproven = buildInventoryView(decodeAssetInventory(inventory('transaction', {
      coverage: allCoverage({ ordinals: ['partial', ['pending']] }),
    }), TX));
    expect(unproven.headline).toBe('No protocol assets found so far. Some protocols could not prove absence.');
    expect(unproven.coverage[0].findingLabel).toBe('Unknown, not proven empty');
  });

  it('shows ledger balances with overall, available and reserved kept apart', () => {
    const ordi = fungibleAsset('brc20', 'ordi', 18, 'ordi');
    const view = buildInventoryView(decodeAssetInventory(inventory('address', {
      assets: [ordi],
      groups: [{ protocolId: 'brc20', subprotocolId: null, assetKeys: [ordi.key], eventCount: 0 }],
      balances: [{ assetKey: ordi.key, overallAtomic: '5000000000000000000', availableAtomic: '4000000000000000000', reservedAtomic: '1000000000000000000', outpoints: [] }],
    }), { kind: 'address', chain: 'bitcoin', network: 'mainnet', key: ADDRESS }));
    const balance = view.sections[0].subgroups[0].assets[0].balance!;
    expect([balance.overall.exact, balance.available?.exact, balance.reserved?.exact]).toEqual(['5', '4', '1']);
    expect(view.sections[0].subgroups[0].assets[0].totals).toBeNull();
  });
});
