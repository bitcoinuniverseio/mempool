import { describe, expect, it } from 'vitest';
import {
  readDuneAsset,
  readDuneAssetDetail,
  readDuneAssetList,
} from '@app/universe/multichain-explorer/dune-assets';

/**
 * One dune, in the shape `/dogecoin/protocols/dunes` items carry per the
 * authority contract. The digits are chosen so a wrong shift is visible:
 * with divisibility 8 the supply is one hundred million, and unshifted it
 * reads as one hundred quadrillion.
 */
const DUNE = {
  dune: 'SUCH•WOW•DUNE',
  duneId: '5084000:1',
  numberAtomic: '1',
  symbol: 'D',
  divisibilityAtomic: '8',
  etchingTxid: 'a'.repeat(64),
  supplyAtomic: '10000000000000000',
  premineAtomic: '100000000',
  mintsAtomic: '21000',
  burnedAtomic: '0',
  etchedHeightAtomic: '5084000',
  etchedTimestampAtomic: '1700000000',
  mintable: true,
};

describe('a dune, read under its own divisibility', () => {
  it('shifts a quantity by the dune divisibility and never shifts a count', () => {
    const reading = readDuneAsset(DUNE);
    const figure = (key: string) => reading?.figures.find((f) => f.key === key);
    expect(figure('supplyAtomic')?.value).toEqual({
      display: '100,000,000',
      exact: '10000000000000000',
    });
    expect(figure('premineAtomic')?.value?.display).toBe('1');
    // Mints is a number of mint events. 21000 mints is 21000 mints.
    expect(figure('mintsAtomic')?.value).toEqual({ display: '21,000', exact: '21000' });
    expect(figure('etchedHeightAtomic')?.value?.display).toBe('5,084,000');
  });

  it('states the divisibility once and keeps the glyph as sent', () => {
    const reading = readDuneAsset(DUNE);
    expect(reading?.divisibility).toBe(8);
    expect(reading?.divisibilityExact).toBe('8');
    expect(reading?.symbol).toBe('D');
    expect(reading?.mintable).toBe(true);
    expect(reading?.etchedAt?.exact).toBe('1700000000');
  });

  it('shows no shifted quantity at all when the divisibility is unreadable', () => {
    const reading = readDuneAsset({ ...DUNE, divisibilityAtomic: 'eight' });
    expect(reading?.divisibility).toBeNull();
    const supply = reading?.figures.find((f) => f.key === 'supplyAtomic');
    expect(supply?.value).toBeNull();
    // A count needs no divisibility and is unaffected.
    expect(reading?.figures.find((f) => f.key === 'mintsAtomic')?.value?.display).toBe('21,000');
  });

  it('names a field it has no kind for rather than dropping it', () => {
    const reading = readDuneAsset({ ...DUNE, turbo_atomic: '1' });
    expect(reading?.unreadFields).toEqual(['turbo_atomic']);
    expect(reading?.figures.some((f) => f.key === 'turbo_atomic')).toBe(false);
  });

  it('is not this reading at all without a name and a divisibility', () => {
    expect(readDuneAsset({ tick: 'DOGI' })).toBeNull();
    expect(readDuneAsset({ dune: 'BARE' })).toBeNull();
    expect(readDuneAsset(null)).toBeNull();
  });
});

describe('a page of dunes', () => {
  const page = {
    chain: 'dogecoin',
    network: 'mainnet',
    blockCountAtomic: '5900001',
    blockHash: 'd'.repeat(64),
    inventoryComplete: true,
    totalCountAtomic: '3',
    nextCursor: null,
    dunes: [DUNE, { ...DUNE, dune: 'BARE', duneId: '5084001:0', symbol: null, mintable: false }],
  };

  it('reads every row and keeps the authority total exactly', () => {
    const list = readDuneAssetList(page);
    expect(list?.shownCount).toBe(2);
    expect(list?.totalExact).toBe('3');
    expect(list?.unreadRowCount).toBe(0);
    expect(list?.columns.map((column) => column.key)).toEqual([
      'supplyAtomic', 'mintsAtomic', 'burnedAtomic',
    ]);
    // What the table holds back is named, in the words the page uses.
    expect(list?.hiddenFigureFields).toEqual(['Number', 'Premine', 'Etched height']);
  });

  it('counts a row it cannot read rather than dropping it in silence', () => {
    const list = readDuneAssetList({ ...page, dunes: [DUNE, { tick: 'BARE' }] });
    expect(list?.shownCount).toBe(1);
    expect(list?.unreadRowCount).toBe(1);
  });

  it('is not this reading at all for other payloads', () => {
    expect(readDuneAssetList({ items: [DUNE] })).toBeNull();
    expect(readDuneAssetList({ dunes: [] })).toBeNull();
    expect(readDuneAssetList(null)).toBeNull();
  });
});

describe('one dune as the detail payload carries it', () => {
  it('reads the record under the dune key and nothing else', () => {
    const detail = {
      chain: 'dogecoin',
      network: 'mainnet',
      blockCountAtomic: '5900001',
      blockHash: 'd'.repeat(64),
      inventoryComplete: true,
      dune: DUNE,
    };
    expect(readDuneAssetDetail(detail)?.dune).toBe('SUCH•WOW•DUNE');
    expect(readDuneAssetDetail({ dunes: [DUNE] })).toBeNull();
    expect(readDuneAssetDetail(DUNE)).toBeNull();
  });
});
