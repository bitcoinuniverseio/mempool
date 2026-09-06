jest.mock('../../../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'signet' }, DATABASE: { ENABLED: true } } }));
jest.mock('../../../database', () => ({ __esModule: true, default: { query: jest.fn(), $atomicQuery: jest.fn() } }));
jest.mock('../../blocks', () => ({ __esModule: true, default: { setNewBlockCallback: jest.fn() } }));
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $getBlockHash: jest.fn(), $getBlockHeightTip: jest.fn(), $getBlock: jest.fn(), $getTxsForBlock: jest.fn() } }));
jest.mock('../../bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getBlockchainInfo: jest.fn(), getBlockHash: jest.fn() } }));

import DB from '../../../database';
import blocks from '../../blocks';
import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import { SilentPaymentsService } from './silent-payments.service';
import routes from './silent-payments.routes';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const sourceBlocks = new Map<number, any>();
const records = new Map<number, any>();
const makeBlock = (height: number, id = height) => ({ height, id: hash(id), previousblockhash: hash(height - 1), tx_count: 0, timestamp: 1700000000 + height });

beforeEach(() => {
  jest.clearAllMocks(); sourceBlocks.clear(); records.clear();
  for (const n of [11,12,13]) {sourceBlocks.set(n,makeBlock(n));}
  (bitcoinClient.getBlockchainInfo as jest.Mock).mockResolvedValue({chain:'signet'});
  (bitcoinClient.getBlockHash as jest.Mock).mockImplementation(/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async n=>hash(n));
  (bitcoinApi.$getBlockHash as jest.Mock).mockImplementation(/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async n=>n===0?hash(0):sourceBlocks.get(n)?.id);
  (bitcoinApi.$getBlockHeightTip as jest.Mock).mockResolvedValue(13);
  (bitcoinApi.$getBlock as jest.Mock).mockImplementation(/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async id=>[...sourceBlocks.values()].find(b=>b.id===id));
  (bitcoinApi.$getTxsForBlock as jest.Mock).mockResolvedValue([]);
  (DB.query as jest.Mock).mockImplementation(/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async (sql:string,params:any[]=[])=> {
    const rows=[...records.values()].sort((a,b)=>b.height-a.height);
    if (sql.startsWith('CREATE') || sql.includes('intelligence_silent_payment_support')) {return [[],[]];}
    if (sql.startsWith('DELETE')) { for(const n of records.keys()) {if(n>=params[2]) {records.delete(n);}} return [[],[]]; }
    if (sql.includes('COUNT(*)')) {return [[{blocks:records.size,candidates:0}],[]];}
    if (sql.includes('AND height = ?')) {return [[...rows.filter(r=>r.height===params[2])],[]];}
    if (sql.includes('LIMIT 1') && !sql.includes('LIMIT 10')) {return [rows.slice(0,1),[]];}
    return [rows,[]];
  });
  (DB.$atomicQuery as jest.Mock).mockImplementation(/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async queries=> {
    const [chain,network,height,id,previous,bundleHash,manifest,bytes]=queries[1].params;
    const next=new Map(records);
    for(const n of next.keys()) {if(n>height) {next.delete(n);}}
    next.set(height,{height,manifest_json:manifest,bundle_json:bytes});
    records.clear();for(const [n,row] of next) {records.set(n,row);}
    return [];
  });
});

describe('durable shared-block consumer (controlled transactional storage)',()=>{
  it('registers one callback, replays idempotently, and reads the same persisted checkpoint after restart',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const service=new SilentPaymentsService();service.start();service.start();
    expect(blocks.setNewBlockCallback).toHaveBeenCalledTimes(1);
    const callback=(blocks.setNewBlockCallback as jest.Mock).mock.calls[0][0];
    callback(sourceBlocks.get(12),[],[]);await (service as any).queue;
    const first=await service.getBlockManifest(12,'signet');
    callback(sourceBlocks.get(12),[],[]);await (service as any).queue;
    expect(records.size).toBe(1);expect(DB.$atomicQuery).toHaveBeenCalledTimes(1);
    const restarted=new SilentPaymentsService();
    expect(await restarted.getBlockManifest(12,'signet')).toEqual(first);
    expect((await restarted.getCoverageOverview('signet')).status).toBe('stale');
  });
  it('does not advance an interrupted transaction and succeeds on replay',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const service=new SilentPaymentsService();
    (DB.$atomicQuery as jest.Mock).mockRejectedValueOnce(new Error('injected transaction interruption'));
    await expect(service.ingestBlock('signet',sourceBlocks.get(12),[])).rejects.toThrow('interruption');
    expect(records.size).toBe(0);
    await service.ingestBlock('signet',sourceBlocks.get(12),[]);
    expect((await service.getBlockManifest(12,'signet'))?.block_hash).toBe(hash(12));
  });
  it('preserves newer active checkpoints when an earlier shared block is replayed',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const service=new SilentPaymentsService();
    await service.ingestBlock('signet',sourceBlocks.get(12),[]);
    await service.ingestBlock('signet',sourceBlocks.get(13),[]);
    await (service as any).reconcileAndIngest(sourceBlocks.get(12),[]);
    expect(records.size).toBe(2);
    expect((await service.getCoverageOverview('signet')).latest_indexed_height).toBe(13);
    expect(DB.$atomicQuery).toHaveBeenCalledTimes(2);
  });
  it('invalidates a displaced suffix, resumes from common ancestor and refuses displaced reads',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const service=new SilentPaymentsService();
    await service.ingestBlock('signet',sourceBlocks.get(11),[]);
    await service.ingestBlock('signet',sourceBlocks.get(12),[]);
    const replacement=makeBlock(12,120);sourceBlocks.set(12,replacement);
    await expect(service.getBlockBundle(12,'signet')).rejects.toThrow('displaced');
    await (service as any).reconcileAndIngest(replacement,[]);
    expect(records.size).toBe(2);
    expect((await service.getBlockManifest(12,'signet'))?.block_hash).toBe(hash(120));
  });
  it('distinguishes unavailable network, missing height, no persisted coverage and source disagreement',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const service=new SilentPaymentsService();
    expect(await service.getBlockManifest(12,'signet')).toBeNull();
    expect(await service.getCoverageOverview('signet')).toMatchObject({status:'empty',latest_indexed_height:null,total_indexed_blocks:0,total_sp_outputs_detected:null});
    await expect(service.getBlockManifest(12,'mainnet')).rejects.toThrow('No first-party');
    (bitcoinClient.getBlockchainInfo as jest.Mock).mockResolvedValue({chain:'main'});
    expect(await service.getCoverageOverview('signet')).toMatchObject({status:'unavailable',total_indexed_blocks:null});
  });
  it('detects corrupted stored bytes rather than serving an apparently valid manifest',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const service=new SilentPaymentsService();await service.ingestBlock('signet',sourceBlocks.get(12),[]);
    records.get(12).bundle_json+=' ';
    await expect(service.getBlockManifest(12,'signet')).rejects.toThrow('integrity');
  });
  it('requires explicit capability booleans and complete public support evidence',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const service=new SilentPaymentsService();await service.getSupportRegistry();
    const claim={wallet_id:'controlled-fixture',name:'Controlled test fixture',verified_version:'1.0.0',updated_at:'2026-09-05T00:00:00Z',status:'documented',evidence_url:'https://example.org/evidence',send_supported:false,receive_supported:false,bip352_compliance:false,bip375_send_psbt:false,bip376_spend_psbt:false};
    for (const invalid of [{...claim,send_supported:'true'},{...claim,name:''},{...claim,evidence_url:'https://'}]) {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{claim_json:JSON.stringify(invalid)}],[]]);
      await expect(service.getSupportRegistry()).rejects.toThrow('support evidence');
    }
    (DB.query as jest.Mock).mockResolvedValueOnce([[{claim_json:JSON.stringify(claim)}],[]]);
    expect(await service.getSupportRegistry()).toEqual([claim]);
  });
});

describe('actual registered route handlers (without a server)',()=>{
  const handlers = new Map<string, any>();
  const invoke=/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async(path:string,body:any,query:any={chain:'bitcoin',network:'signet'},params:any={})=>{
    const res:any={status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis(),set:jest.fn().mockReturnThis(),type:jest.fn().mockReturnThis(),send:jest.fn().mockReturnThis()};
    await handlers.get(path)({body,query,params},res);return res;
  };
  beforeEach(()=>{
    const app:any={get:(path,handler)=>{handlers.set(path,handler);return app;},post:(path,handler)=>{handlers.set(path,handler);return app;}};
    routes.initRoutes(app);
  });
  it('rejects original malformed counterexamples through registered POST handlers',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    for(const psbt of ['cHNidFg=','cHNidP8=',null]) {
      const response=await invoke('/api/v1/intelligence/payments/silent/validate-psbt',{psbt});
      expect(response.status).toHaveBeenCalledWith(400);expect(response.json).toHaveBeenCalledWith(expect.objectContaining({valid:false,bip375_present:false}));
    }
    const response=await invoke('/api/v1/intelligence/payments/silent/validate-address',{address:'sp1q'+'!'.repeat(113)});
    expect(response.status).toHaveBeenCalledWith(400);
  });
  it('decodes BIP321 input through the original registered address handler',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const address='sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv';
    const response=await invoke('/api/v1/intelligence/payments/silent/validate-address',{address:`bitcoin:?sp=${address}`},{chain:'bitcoin',network:'mainnet'});
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({valid:true,input_format:'bip321',network:'mainnet'}));
  });
  it('rejects partial context and loosely parsed heights',/** @asyncUnsafe Jest awaits these promises and owns their failures. */ async()=>{
    const partial=await invoke('/api/v1/intelligence/payments/silent/validate-psbt',{}, {network:'signet'});
    expect(partial.status).toHaveBeenCalledWith(400);
    for(const height of ['12x','-1','1.5','4294967296']) {
      const response=await invoke('/api/v1/intelligence/payments/silent/blocks/:height/manifest',{},undefined,{height});
      expect(response.status).toHaveBeenCalledWith(400);
    }
  });
});
