import { describe, expect, it } from 'vitest';
import { Transaction } from '@interfaces/electrs.interface';
import { isCoinbase, toPrivacyTransaction } from './privacy-map';

function explorerTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    txid: 'a'.repeat(64),
    version: 2,
    locktime: 0,
    size: 200,
    weight: 800,
    fee: 1000,
    vin: [{
      txid: 'b'.repeat(64),
      vout: 0,
      is_coinbase: false,
      scriptsig: '',
      scriptsig_asm: '',
      sequence: 0xfffffffd,
      prevout: {
        scriptpubkey: '0014' + 'ab'.repeat(20),
        scriptpubkey_asm: '',
        scriptpubkey_type: 'v0_p2wpkh',
        scriptpubkey_address: 'bc1qsender',
        value: 100_000,
      },
    }],
    vout: [{
      scriptpubkey: '0014' + 'cd'.repeat(20),
      scriptpubkey_asm: '',
      scriptpubkey_type: 'v0_p2wpkh',
      scriptpubkey_address: 'bc1qrecipient',
      value: 99_000,
    }],
    status: { confirmed: true, block_height: 900_000 },
    ...overrides,
  } as unknown as Transaction;
}

describe('toPrivacyTransaction', () => {
  it('carries the inputs across with their previous output details', () => {
    const mapped = toPrivacyTransaction(explorerTx());
    expect(mapped.inputs).toEqual([{
      index: 0,
      valueSats: 100_000,
      scriptType: 'v0_p2wpkh',
      address: 'bc1qsender',
      sequence: 0xfffffffd,
    }]);
  });

  it('carries the outputs across', () => {
    expect(toPrivacyTransaction(explorerTx()).outputs).toEqual([{
      index: 0,
      valueSats: 99_000,
      scriptType: 'v0_p2wpkh',
      address: 'bc1qrecipient',
    }]);
  });

  it('keeps an unloaded previous output as unknown rather than as zero', () => {
    // A rule comparing amounts then declines to run, which is right: a
    // comparison against a value that was never read is not a comparison.
    const mapped = toPrivacyTransaction(explorerTx({
      vin: [{ txid: 'b'.repeat(64), vout: 0, sequence: 0xfffffffd }],
    } as unknown as Partial<Transaction>));
    expect(mapped.inputs[0].valueSats).toBeNull();
    expect(mapped.inputs[0].scriptType).toBe('unknown');
    expect(mapped.inputs[0].address).toBeNull();
  });

  it('reads an absent sequence as final, which is what its absence means', () => {
    const mapped = toPrivacyTransaction(explorerTx({
      vin: [{ txid: 'b'.repeat(64), vout: 0 }],
    } as unknown as Partial<Transaction>));
    expect(mapped.inputs[0].sequence).toBe(0xffffffff);
  });

  it('takes the confirmation height only when the transaction is confirmed', () => {
    expect(toPrivacyTransaction(explorerTx()).confirmedHeight).toBe(900_000);
    expect(toPrivacyTransaction(explorerTx({
      status: { confirmed: false } as unknown as Transaction['status'],
    })).confirmedHeight).toBeNull();
  });

  it('survives a transaction with no inputs or outputs at all', () => {
    const mapped = toPrivacyTransaction(explorerTx({ vin: [], vout: [] }));
    expect(mapped.inputs).toEqual([]);
    expect(mapped.outputs).toEqual([]);
  });

  it('numbers the positions in order', () => {
    const mapped = toPrivacyTransaction(explorerTx({
      vout: [
        { value: 1, scriptpubkey_type: 'p2pkh' },
        { value: 2, scriptpubkey_type: 'p2pkh' },
        { value: 3, scriptpubkey_type: 'p2pkh' },
      ],
    } as unknown as Partial<Transaction>));
    expect(mapped.outputs.map((o) => o.index)).toEqual([0, 1, 2]);
  });
});

describe('isCoinbase', () => {
  it('recognises a coinbase input', () => {
    expect(isCoinbase(explorerTx({
      vin: [{ is_coinbase: true }],
    } as unknown as Partial<Transaction>))).toBe(true);
  });

  it('is false for an ordinary spend', () => {
    expect(isCoinbase(explorerTx())).toBe(false);
  });

  it('is false for a transaction with no inputs', () => {
    expect(isCoinbase(explorerTx({ vin: [] }))).toBe(false);
  });
});
