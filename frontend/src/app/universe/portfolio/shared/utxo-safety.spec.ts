import { describe, expect, it } from 'vitest';
import { analyzeConsolidation, classifyUtxo, effectiveValue } from './utxo-safety';
import type { PortfolioUtxo } from '@app/shared/universe-portfolio-v2.types';

const utxo = (overrides: Partial<PortfolioUtxo> = {}): PortfolioUtxo => ({
  schemaVersion: 'universe-portfolio-utxo-v1',
  chain: 'bitcoin',
  network: 'mainnet',
  txid: 'a'.repeat(64),
  vout: 0,
  valueAtomic: '100000',
  scriptType: 'p2wpkh',
  address: 'bc1qexample',
  confirmationsAtomic: '10',
  blockHeightAtomic: '900000',
  blockHash: null,
  firstSeenAt: null,
  spent: false,
  pending: false,
  coinbase: false,
  maturityHeightAtomic: null,
  assetState: 'proven',
  assets: [],
  warnings: [],
  sourceReports: [],
  ...overrides,
});

describe('utxo safety classification', () => {
  it('calls an output plain only when proven and composition is proven-empty', () => {
    expect(classifyUtxo(utxo()).primary).toBe('plain-proven');
  });

  it('never calls an unproven output plain', () => {
    const warningUtxo = utxo({
      assetState: 'partial',
      warnings: ['No protocol authority answered for this output; its asset composition is unknown.'],
    });
    expect(classifyUtxo(warningUtxo).primary).toBe('unknown-asset-state');
    expect(classifyUtxo(warningUtxo).classes).toContain('unknown-asset-state');
  });

  it('marks asset-bearing, pending, and immature coinbase outputs', () => {
    expect(classifyUtxo(utxo({ assets: [{ assetKey: 'x' }] as never })).classes).toContain('asset-bearing');
    expect(classifyUtxo(utxo({ pending: true })).classes).toContain('pending');
    expect(classifyUtxo(utxo({ coinbase: true, maturityHeightAtomic: '900050' })).classes).toContain('immature-coinbase');
  });

  it('marks dust at the given threshold', () => {
    expect(classifyUtxo(utxo({ valueAtomic: '250' }), { dustThresholdAtomic: '1000' }).classes).toContain('economic-dust');
    expect(classifyUtxo(utxo({ valueAtomic: '5000' }), { dustThresholdAtomic: '1000' }).classes).not.toContain('economic-dust');
  });
});

describe('effective value economics', () => {
  it('computes input cost, effective value, and break-even exactly', () => {
    const result = effectiveValue('100000', 'p2wpkh', '10');
    expect(result).not.toBeNull();
    // 57.25 vB * 10 sat/vB = 572.5 → rounds up to 573 sats.
    expect(result!.inputCostAtomic).toBe('573');
    expect(result!.effectiveValueAtomic).toBe('99427');
    expect(result!.economic).toBe(true);
    expect(result!.breakEvenFeeRateSatVb.split('.')[0]).toBe('1746');
  });

  it('marks an output uneconomic when the fee eats it', () => {
    const result = effectiveValue('300', 'p2pkh', '50');
    expect(result!.economic).toBe(false);
    expect(result!.effectiveValueAtomic).toBe('0');
  });

  it('refuses malformed inputs with null, never a guess', () => {
    expect(effectiveValue('junk', 'p2wpkh', '10')).toBeNull();
    expect(effectiveValue('100000', 'p2wpkh', '-1')).toBeNull();
  });
});

describe('consolidation analysis', () => {
  it('analyzes proven plain outputs only, with exclusions named', () => {
    const analysis = analyzeConsolidation(
      [
        utxo({ txid: 'a'.repeat(64), valueAtomic: '50000' }),
        utxo({ txid: 'b'.repeat(64), valueAtomic: '50000' }),
        utxo({ txid: 'c'.repeat(64), assets: [{ assetKey: 'x' }] as never }),
        utxo({ txid: 'd'.repeat(64), valueAtomic: '200', assetState: 'partial' }),
      ],
      '10',
      ['5', '20'],
    );
    expect(analysis.candidateCount).toBe(2);
    expect(analysis.totalValueAtomic).toBe('100000');
    expect(analysis.resultingUtxoCount).toBe(1);
    expect(analysis.excluded).toHaveLength(2);
    expect(analysis.alternativeFees.map((f) => f.rateSatVb)).toEqual(['5', '20']);
  });
});
