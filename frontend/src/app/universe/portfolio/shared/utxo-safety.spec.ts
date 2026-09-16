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
    // Conservative P2WPKH estimate: 69 vB * 10 sat/vB = 690 sats.
    expect(result!.inputCostAtomic).toBe('690');
    expect(result!.effectiveValueAtomic).toBe('99310');
    expect(result!.economic).toBe(true);
    expect(result!.breakEvenFeeRateSatVb.split('.')[0]).toBe('1449');
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


describe('source and estimate boundaries', () => {
  it('rejects fractional atomic values, oversized values and unknown scripts without throwing', () => {
    expect(effectiveValue('1.5', 'p2wpkh', '1')).toBeNull();
    expect(effectiveValue('1'.repeat(1000), 'p2wpkh', '1')).toBeNull();
    expect(effectiveValue('1000', 'p2wsh', '1')).toBeNull();
    expect(effectiveValue('1000', 'p2tr', '1')?.inputCostAtomic).toBe('58');
    expect(effectiveValue('1000', 'p2sh-p2wpkh', '1')?.inputCostAtomic).toBe('92');
  });
  it('uses actual Bitcoin confirmations for maturity, never presence of a maturity height alone', () => {
    expect(classifyUtxo(utxo({coinbase:true, maturityHeightAtomic:'900100', confirmationsAtomic:'99'})).primary).toBe('immature-coinbase');
    expect(classifyUtxo(utxo({coinbase:true, maturityHeightAtomic:'900100', confirmationsAtomic:'100'})).primary).toBe('plain-proven');
    expect(classifyUtxo(utxo({coinbase:true, confirmationsAtomic:'invalid'})).primary).toBe('unknown-asset-state');
    expect(classifyUtxo(utxo({assetState:'outside_coverage'})).primary).toBe('unknown-asset-state');
  });
  it('counts transaction overhead, one resulting input and duplicate/network exclusions', () => {
    const a = utxo(); const b = utxo({txid:'b'.repeat(64)});
    const result = analyzeConsolidation([a,b,a,utxo({network:'signet'})], '10', ['1']);
    expect(result.candidateCount).toBe(2); expect(result.excluded).toHaveLength(2);
    expect(result.currentFeeAtomic).toBe('1800'); // 138 inputs + 11 overhead + 31 output.
    expect(result.futureInputSavingsAtomic).toBe('690'); // 138 minus resulting input69.
    expect(result.estimateOnly).toBe(true);
    expect(analyzeConsolidation([a], '10', []).futureInputSavingsAtomic).toBe('0');
    expect(analyzeConsolidation([], '10', []).currentFeeAtomic).toBe('0');
    expect(() => analyzeConsolidation([a], '-1', [])).toThrow('Invalid');
  });
});
