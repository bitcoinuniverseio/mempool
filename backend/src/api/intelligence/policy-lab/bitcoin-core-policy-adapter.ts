import { createHash } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';
import config from '../../../config';
import { ownedWorkbenchCore, WorkbenchCoreReader } from '../workbench/workbench-core';
import { PolicyEvidenceError } from './inclusion-forecast';
const GENESIS: Record<string,string> = {mainnet:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',testnet:'000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',testnet4:'00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',signet:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',regtest:'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'};
export interface NodePolicyProfile {
  id:string;network:string;node_version:string;subversion:string;full_rbf:boolean|null;incremental_relay_fee_sats_vb:number|null;min_relay_tx_fee_sats_vb:number|null;max_mempool_mb:number|null;
  max_ancestor_count:null;max_ancestor_size_vbytes:null;max_descendant_count:null;max_descendant_size_vbytes:null;supports_truc_v3:null;supports_ephemeral_anchors:null;supports_package_relay:null;
  probed_at:string;genesis:string;checkpoint:{height:number;hash:string};scope:string;
}
export interface MemberPolicyVerdict {
  txid:string;wtxid:string;allowed:boolean|null;reject_code:string|null;reject_reason:string|null;consensus_valid:null;relay_valid:boolean|null;package_valid:boolean|null;
  fee_sats:number|null;vsize:number;weight:number;effective_feerate:number|null;ancestor_count:null;ancestor_vsize:null;descendant_count:null;descendant_vsize:null;
  conflicting_txids:null;is_rbf_replacement:null;replaces_txids:null;
}
export interface PackageAnalysisReport {
  package_id:string;input_hash:string;network:string;node_profile:NodePolicyProfile;overall_allowed:boolean|null;package_feerate_sats_vb:number|null;total_fees_sats:number|null;total_vsize:number;total_weight:number;
  members:MemberPolicyVerdict[];topology:{parent_txid:string;child_txid:string}[];truc_v3_evaluation:{compliant:null;violating_rules:string[]};divergences:[];scope:string;
}
let activeCalls=0;
export class BitcoinCorePolicyAdapter {
  constructor(private readonly core:WorkbenchCoreReader=ownedWorkbenchCore){}
  private async call(method:string,params:unknown[]):Promise<any>{
    if(activeCalls>=8) throw new PolicyEvidenceError('unavailable-policy-source','Owned policy reader capacity is exhausted.');
    activeCalls++;let timer:NodeJS.Timeout|undefined;
    const work=Promise.resolve().then(()=>this.core.call(method,params)).finally(()=>activeCalls--);
    try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error()),5000);timer.unref?.();})]);}
    catch{throw new PolicyEvidenceError('unavailable-policy-source','Owned Bitcoin Core policy evidence is unavailable.');}
    finally{if(timer)clearTimeout(timer);}
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getEffectivePolicyProfile():Promise<NodePolicyProfile>{
    const chain=await this.call('getblockchaininfo',[]),network=this.core.network;
    const expectedChain=network==='mainnet'?'main':network==='testnet'?'test':network;
    if(!GENESIS[network]||chain?.chain!==expectedChain||!Number.isSafeInteger(chain.blocks)||chain.blocks<0||typeof chain.bestblockhash!=='string'||!/^[0-9a-f]{64}$/.test(chain.bestblockhash))throw new PolicyEvidenceError('unavailable-policy-source','Owned node chain context is invalid.');
    const genesis=await this.call('getblockhash',[0]);if(genesis!==GENESIS[network])throw new PolicyEvidenceError('unavailable-policy-source','Owned node genesis does not match the selected network.');
    const net=await this.call('getnetworkinfo',[]),mem=await this.call('getmempoolinfo',[]);
    if(!net||!Number.isSafeInteger(net.version)||net.version<=0||typeof net.subversion!=='string'||net.subversion.length>256||!mem||typeof mem.loaded!=='boolean'||!mem.loaded)throw new PolicyEvidenceError('unavailable-policy-source','Owned node profile or loaded mempool evidence is incomplete.');
    if(await this.call('getblockhash',[chain.blocks])!==chain.bestblockhash)throw new PolicyEvidenceError('unavailable-policy-source','The active chain changed during the policy profile read.');
    const fee=(x:unknown):number|null=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x*100000:null;
    return {id:'profile-'+network+'-'+net.version,network,node_version:String(net.version),subversion:net.subversion,full_rbf:typeof mem.fullrbf==='boolean'?mem.fullrbf:null,
      incremental_relay_fee_sats_vb:fee(mem.incrementalrelayfee),min_relay_tx_fee_sats_vb:fee(mem.minrelaytxfee??net.relayfee),max_mempool_mb:Number.isSafeInteger(mem.maxmempool)&&mem.maxmempool>0?mem.maxmempool/(1024*1024):null,
      max_ancestor_count:null,max_ancestor_size_vbytes:null,max_descendant_count:null,max_descendant_size_vbytes:null,supports_truc_v3:null,supports_ephemeral_anchors:null,supports_package_relay:null,
      probed_at:new Date().toISOString(),genesis,checkpoint:{height:chain.blocks,hash:chain.bestblockhash},scope:'Owned Core reported settings at read time. Unreported limits and feature capabilities are unknown; no version-based support inference.'};
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async evaluatePackage(rawTxs:string[],providedNetwork=this.core.network):Promise<PackageAnalysisReport>{
    if(providedNetwork!==this.core.network||!Array.isArray(rawTxs)||rawTxs.length<1||rawTxs.length>25||rawTxs.some(raw=>typeof raw!=='string'||!raw.length||raw.length%2!==0||!/^[0-9a-f]+$/i.test(raw))||rawTxs.reduce((n,raw)=>n+raw.length,0)>8000000)throw new PolicyEvidenceError('invalid-package','Supply 1 to 25 hexadecimal transactions within 4 MB for the selected network.',400);
    let transactions:Transaction[];
    try{transactions=rawTxs.map(raw=>{const tx=Transaction.fromHex(raw);if(tx.toHex()!==raw.toLowerCase())throw new Error();return tx;});}
    catch{throw new PolicyEvidenceError('invalid-package','A transaction is malformed or noncanonical.',400);}
    const ids=transactions.map(tx=>tx.getId());if(new Set(ids).size!==ids.length)throw new PolicyEvidenceError('invalid-package','Duplicate transactions are not a valid package.',400);
    const profile=await this.getEffectivePolicyProfile();
    const results=await this.call('testmempoolaccept',[rawTxs.map(raw=>raw.toLowerCase())]);
    if(!Array.isArray(results)||results.length!==transactions.length||new Set(results.map(row=>row?.txid)).size!==ids.length||results.some(row=>!row||!ids.includes(row.txid)))throw new PolicyEvidenceError('unavailable-policy-source','Owned policy verdict identities do not match the submitted package.');
    const members:MemberPolicyVerdict[]=transactions.map(tx=>{
      const row=results.find(result=>result.txid===tx.getId());const wtxid=createHash('sha256').update(createHash('sha256').update(tx.toBuffer()).digest()).digest().reverse().toString('hex');
      if(row.wtxid!==undefined&&row.wtxid!==wtxid||row.allowed!==undefined&&typeof row.allowed!=='boolean'||row.allowed===undefined&&typeof row['package-error']!=='string')throw new PolicyEvidenceError('unavailable-policy-source','Owned policy verdict is malformed or refers to different transaction bytes.');
      let fees:number|null=null;
      if(row.fees?.base!==undefined){const sats=row.fees.base*1e8;if(typeof row.fees.base!=='number'||!Number.isFinite(sats)||sats<0||sats>2100000000000000||Math.abs(sats-Math.round(sats))>0.001)throw new PolicyEvidenceError('unavailable-policy-source','Owned policy fee evidence is malformed.');fees=Math.round(sats);}
      if(row.allowed===true&&(fees===null||row.vsize!==tx.virtualSize()))throw new PolicyEvidenceError('unavailable-policy-source','Accepted policy result lacks matching fee and virtual-size evidence.');
      if(row.vsize!==undefined&&row.vsize!==tx.virtualSize())throw new PolicyEvidenceError('unavailable-policy-source','Owned policy virtual size does not match the transaction.');
      const reason=row['reject-reason']??row['package-error']??null;if(row.allowed===true&&reason!==null)throw new PolicyEvidenceError('unavailable-policy-source','Owned policy result contains contradictory acceptance and rejection evidence.');if(reason!==null&&(typeof reason!=='string'||reason.length>2048))throw new PolicyEvidenceError('unavailable-policy-source','Owned rejection detail is malformed.');
      return {txid:tx.getId(),wtxid,allowed:row.allowed??null,reject_code:reason,reject_reason:reason,consensus_valid:null,relay_valid:row.allowed??null,package_valid:row.allowed??null,fee_sats:fees,vsize:tx.virtualSize(),weight:tx.weight(),effective_feerate:fees===null?null:fees/tx.virtualSize(),ancestor_count:null,ancestor_vsize:null,descendant_count:null,descendant_vsize:null,conflicting_txids:null,is_rbf_replacement:null,replaces_txids:null};
    });
    if(await this.call('getblockhash',[profile.checkpoint.height])!==profile.checkpoint.hash)throw new PolicyEvidenceError('unavailable-policy-source','The active chain changed during package evaluation.');
    const totalVsize=members.reduce((n,row)=>n+row.vsize,0),totalWeight=members.reduce((n,row)=>n+row.weight,0),totalFees=members.some(row=>row.fee_sats===null)?null:members.reduce((n,row)=>n+row.fee_sats!,0);
    if(totalFees!==null&&(!Number.isSafeInteger(totalFees)||totalFees>2100000000000000))throw new PolicyEvidenceError('unavailable-policy-source','Owned package fee total exceeds the money range.');
    const hash=createHash('sha256').update(rawTxs.map(raw=>raw.toLowerCase()).join(':')).digest('hex');
    const topology=transactions.flatMap(tx=>tx.ins.flatMap(input=>{const parent=Buffer.from(input.hash).reverse().toString('hex');return ids.includes(parent)?[{parent_txid:parent,child_txid:tx.getId()}]:[];}));
    return {package_id:'pkg-'+hash.slice(0,16),input_hash:hash,network:profile.network,node_profile:profile,overall_allowed:members.some(row=>row.allowed===false)?false:members.some(row=>row.allowed===null)?null:true,
      package_feerate_sats_vb:totalFees===null?null:totalFees/totalVsize,total_fees_sats:totalFees,total_vsize:totalVsize,total_weight:totalWeight,members,topology,
      truc_v3_evaluation:{compliant:null,violating_rules:[]},divergences:[],scope:'Exact transaction parsing and owned Core testmempoolaccept at the stated checkpoint. No broadcast, reservation, independent consensus proof, future relay guarantee or multi-node comparison. Unreported fields remain unknown.'};
  }
}
export const bitcoinCorePolicyAdapter=new BitcoinCorePolicyAdapter();
