import { AnchorReader } from './anchor-reader';
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
const txid = '11'.repeat(32), hash = '22'.repeat(32);
function reader(tx: any, utxo: any, chain = 'signet') {
  const call = jest.fn(async (method: string) => {
    if (method === 'getblockchaininfo') return { chain, bestblockhash: hash, blocks: 100 };
    if (method === 'getrawtransaction') { if (!tx) throw { code: -5 }; return tx; }
    if (method === 'gettxout') return utxo;
    throw Error('Unexpected RPC');
  });
  return { service: new AnchorReader({ network: 'signet', call }), call };
}
const tx = { txid, confirmations: 5, vout: [{ n: 0, value: 0.001, scriptPubKey: { hex: '51' } }] };
const utxo = { bestblock: hash, confirmations: 5, value: 0.001, scriptPubKey: { hex: '51' } };
describe('Owned Ark anchor evidence', () => {
  it.each(['x:0', `${txid}:-1`, `${txid}:1junk`, `${txid}:4294967296`])('rejects malformed input %s before source reads', async value => {
    const r = reader(tx, utxo); await expect(r.service.verify(value)).rejects.toMatchObject({ status: 400 }); expect(r.call).not.toHaveBeenCalled();
  });
  it('returns actual confirmed UTXO without fabricating protocol verification', async () => {
    const result = await reader(tx, utxo).service.verify(`${txid}:0`);
    expect(result).toMatchObject({ confirmations: 5, block_height: 96, spend_status: 'unspent', amount_sats: 100000, verified: false, protocol_verified: null, exit_delay_blocks: null });
  });
  it('proves known output is absent from current UTXO view', async () => {
    expect(await reader(tx, null).service.verify(`${txid}:0`)).toMatchObject({ spend_status: 'spent', outpoint_verified: true });
  });
  it('does not interpret unavailable transaction as nonexistent', async () => {
    expect(await reader(null, null).service.verify(`${txid}:0`)).toMatchObject({ spend_status: 'unknown', exists_onchain: null, confirmations: null });
  });
  it('distinguishes an invalid index from unknown transaction', async () => {
    expect(await reader(tx, null).service.verify(`${txid}:1`)).toMatchObject({ spend_status: 'invalid-output', outpoint_verified: false });
  });
  it('reads fresh state on every request', async () => {
    const r = reader(tx, utxo); await r.service.verify(`${txid}:0`); await r.service.verify(`${txid}:0`);
    expect(r.call.mock.calls.filter(call => call[0] === 'gettxout')).toHaveLength(2);
  });
  it('rejects wrong source network', async () => {
    await expect(reader(tx, utxo, 'main').service.verify(`${txid}:0`)).rejects.toMatchObject({ code: 'wrong-network' });
  });
  it('rejects inconsistent checkpoints', async () => {
    await expect(reader(tx, { ...utxo, bestblock: '33'.repeat(32) }).service.verify(`${txid}:0`)).rejects.toMatchObject({ code: 'source-changed' });
  });
});
