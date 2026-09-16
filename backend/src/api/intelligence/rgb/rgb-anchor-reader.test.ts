import { Transaction } from 'bitcoinjs-lib';
import { RgbAnchorReader } from './rgb-anchor-reader';
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
const tx = new Transaction(); tx.addInput(Buffer.alloc(32, 1), 0); tx.addOutput(Buffer.from('51','hex'),1000);
const id = tx.getId(), hash = '22'.repeat(32);
function reader(overrides: Record<string, any> = {}) {
  let tips = 0;
  const call = jest.fn(async (method: string) => {
    if (method in overrides) return typeof overrides[method] === 'function' ? overrides[method]() : overrides[method];
    if (method === 'getblockchaininfo') { tips++; return {chain:'signet',blocks:100,bestblockhash:hash}; }
    if (method === 'getrawtransaction') return {txid:id,hex:tx.toHex(),confirmations:5,blockhash:hash};
    if (method === 'getblockheader') return {hash,height:96,time:1700000000,confirmations:5};
    if (method === 'getblockhash') return hash;
    throw Error('Unexpected call');
  });
  return {service:new RgbAnchorReader({network:'signet',call}),call};
}
describe('RGB public anchor resolver', () => {
 it('binds actual bytes to an active-chain mined block', async()=>{expect(await reader().service.read([id])).toMatchObject({witnesses:{[id]:{raw_tx:tx.toHex(),height:96,timestamp:1700000000}},unresolved:[],source:{network:'signet'}});});
 it('keeps missing transactions unresolved',async()=>{expect(await reader({getrawtransaction:()=>{throw {code:-5};}}).service.read([id])).toMatchObject({witnesses:{},unresolved:[id]});});
 it.each([[],[id,id],['x'],Array(17).fill(id)].map(input => ({input})))('rejects invalid public ID batches',async ({input})=>{const r=reader();await expect(r.service.read(input)).rejects.toMatchObject({status:400});expect(r.call).not.toHaveBeenCalled();});
 it('rejects unrelated returned bytes',async()=>{await expect(reader({getrawtransaction:{txid:id,hex:'00'}}).service.read([id])).rejects.toMatchObject({status:503});});
 it('rejects side-chain anchor block',async()=>{await expect(reader({getblockhash:'33'.repeat(32)}).service.read([id])).rejects.toMatchObject({status:503});});
 it('rejects source network mismatch',async()=>{await expect(reader({getblockchaininfo:{chain:'main',blocks:100,bestblockhash:hash}}).service.read([id])).rejects.toMatchObject({status:503});});
 it('rejects a changing checkpoint',async()=>{let n=0;await expect(reader({getblockchaininfo:()=>({chain:'signet',blocks:100,bestblockhash:++n===1?hash:'33'.repeat(32)})}).service.read([id])).rejects.toMatchObject({status:503});});
});
