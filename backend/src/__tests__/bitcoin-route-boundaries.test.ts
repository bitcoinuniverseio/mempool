jest.mock('../api/websocket-handler', () => ({}));
jest.mock('../api/fee-api', () => ({}));
jest.mock('../api/mempool-blocks', () => ({}));
jest.mock('../api/mempool', () => ({ getMempool: () => ({}) }));
jest.mock('../api/rbf-cache', () => ({}));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $getBlockHash: jest.fn(), $getTxIdsForBlock: jest.fn(), $getScriptHash: jest.fn() }, bitcoinCoreApi: {} }));
jest.mock('../api/common', () => ({ Common: { indexingEnabled: () => true } }));
jest.mock('../api/backend-info', () => ({}));
jest.mock('../api/transaction-utils', () => ({ $getTransactionExtended: jest.fn(), convertScriptSigAsm: () => '', translateScriptPubKeyType: () => 'unknown' }));
jest.mock('../api/loading-indicators', () => ({ setProgress: jest.fn() }));
jest.mock('../api/blocks', () => ({ $getBlocksBetweenHeight: jest.fn(async () => []) }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ getTxOut: jest.fn(), getBlockCount: jest.fn(), getBlockHash: jest.fn(), getRawTransaction: jest.fn(), getBlock: jest.fn() }));
jest.mock('../api/difficulty-adjustment', () => ({}));
jest.mock('../repositories/TransactionRepository', () => ({}));
jest.mock('../api/cpfp', () => ({}));
jest.mock('../tasks/pools-updater', () => ({}));
jest.mock('../api/chain-tips', () => ({}));
import express from 'express';
import http from 'http';
import routes from '../api/bitcoin/bitcoin.routes';
import coreRoutes from '../api/bitcoin/bitcoin-core.routes';
import config from '../config';
import client from '../api/bitcoin/bitcoin-client';
import api from '../api/bitcoin/bitcoin-api-factory';
import transactionUtils from '../api/transaction-utils';
const id = 'ab'.repeat(32);
let server: http.Server, origin: string;
const oldBackend=config.MEMPOOL.BACKEND, oldBulk=config.MEMPOOL.MAX_BLOCKS_BULK_QUERY;
beforeAll(async () => {
 config.MEMPOOL.BACKEND='electrum'; config.MEMPOOL.MAX_BLOCKS_BULK_QUERY=100;
 const app=express(); app.use(express.json()); routes.initRoutes(app); coreRoutes.initRoutes(app);
 server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
 origin='http://127.0.0.1:'+(server.address() as any).port+config.MEMPOOL.API_URL_PREFIX;
});
afterAll(async()=>{config.MEMPOOL.BACKEND=oldBackend;config.MEMPOOL.MAX_BLOCKS_BULK_QUERY=oldBulk;await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>jest.clearAllMocks());
test.each(['NaN','1abc','1.5','-1','9007199254740992'])('rejects malformed numeric path %s before source',async value=>{
 for(const path of ['block-height/'+value,'blocks/'+value,'blocks-bulk/'+value+'/10','block/'+id+'/txs/'+value,'internal/bitcoin-core/get-block-hash?height='+value]) expect((await fetch(origin+path)).status).toBe(400);
 expect(api.$getBlockHash).not.toHaveBeenCalled();expect(client.getBlockHash).not.toHaveBeenCalled();
});
test('rejects invalid Core verbosity before RPC',async()=>{
 expect((await fetch(origin+'internal/bitcoin-core/get-raw-transaction?txid='+id+'&verbose=1x')).status).toBe(400);
 expect((await fetch(origin+'internal/bitcoin-core/get-block?hash='+id+'&verbosity=NaN')).status).toBe(400);
 expect(client.getBlock).not.toHaveBeenCalled();expect(client.getRawTransaction).not.toHaveBeenCalled();
});
test('height zero is a valid Core result and lookup',async()=>{
 (client.getBlockCount as jest.Mock).mockResolvedValue(0);(api.$getBlockHash as jest.Mock).mockResolvedValue(id);
 const count=await fetch(origin+'internal/bitcoin-core/get-block-count');expect(count.status).toBe(200);expect(await count.text()).toBe('0');
 expect((await fetch(origin+'block-height/0')).status).toBe(200);expect(api.$getBlockHash).toHaveBeenCalledWith(0);
});
test('scripthashes require exactly32bytes',async()=>{
 expect((await fetch(origin+'scripthash/ab')).status).toBe(400);expect(api.$getScriptHash).not.toHaveBeenCalled();
});
test.each([-1,0.5,4294967296])('prevout index %s rejects before RPC',async vout=>{
 const response=await fetch(origin+'prevouts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([{txid:id,vout}])});
 expect(response.status).toBe(400);expect(client.getTxOut).not.toHaveBeenCalled();
});
test('distinguishes known null prevout from unavailable RPC',async()=>{
 const request=()=>fetch(origin+'prevouts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([{txid:id,vout:0}])});
 (client.getTxOut as jest.Mock).mockResolvedValue(null);const absent=await request();expect(absent.status).toBe(200);expect(await absent.json()).toEqual([null]);
 (client.getTxOut as jest.Mock).mockRejectedValue(Error('connection refused'));const unavailable=await request();expect(unavailable.status).toBe(503);
});
test('block pages never silently omit failed transactions and preserve genuine notfound',async()=>{
 (api.$getTxIdsForBlock as jest.Mock).mockResolvedValue([id,'cd'.repeat(32)]);
 (transactionUtils.$getTransactionExtended as jest.Mock).mockResolvedValueOnce({txid:id}).mockRejectedValueOnce(Error('timeout'));
 expect((await fetch(origin+'block/'+id+'/txs')).status).toBe(503);
 (api.$getTxIdsForBlock as jest.Mock).mockRejectedValue({code:-5,message:'Block not found'});
 expect((await fetch(origin+'block/'+id+'/txs')).status).toBe(404);
});
