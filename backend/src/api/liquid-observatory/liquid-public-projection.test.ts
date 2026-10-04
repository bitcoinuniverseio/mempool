import { liquidAtomic, projectLiquidPublicBlock, verifyLiquidPegInput, LiquidPublicPegInput } from './liquid-public-projection';
import { LiquidPairObservation } from './liquid-paired-source';

const hash = 'a'.repeat(64);
function evidence(): { header: any; block: any } {
  return { header: { height: 0, hash, signblock_challenge: '51', signblock_witness_hex: '' },
    block: { height: 0, hash, time: 1, tx: [{ txid: hash, vin: [], vout: [{ asset: hash, value: 0.01 }] }] } };
}
describe('public Liquid block projection', () => {
  test.each([[0.01, '1000000'], [1e-8, '1'], [0.00007608, '7608'], [100, '10000000000']])('normalizes monetary %s exactly', (value, expected) => {
    expect(liquidAtomic(value)).toBe(expected);
  });
  test.each([-1, Infinity, NaN, '0.000000001', '1e100', '1.123456789'])('rejects invalid or subatomic amount %s', value => {
    expect(() => liquidAtomic(value)).toThrow();
  });
  test('keeps opaque values and assets opaque', () => {
    const { header, block } = evidence();
    block.tx[0].vout.push({ valuecommitment: '08' + hash, assetcommitment: '0a' + hash });
    const result = projectLiquidPublicBlock(header, block);
    expect(result.confidentialOutputs).toBe(1);
    expect(result.explicitOutputs).toBe(1);
    expect(result).not.toHaveProperty('circulatingAmount');
  });
  test('rejects a commitment paired with a fabricated explicit amount', () => {
    const { header, block } = evidence();
    block.tx[0].vout[0].valuecommitment = '08' + hash;
    expect(() => projectLiquidPublicBlock(header, block)).toThrow();
  });
  test('records compact parameters without inventing absent peg scripts', () => {
    const { header, block } = evidence();
    header.dynamic_parameters = { current: { type: 'compact', root: hash, signblockscript: '51' } };
    const result = projectLiquidPublicBlock(header, block);
    expect(result.fedpegScript).toBeNull();
    expect(result.fedpegProgram).toBeNull();
  });
  test('accepts native dynafed witness stack without treating it as signer identity', () => {
    const { header, block } = evidence();
    header.signblock_witness_hex = ['51', 'aabb'];
    const result = projectLiquidPublicBlock(header, block);
    expect(result.blockWitnessBytes).toBe(3);
    expect(result).not.toHaveProperty('signersOnline');
  });
  test('requires full federation parameter scripts', () => {
    const { header, block } = evidence();
    header.dynamic_parameters = { current: { type: 'full', root: hash, signblockscript: '51' } };
    expect(() => projectLiquidPublicBlock(header, block)).toThrow();
  });
  test('binds native issuance amount and commitment separately', () => {
    const { header, block } = evidence();
    block.tx[0].vin.push({ issuance: { asset: hash, assetEntropy: hash, isreissuance: false,
      token: hash, assetamount: 100, tokenamountcommitment: '09' + hash } });
    const result = projectLiquidPublicBlock(header, block).issuances[0];
    expect(result.assetAmountAtomic).toBe('10000000000');
    expect(result.tokenAmountAtomic).toBeNull();
    expect(result.tokenAmountCommitment).toBe('09' + hash);
  });
  test('rejects a contradictory native checkpoint', () => {
    const { header, block } = evidence();
    block.hash = 'b'.repeat(64);
    expect(() => projectLiquidPublicBlock(header, block)).toThrow();
  });
  test('records an actual decoded peg-out destination as a request, never a parent payout', () => {
    const { header, block } = evidence();
    block.tx[0].vout[0] = { n: 0, asset: hash, value: 0.002,
      scriptPubKey: { pegout_chain: hash, pegout_hex: '0014' + 'b'.repeat(40), pegout_address: 'bcrt1qpublic' } };
    const output = projectLiquidPublicBlock(header, block).pegOutputs[0];
    expect(output.amountAtomic).toBe('200000');
    expect(output.parentScript).toBe('0014' + 'b'.repeat(40));
    expect(output).not.toHaveProperty('parentTxid');
    expect(output).not.toHaveProperty('finalized');
  });
  test.each(['destination', 'opaque-amount', 'malformed-index'])('rejects contradictory native peg-out %s', variant => {
    const { header, block } = evidence();
    block.tx[0].vout[0] = { n: 0, asset: hash, value: 0.002, scriptPubKey: { pegout_chain: hash, pegout_hex: '51' } };
    if (variant === 'destination') block.tx[0].vout[0].scriptPubKey.pegout_hex = 'zz';
    if (variant === 'opaque-amount') block.tx[0].vout[0].valuecommitment = '08' + hash;
    if (variant === 'malformed-index') block.tx[0].vout[0].n = -1;
    expect(() => projectLiquidPublicBlock(header, block)).toThrow();
  });
});

describe('independent peg deposit proof', () => {
  const input: LiquidPublicPegInput = { txid: hash, vin: 0, parentTxid: hash, parentVout: 1,
    amountAtomic: '1000000', asset: hash, parentGenesis: hash, parentBlockHash: hash,
    claimScript: '51', parentTransaction: '00', parentProof: '00' };
  const observation = { parent: { genesis: hash, height: 20 }, profile: { policyAsset: hash, peginConfirmationDepth: 10 } } as LiquidPairObservation;
  function reader(change: Record<string, any> = {}): { call: jest.Mock } {
    const values = { verifytxoutproof: [hash], decoderawtransaction: { txid: hash, vout: [{ n: 1, value: 0.01, scriptPubKey: { hex: '51' } }] },
      getblockheader: { hash, height: 10 }, getblockhash: hash, ...change };
    return { call: jest.fn(async method => values[method]) };
  }
  test('binds deposit proof, transaction, outpoint, amount and canonical parent', async () => {
    const source = reader();
    const result = await verifyLiquidPegInput(input, observation, source, new AbortController().signal);
    expect(result.amountAtomic).toBe('1000000');
    expect(result.parentConfirmations).toBe(11);
    expect(result.parentProofSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toHaveProperty('parentTransaction');
    expect(source.call).toHaveBeenCalledWith('getblockhash', [10], expect.anything());
  });
  test('rejects a parent reorg', async () => {
    await expect(verifyLiquidPegInput(input, observation, reader({ getblockhash: 'b'.repeat(64) }), new AbortController().signal)).rejects.toThrow('canonical');
  });
  test('rejects an immature proof', async () => {
    await expect(verifyLiquidPegInput(input, observation, reader({ getblockheader: { hash, height: 19 } }), new AbortController().signal)).rejects.toThrow();
  });
  test('rejects proof membership for another transaction', async () => {
    await expect(verifyLiquidPegInput(input, observation, reader({ verifytxoutproof: ['b'.repeat(64)] }), new AbortController().signal)).rejects.toThrow();
  });
  test('rejects wrong-parent witnesses before dispatch', async () => {
    const source = reader();
    await expect(verifyLiquidPegInput({ ...input, parentGenesis: 'b'.repeat(64) }, observation, source, new AbortController().signal)).rejects.toThrow();
    expect(source.call).not.toHaveBeenCalled();
  });
  test('dispatches nothing after caller cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const source = reader();
    await expect(verifyLiquidPegInput(input, observation, source, controller.signal)).rejects.toThrow('cancelled');
    expect(source.call).not.toHaveBeenCalled();
  });
});
