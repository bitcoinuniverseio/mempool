import { ProtocolBearingUtxos,ScriptTypeDistribution,SupplyCohort,UtreexoRootsView,UtxoCheckpoint } from './utxo-set.types';
import { UtxoIntelligenceService,utxoIntelligenceService } from '../intelligence/utxo/utxo-intelligence.service';
import { UtxoEvidenceError } from '../intelligence/utxo/utxo-evidence';
export class UtxoSetEvidenceError extends Error {constructor(public readonly code:string,message:string,public readonly status=503){super(message);}}
export interface UtreexoProofVerdict {readonly valid:boolean;readonly stage:'invalid-input'|'unavailable-verifier';readonly error:string;}
export class UtxoSetService {
 constructor(private readonly intelligence:UtxoIntelligenceService=utxoIntelligenceService){}
 private async evidence<T>(read:()=>Promise<T>):Promise<T>{try{return await read();}catch(e){throw new UtxoSetEvidenceError(e instanceof UtxoEvidenceError?e.code:'utxo-source-unavailable',e instanceof UtxoEvidenceError?e.message:'Owned UTXO evidence is unavailable.');}}
 async $getCheckpoints():Promise<UtxoCheckpoint[]>{return this.evidence(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async()=>{const s=await this.intelligence.getOverview();return [{network:s.network,blockHeight:s.block_height,blockHash:s.block_hash,muhashHex:s.muhash,totalTxOuts:s.total_utxos,bogoSize:s.bogo_size,totalAmountSats:String(s.total_amount_sats),verifiedAtTimestamp:Date.parse(s.observed_at_utc)/1000}];});}
 async $getDistribution():Promise<{network:string;blockHeight:number;blockHash:string;valueCohorts:SupplyCohort[];scriptTypes:ScriptTypeDistribution[]}>{return this.evidence(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async()=>{const c=await this.intelligence.getCohorts();return {network:c.network,blockHeight:c.block_height,blockHash:c.block_hash,valueCohorts:c.value_cohorts.map(g=>({label:String(g.value_band),txOutCount:g.utxo_count,totalAmountSats:String(g.total_sats),supplyPercentage:String(g.percent_of_supply)})),scriptTypes:c.script_types.map(g=>({scriptType:String(g.script_type) as ScriptTypeDistribution['scriptType'],count:g.utxo_count,totalAmountSats:String(g.total_sats),percentage:String(g.percent_of_supply)}))};});}
 /* IMPLEMENTATION-HANDOFF [WP-BE-012]
  * Defect BE-012; COV-BE-012 protocol-bearing UTXOs, Utreexo roots/verify.
  * All three offered routes are permanently unavailable. The hash-array
  * proof input cannot itself bind leaves/targets to an accumulator snapshot.
  * The current-source reproducer confirms missing integration, not a valid
  * proof verdict. Working Core MuHash checkpoints are a different operation.
  * 1. Pin the owned Utreexo bridge/accumulator revision and Bitcoin network
  *    using R-BE-UTREEXO. Store authenticated roots, leaf count, block hash,
  *    height and rollback data; never substitute Core MuHash for these roots.
  * 2. Version the verifier request with target positions, leaf commitments/
  *    UTXO data, proof nodes and the exact trusted accumulator checkpoint.
  *    Verify using the reference algorithm and reject duplicate/out-of-range
  *    targets, altered leaves, wrong root/count/network and stale fork state.
  * 3. Build protocol-UTXO totals by joining authoritative protocol indexes
  *    and the owned UTXO view at a shared block, with explicit overlap rules,
  *    exact atomic totals, complete coverage and reversible spent-state data.
  * 4. Update utxo-set types/routes and any consumers. Routes currently force
  *    non-input proof responses to 503; only real completed verification may
  *    add valid/invalid 200 verdicts. Preserve inherited checkpoint reads.
  * 5. Run official accumulator vectors and actual Signet bridge proofs,
  *    add/spend/reorg/restart updates, unavailable index and protocol overlap
  *    cases. Test both API-only roots/verify and all existing UTXO consumers.
  * Acceptance: three real operations with chain-bound evidence; missing
  * bridge/index credentials remain a concrete prerequisite, never a fake pass.
  * Rollback: retain raw indexed evidence and compatible roots/leaf count,
  * restore the accumulator snapshot and replay verified blocks consistently.
  * Preparation only; no protocol accounting or proof outcome is changed.
  */
 async $getProtocolUtxos():Promise<ProtocolBearingUtxos>{throw new UtxoSetEvidenceError('unavailable-protocol-utxo-index','Protocol-bearing UTXO counts need reconciled protocol indexes at the same checkpoint; script types alone cannot establish protocol ownership.');}
 async $getUtreexoRoots():Promise<UtreexoRootsView>{throw new UtxoSetEvidenceError('unavailable-utreexo-bridge','Utreexo roots require a configured owned accumulator bridge; Core MuHash is not an Utreexo root.');}
 async $verifyUtreexoProof(proof:unknown):Promise<UtreexoProofVerdict>{
  if(!Array.isArray(proof)||proof.length===0||proof.length>1024||!proof.every(hash=>typeof hash==='string'&&/^[0-9a-f]{64}$/i.test(hash)))return {valid:false,stage:'invalid-input',error:'A nonempty bounded array of32-byte hexadecimal proof hashes is required.'};
  return {valid:false,stage:'unavailable-verifier',error:'No owned Utreexo accumulator verifier is configured; no inclusion was verified.'};
 }
}
export const utxoSetService=new UtxoSetService();
