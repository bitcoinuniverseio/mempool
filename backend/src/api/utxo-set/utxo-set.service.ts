import { ProtocolBearingUtxos,ScriptTypeDistribution,SupplyCohort,UtreexoRootsView,UtxoCheckpoint } from './utxo-set.types';
import { UtxoIntelligenceService,utxoIntelligenceService } from '../intelligence/utxo/utxo-intelligence.service';
import { UtxoEvidenceError } from '../intelligence/utxo/utxo-evidence';
export class UtxoSetEvidenceError extends Error {constructor(public readonly code:string,message:string,public readonly status=503){super(message);}}
export interface UtreexoProofVerdict {readonly valid:boolean;readonly stage:'invalid-input'|'unavailable-verifier';readonly error:string;}
export class UtxoSetService {
 constructor(private readonly intelligence:UtxoIntelligenceService=utxoIntelligenceService){}
 private async evidence<T>(read:()=>Promise<T>):Promise<T>{try{return await read();}catch(e){throw new UtxoSetEvidenceError(e instanceof UtxoEvidenceError?e.code:'utxo-source-unavailable',e instanceof UtxoEvidenceError?e.message:'Owned UTXO evidence is unavailable.');}}
 async $getCheckpoints():Promise<UtxoCheckpoint[]>{return this.evidence(async()=>{const s=await this.intelligence.getOverview();return [{blockHeight:s.block_height,blockHash:s.block_hash,muhashHex:s.muhash,totalTxOuts:s.total_utxos,bogoSize:s.bogo_size,totalAmountSats:String(s.total_amount_sats),verifiedAtTimestamp:Date.parse(s.observed_at_utc)/1000}];});}
 async $getDistribution():Promise<{valueCohorts:SupplyCohort[];scriptTypes:ScriptTypeDistribution[]}>{return this.evidence(async()=>{const c=await this.intelligence.getCohorts();return {valueCohorts:c.value_cohorts.map(g=>({label:String(g.value_band),txOutCount:g.utxo_count,totalAmountSats:String(g.total_sats),supplyPercentage:String(g.percent_of_supply)})),scriptTypes:c.script_types.map(g=>({scriptType:String(g.script_type) as ScriptTypeDistribution['scriptType'],count:g.utxo_count,totalAmountSats:String(g.total_sats),percentage:String(g.percent_of_supply)}))};});}
 async $getProtocolUtxos():Promise<ProtocolBearingUtxos>{throw new UtxoSetEvidenceError('unavailable-protocol-utxo-index','Protocol-bearing UTXO counts need reconciled protocol indexes at the same checkpoint; script types alone cannot establish protocol ownership.');}
 async $getUtreexoRoots():Promise<UtreexoRootsView>{throw new UtxoSetEvidenceError('unavailable-utreexo-bridge','Utreexo roots require a configured owned accumulator bridge; Core MuHash is not an Utreexo root.');}
 async $verifyUtreexoProof(proof:unknown):Promise<UtreexoProofVerdict>{
  if(!Array.isArray(proof)||proof.length===0||proof.length>1024||!proof.every(hash=>typeof hash==='string'&&/^[0-9a-f]{64}$/i.test(hash)))return {valid:false,stage:'invalid-input',error:'A nonempty bounded array of32-byte hexadecimal proof hashes is required.'};
  return {valid:false,stage:'unavailable-verifier',error:'No owned Utreexo accumulator verifier is configured; no inclusion was verified.'};
 }
}
export const utxoSetService=new UtxoSetService();
