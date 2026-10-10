jest.mock('../api/websocket-handler', () => ({}));
jest.mock('../api/fee-api', () => ({}));
jest.mock('../api/mempool-blocks', () => ({}));
jest.mock('../api/mempool', () => ({ getMempool: () => ({}), getFirstSeenForTransactions: jest.fn(() => []) }));
jest.mock('../api/rbf-cache', () => ({}));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $testMempoolAccept: jest.fn(), $getAddress: jest.fn(), $getAddressTransactions: jest.fn(), $getBlockHash: jest.fn(), $getTxIdsForBlock: jest.fn(), $getScriptHash: jest.fn(), $getAddressTransactionSummary: jest.fn(), $getScriptHashTransactionSummary: jest.fn() }, bitcoinCoreApi: {} }));
jest.mock('../api/common', () => ({ Common: { indexingEnabled: () => true, getTransactionsFromRequest: req => req.body } }));
jest.mock('../api/backend-info', () => ({}));
jest.mock('../api/transaction-utils', () => ({ $getTransactionExtended: jest.fn(), convertScriptSigAsm: () => '', translateScriptPubKeyType: () => 'unknown' }));
jest.mock('../api/loading-indicators', () => ({ setProgress: jest.fn() }));
jest.mock('../api/blocks', () => ({ $getBlocksBetweenHeight: jest.fn(async () => []) }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ submitPackage: jest.fn(), rpc: { call: jest.fn() }, getTxOut: jest.fn(), getBlockCount: jest.fn(), getBlockHash: jest.fn(), getRawTransaction: jest.fn(), getBlock: jest.fn() }));
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

test('mounted fee queries preserve absent defaults and explicit zero without NaN/null', async () => {
 const post = (path: string) => fetch(origin + path, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(['00'])});
 (api.$testMempoolAccept as jest.Mock).mockResolvedValue([]); (client.submitPackage as jest.Mock).mockResolvedValue({package_msg:'controlled'}); (client.rpc.call as jest.Mock).mockResolvedValue({package_msg:'controlled'});
 expect((await post('txs/test')).status).toBe(200); expect(api.$testMempoolAccept).toHaveBeenLastCalledWith(['00'],undefined);
 expect((await post('txs/test?maxfeerate=0')).status).toBe(200); expect(api.$testMempoolAccept).toHaveBeenLastCalledWith(['00'],0);
 expect((await post('txs/test?maxfeerate=1e-5')).status).toBe(200); expect(api.$testMempoolAccept).toHaveBeenLastCalledWith(['00'],0.00001);
 expect((await post('txs/package')).status).toBe(200); expect(client.submitPackage).toHaveBeenLastCalledWith(['00']);
 expect((await post('txs/package?maxfeerate=0')).status).toBe(200); expect(client.submitPackage).toHaveBeenLastCalledWith(['00'],0);
 expect((await post('txs/package?maxburnamount=0')).status).toBe(200); expect(client.rpc.call).toHaveBeenLastCalledWith('submitpackage',{package:['00'],maxburnamount:0});
});
test.each(['NaN','Infinity','-1','1abc','0.1abc','1.000000001','1e999','0.000000001','0%26maxfeerate=0'])('rejects invalid or repeated fee %s before any mounted source call', async value => {
 const post = (path: string) => fetch(origin + path, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(['00'])});
 const query = value==='0%26maxfeerate=0'?'0&maxfeerate=0':encodeURIComponent(value);
 expect((await post('txs/test?maxfeerate='+query)).status).toBe(400); expect((await post('txs/package?maxfeerate='+query)).status).toBe(400);
 expect(api.$testMempoolAccept).not.toHaveBeenCalled(); expect(client.submitPackage).not.toHaveBeenCalled(); expect(client.rpc.call).not.toHaveBeenCalled();
});
test.each(['','-1','Infinity','21000001','0.000000001','0&maxburnamount=1'])('rejects invalid or repeated burn bound %s before source', async value => {
 const response=await fetch(origin+'txs/package?maxburnamount='+value,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(['00'])});
 expect(response.status).toBe(400); expect(client.submitPackage).not.toHaveBeenCalled(); expect(client.rpc.call).not.toHaveBeenCalled();
});

test('summary routes mount in supported Esplora mode and deliver both validated cursor forms', /** @asyncUnsafe */ async () => {
 const previous=config.MEMPOOL.BACKEND; config.MEMPOOL.BACKEND='esplora';
 const app=express(); routes.initRoutes(app); const supported=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>supported.once('listening',resolve));
 const base='http://127.0.0.1:'+(supported.address() as any).port+config.MEMPOOL.API_URL_PREFIX;
 const summary=[{txid:id,value:-1,height:1,time:0}];
 (api.$getAddressTransactionSummary as jest.Mock).mockResolvedValue(summary);
 (api.$getScriptHashTransactionSummary as jest.Mock).mockResolvedValue(summary);
 try {
  for(const kind of ['address','scripthash']) {
   for(const cursor of ['', '?after_txid='+id,'/'+id]) {
    const response=await fetch(base+kind+'/'+id+'/txs/summary'+cursor);
    expect(response.status).toBe(200);expect(await response.json()).toEqual(summary);
   }
   expect((await fetch(base+kind+'/'+id+'/txs/summary?after_txid=bad')).status).toBe(400);
   expect((await fetch(base+kind+'/'+id+'/txs/summary/'+id+'?after_txid='+ 'cd'.repeat(32))).status).toBe(400);
  }
  expect(api.$getAddressTransactionSummary).toHaveBeenCalledTimes(3);
  expect(api.$getAddressTransactionSummary).toHaveBeenCalledWith(id,undefined);
  expect(api.$getAddressTransactionSummary).toHaveBeenCalledWith(id,id);
  expect(api.$getScriptHashTransactionSummary).toHaveBeenCalledTimes(3);
  expect(api.$getScriptHashTransactionSummary).toHaveBeenCalledWith(id,undefined);
  expect(api.$getScriptHashTransactionSummary).toHaveBeenCalledWith(id,id);
 } finally {config.MEMPOOL.BACKEND=previous;await new Promise<void>(resolve=>supported.close(()=>resolve()));}
});
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
test('transaction-times without a txId list is a client error, not a server failure',async()=>{
 for(const query of ['','?txId=abc','?txId[]=']) {
  const response=await fetch(origin+'transaction-times'+query,{headers:{accept:'application/json'}});
  if(query==='?txId[]=') { expect(response.status).toBe(200); continue; }
  expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'invalid txId format'});
 }
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

test('mounted address readers receive cancellable signals and release ordinary responses', async () => {
 (api.$getAddress as jest.Mock).mockResolvedValue({address:'tb1pqualification'});
 (api.$getAddressTransactions as jest.Mock).mockResolvedValue([]);
 expect((await fetch(origin+'address/tb1pqualification')).status).toBe(200);
 expect((api.$getAddress as jest.Mock).mock.calls[0][1]).toBeInstanceOf(AbortSignal);
 expect((await fetch(origin+'address/tb1pqualification/txs?after_txid='+id)).status).toBe(200);
 expect(api.$getAddressTransactions).toHaveBeenCalledWith('tb1pqualification',id,expect.any(AbortSignal));
});
test('mounted address reader aborts on caller disconnect and permits a fresh request', async () => {
 let resolveStarted: () => void, resolveCancelled: () => void;
 const started=new Promise<void>(resolve=>resolveStarted=resolve), cancelled=new Promise<void>(resolve=>resolveCancelled=resolve);
 (api.$getAddress as jest.Mock).mockImplementation((_address:string,signal:AbortSignal)=>new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>{resolveCancelled();reject(Object.assign(new Error('cancelled'),{code:'ETIMEDOUT'}));},{once:true});resolveStarted();
 }));
 const controller=new AbortController(), pending=fetch(origin+'address/tb1pqualification',{signal:controller.signal});
 const pendingResult=pending.catch(error=>error);
 await started;controller.abort();expect((await pendingResult).name).toBe('AbortError');await cancelled;
 (api.$getAddress as jest.Mock).mockResolvedValue({address:'tb1pqualification'});
 expect((await fetch(origin+'address/tb1pqualification')).status).toBe(200);
});
