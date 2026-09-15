import { Transaction } from 'bitcoinjs-lib';
import { BitcoinCorePolicyAdapter, bitcoinCorePolicyAdapter } from './bitcoin-core-policy-adapter';
import { InclusionForecaster } from './inclusion-forecast';
import { policyLabService } from './policy-lab.service';
import routes from './policy-lab.routes';
import mempool from '../../mempool';
import { createHash } from 'crypto';
jest.mock('../../mempool',()=>({__esModule:true,default:{isInSync:jest.fn(),getMempool:jest.fn()}}));
jest.mock('../../backend-info',()=>({}));jest.mock('rust-gbt',()=>({GbtGenerator:jest.fn()}));
const genesis='000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',tip='ab'.repeat(32);
function transaction(witness=false){const tx=new Transaction();tx.version=2;tx.addInput(Buffer.alloc(32,1),0);tx.addOutput(Buffer.from('51','hex'),9000);if(witness)tx.setWitness(0,[Buffer.from('0102','hex')]);return tx;}
const hash=(tx:Transaction)=>createHash('sha256').update(createHash('sha256').update(tx.toBuffer()).digest()).digest().reverse().toString('hex');
function reader(tx=transaction(true)){return {network:'mainnet',call:jest.fn(async(method:string,params:unknown[]):Promise<any>=>{
 if(method==='getblockchaininfo')return {chain:'main',blocks:10,bestblockhash:tip};if(method==='getblockhash')return params[0]===0?genesis:tip;
 if(method==='getnetworkinfo')return {version:290000,subversion:'/Satoshi:29.0.0/',relayfee:0.00001};if(method==='getmempoolinfo')return {loaded:true,fullrbf:true,maxmempool:300000000};
 if(method==='testmempoolaccept')return [{txid:tx.getId(),wtxid:hash(tx),allowed:true,vsize:tx.virtualSize(),fees:{base:0.00001}}];throw new Error('unexpected');
 })};}
afterEach(()=>jest.restoreAllMocks());
describe('owned policy evidence',()=>{
 it('uses exact witness txid/weight/fee and actual node identity with unknown unreported capabilities',async()=>{
  const tx=transaction(true),core=reader(tx),report=await new BitcoinCorePolicyAdapter(core).evaluatePackage([tx.toHex()]);
  expect(report.members[0]).toMatchObject({txid:tx.getId(),wtxid:hash(tx),weight:tx.weight(),vsize:tx.virtualSize(),fee_sats:1000,allowed:true,consensus_valid:null});
  expect(report.node_profile).toMatchObject({node_version:'290000',supports_truc_v3:null,max_ancestor_count:null,genesis});
  expect(core.call.mock.calls.every(([method])=>!['sendrawtransaction','submitpackage'].includes(method))).toBe(true);
 });
 it.each(['no-response','foreign-id','wrong-witness','missing-fees','contradiction'])('refuses incomplete or mismatched native evidence: %s',async mode=>{
  const tx=transaction(true),core=reader(tx),original=core.call.getMockImplementation()!;
  core.call.mockImplementation(async(method,params)=>{if(method!=='testmempoolaccept')return original(method,params);if(mode==='no-response')return [];const row=(await original(method,params))[0];if(mode==='foreign-id')row.txid='ff'.repeat(32);if(mode==='wrong-witness')row.wtxid='ff'.repeat(32);if(mode==='missing-fees')delete row.fees;if(mode==='contradiction')row['reject-reason']='missing-inputs';return [row];});
  await expect(new BitcoinCorePolicyAdapter(core).evaluatePackage([tx.toHex()])).rejects.toMatchObject({status:503});
 });
 it('preserves actual rejection and unknown fees without deriving consensus invalidity',async()=>{
  const tx=transaction(),core=reader(tx),original=core.call.getMockImplementation()!;core.call.mockImplementation(async(m,p)=>m==='testmempoolaccept'?[{txid:tx.getId(),allowed:false,'reject-reason':'missing-inputs'}]:original(m,p));
  const report=await new BitcoinCorePolicyAdapter(core).evaluatePackage([tx.toHex()]);expect(report).toMatchObject({overall_allowed:false,total_fees_sats:null,package_feerate_sats_vb:null});expect(report.members[0].consensus_valid).toBeNull();
 });
 it('fails closed on node outage or wrong genesis instead of fabricating a profile',async()=>{
  const core=reader();core.call.mockRejectedValue(new Error('private-source'));await expect(new BitcoinCorePolicyAdapter(core).getEffectivePolicyProfile()).rejects.toMatchObject({status:503});
  const wrong=reader(),original=wrong.call.getMockImplementation()!;wrong.call.mockImplementation((m,p)=>m==='getblockhash'?Promise.resolve('ff'.repeat(32)):original(m,p));await expect(new BitcoinCorePolicyAdapter(wrong).getEffectivePolicyProfile()).rejects.toMatchObject({status:503});
 });
 it('rejects malformed and duplicate package bytes before any RPC',async()=>{const core=reader(),adapter=new BitcoinCorePolicyAdapter(core);for(const input of [['zz'],['01020304'],[transaction().toHex(),transaction().toHex()]])await expect(adapter.evaluatePackage(input)).rejects.toMatchObject({status:400});expect(core.call).not.toHaveBeenCalled();});
});
describe('honest queue calculation',()=>{
 beforeEach(()=>{jest.spyOn(mempool,'isInSync').mockReturnValue(true);jest.spyOn(mempool,'getMempool').mockReturnValue({} as any);});
 it('has no invented calibration metrics or version fallback',()=>{expect(InclusionForecaster.getModelCard()).toMatchObject({training_coverage:null,last_calibrated_at:null,evaluation_metrics:{brier_score:null,sample_size:null,validation_status:'not-calibrated'}});expect(()=>InclusionForecaster.getModelCard('v1.4-hazard-survival')).toThrow(expect.objectContaining({status:404}));});
 it('computes only observed queue size and leaves probabilities/confidence unknown',()=>{jest.mocked(mempool.getMempool).mockReturnValue({a:{feePerVsize:20,vsize:300},b:{feePerVsize:1,vsize:100}} as any);const result=InclusionForecaster.calculateForecast(5,5,100);expect(result).toMatchObject({observed_vsize_ahead:300,queue_capacity_blocks:0.0004,next_block:null,confidence_interval:null,observed_transactions:2});});
 it('distinguishes synchronized empty snapshot from source failure and malformed source',()=>{expect(InclusionForecaster.calculateForecast(5)).toMatchObject({observed_transactions:0,observed_vsize_ahead:0});jest.mocked(mempool.isInSync).mockReturnValue(false);expect(()=>InclusionForecaster.calculateForecast(5)).toThrow(expect.objectContaining({status:503}));jest.mocked(mempool.isInSync).mockReturnValue(true);jest.mocked(mempool.getMempool).mockReturnValue({x:{feePerVsize:NaN,vsize:10}} as any);expect(()=>InclusionForecaster.calculateForecast(5)).toThrow(expect.objectContaining({status:503}));});
 it('does not forecast arbitrary nonexistent transactions or malformed IDs',()=>{expect(()=>policyLabService.getForecastForTxid('ff'.repeat(32))).toThrow(expect.objectContaining({status:404,code:'not-in-observed-mempool'}));expect(()=>policyLabService.getForecastForTxid('bad')).toThrow(expect.objectContaining({status:400}));});
 it('preserves unavailable fallback as unknown, never made-up probabilities',()=>{expect(InclusionForecaster.empiricalFallback(10)).toMatchObject({next_block:null,queue_capacity_blocks:null});});
 it('keeps owned policy evidence when the forecast snapshot is unavailable',async()=>{const tx=transaction(),report=await new BitcoinCorePolicyAdapter(reader(tx)).evaluatePackage([tx.toHex()]);jest.spyOn(bitcoinCorePolicyAdapter,'evaluatePackage').mockResolvedValue(report);jest.mocked(mempool.isInSync).mockReturnValue(false);const result=await policyLabService.evaluateTransactionOrPackage([tx.toHex()]);expect(result.package_report.overall_allowed).toBe(true);expect(result.forecast.next_block).toBeNull();expect(result.forecast.unavailable_reason).toContain('unavailable');});
 it('binds versioned route and returns typed unsupported-version response',async()=>{const handlers=new Map<string,any>();const app:any={post:(p:string,h:any)=>{handlers.set(p,h);return app;},get:(p:string,h:any)=>{handlers.set(p,h);return app;}};routes.initRoutes(app);const res:any={status:jest.fn().mockReturnThis(),json:jest.fn()};await handlers.get('/api/v1/intelligence/forecasts/models/:version/card')({params:{version:'unknown'}},res);expect(res.status).toHaveBeenCalledWith(404);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({stage:'unknown-model-version'}));});
});
