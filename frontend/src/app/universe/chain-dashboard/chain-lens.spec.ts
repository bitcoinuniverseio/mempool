import {
  applyLensFilter,
  chainAtomicUnit,
  lensFilters,
  readLensItems,
} from '@app/universe/chain-dashboard/chain-lens';
import {
  formatFeePerKb,
  formatNetworkRate,
  formatSeconds,
} from '@app/universe/chain-dashboard/chain-dashboard-format';

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    txid: 'a'.repeat(64),
    sizeBytesAtomic: '250',
    fee: { amountAtomic: '500000', rateDecimal: '2000000', rateUnit: 'koinu/kB' },
    transparent: { inputs: [{}], outputs: [{}, {}] },
    protocolActions: { candidates: [], confirmed: [] },
    firstSeenAt: '2026-08-30T11:59:00Z',
    ...overrides,
  };
}

describe('Chain lens reading', () => {
  it('reads real pending transactions and their public facts', () => {
    const items = readLensItems({ transactions: [envelope()] });
    expect(items.length).toBe(1);
    expect(items[0].sizeBytes).toBe(250);
    expect(items[0].feeExact).toBe('500000');
    expect(items[0].rateLabel).toBe('2000000 koinu/kB');
  });

  it('keeps a shielded transaction with no readable fee, without inventing one', () => {
    const items = readLensItems({
      transactions: [
        envelope({
          fee: { amountAtomic: null, rateDecimal: null, rateUnit: null },
          shielded: { privacyNotice: 'only structure is public' },
        }),
      ],
    });
    expect(items[0].feeExact).toBeNull();
    expect(items[0].rate).toBeNull();
    expect(items[0].shielded).toBe(true);
  });

  it('drops entries without a txid or a positive size', () => {
    const items = readLensItems({
      transactions: [
        envelope({ txid: 'nope' }),
        envelope({ sizeBytesAtomic: '0' }),
        envelope(),
      ],
    });
    expect(items.length).toBe(1);
  });

  it('classifies consolidation and protocol activity from public structure', () => {
    const consolidation = envelope({
      transparent: { inputs: [{}, {}, {}, {}], outputs: [{}] },
    });
    const protocol = envelope({
      protocolActions: { candidates: [{ protocolId: 'drc20' }], confirmed: [] },
    });
    const items = readLensItems({ transactions: [consolidation, protocol] });
    expect(applyLensFilter(items, 'consolidation').length).toBe(1);
    expect(applyLensFilter(items, 'protocol').length).toBe(1);
  });

  it('offers chain-native filters, never Bitcoin classifications', () => {
    const doge = lensFilters('dogecoin').map((filter) => filter.id);
    const zec = lensFilters('zcash').map((filter) => filter.id);
    expect(doge).toContain('consolidation');
    expect(doge).not.toContain('shielded');
    expect(zec).toContain('shielded');
    expect(zec).toContain('transparent');
  });

  it('uses each chain native atomic unit in the graph tooltip', () => {
    expect(chainAtomicUnit('dogecoin')).toBe('koinu');
    expect(chainAtomicUnit('zcash')).toBe('zatoshi');
  });
});

describe('Dashboard format helpers', () => {
  it('formats network rates with SI prefixes and keeps the exact figure', () => {
    const rate = formatNetworkRate('1621340000000000', 'hashes-per-second');
    expect(rate?.display).toBe('1.62 PH/s');
    expect(rate?.exact).toBe('1621340000000000');
    expect(formatNetworkRate('8123.4', 'solutions-per-second')?.display).toBe(
      '8.12 kSol/s'
    );
    expect(formatNetworkRate(null, 'hashes-per-second')).toBeNull();
  });

  it('formats seconds as readable spans', () => {
    expect(formatSeconds('61')?.display).toBe('61 s');
    expect(formatSeconds('124.8')?.display).toBe('2 min 5 s');
    expect(formatSeconds(null)).toBeNull();
  });

  it('shifts koinu-per-kilobyte figures to the ticker unit', () => {
    expect(formatFeePerKb('2010471.204', 8)?.display).toBe('0.0201');
    expect(formatFeePerKb('100000000', 8)?.display).toBe('1.00');
    expect(formatFeePerKb(null, 8)).toBeNull();
  });
});
