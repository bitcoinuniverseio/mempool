import { readFileSync } from 'fs';
import { resolve } from 'path';
import { address, networks } from 'bitcoinjs-lib';
import { messageTransactions, verifyMessageSignature } from './message-signature';
import { verificationService } from './verification.service';
import { coreFilterSource } from '../compact-filters/core-filter-source';
import { CompactFiltersEvidenceError } from '../compact-filters/compact-filters.service';

const bip322 = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/bip322-basic.json'), 'utf8')).vectors;
const bip137 = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/bip137-reference.json'), 'utf8')).vectors;
describe('official message signature vectors with actual native crypto and script execution', () => {
  it.each(bip322.tx_hashes as any[])('constructs the specified virtual transaction hashes for $message', (row: any) => {
    const pair = messageTransactions(row.message, address.toOutputScript(row.address, networks.bitcoin));
    expect(pair.spend.getId()).toBe(row.to_spend_tx_hash); expect(pair.sign.getId()).toBe(row.to_sign_tx_hash);
  });
  for (const row of bip322.simple) {
    for (const signature of row.bip322_signatures) {
      it(`verifies actual ${row.type} reference signature for ${JSON.stringify(row.message)}`, async () => {
        const result = await verifyMessageSignature(row.address, row.message, signature, 'bip322_simple', 'mainnet');
        expect(result.is_valid).toBe(true);
        expect((await verifyMessageSignature(row.address, row.message + ' changed', signature, 'bip322_simple', 'mainnet')).is_valid).toBe(false);
      });
    }
  }
  it.each(bip322.error as any[])('rejects reference error: $description', async (row: any) => {
    const result = await verifyMessageSignature(row.address, row.message, row.signature, 'bip322_simple', 'mainnet');
    expect(result.is_valid).toBe(false);
  });
  for (const row of bip137.verify) {
    for (const variant of [row, row.compressed, ...Object.values(row.segwit ?? {})] as any[]) {
      it(`verifies BIP137 address encoding ${variant.address}`, async () => {
        expect((await verifyMessageSignature(variant.address, row.message, variant.signature, 'bip137', 'mainnet')).is_valid).toBe(true);
        expect((await verifyMessageSignature(variant.address, row.message + 'x', variant.signature, 'bip137', 'mainnet')).is_valid).toBe(false);
      });
    }
  }
  it('keeps unsupported scripts and unavailable native engine separate from invalid signatures', async () => {
    const original = process.env.UNIVERSE_SCRIPT_TRACE_ENGINE;
    process.env.UNIVERSE_SCRIPT_TRACE_ENGINE = resolve(__dirname, 'missing-native-engine');
    try {
      const row = bip322.simple[0];
      await expect(verifyMessageSignature(row.address, row.message, row.bip322_signatures[0], 'bip322_simple', 'mainnet')).rejects.toMatchObject({ code: 'unavailable-signature-verifier', status: 503 });
    } finally { if (original === undefined) delete process.env.UNIVERSE_SCRIPT_TRACE_ENGINE; else process.env.UNIVERSE_SCRIPT_TRACE_ENGINE = original; }
    const row = bip322.simple[0];
    expect((await verifyMessageSignature(row.address, row.message, row.bip322_signatures[0], 'bip322_simple', 'regtest')).is_valid).toBe(false);
  });
});
describe('compact verification route shares the real owned filter source', () => {
  afterEach(() => jest.restoreAllMocks());
  it('matches an empty actual-source filter as negative without inventing a transaction or balance', async () => {
    const get = jest.spyOn(coreFilterSource, 'getBlock').mockResolvedValue({ block_height: 0, filter_bytes_hex: '00', filter_header: 'ab'.repeat(32), source: 'owned-core-basic-filter-index' } as any);
    const result = await verificationService.queryCompactFilter('00'.repeat(32), ['51'], 'regtest');
    expect(get).toHaveBeenCalledWith('00'.repeat(32), 'regtest'); expect(result.matched).toBe(false); expect(result.peer_agreement).toBeNull();
  });
  it('preserves unavailable source and rejects malformed query before reading', async () => {
    const get = jest.spyOn(coreFilterSource, 'getBlock').mockRejectedValue(new CompactFiltersEvidenceError('unavailable-filter-index', 'No owned filter index.'));
    await expect(verificationService.queryCompactFilter('00'.repeat(32), ['51'], 'regtest')).rejects.toMatchObject({ code: 'unavailable-filter-index', status: 503 });
    get.mockClear();
    await expect(verificationService.queryCompactFilter('00'.repeat(32), ['0x51'], 'regtest')).rejects.toMatchObject({ status: 400 }); expect(get).not.toHaveBeenCalled();
  });
});
