import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { isAbsolute } from 'path';
export const CLOSED_STATEMENT = 'The closed program evaluates successfully with no witness and no transaction environment.';
export const CLOSED_SYSTEM = 'simplicity-closed-program-v1';
export const LEAN_PROFILE = 'simplicity-u32-equality-v1';
export interface FormalVerdict {
 verified: boolean; proof_state: string; message: string; errors: string[];
 program_cmr?: string; statement?: string; proof_system?: string;
 kernel_revision?: string; kernel_artifact_hash?: string; proof_artifact_hash?: string;
}
export class FormalCheckerError extends Error {
 constructor(public readonly code:string,message:string,public readonly status:number){super(message);}
}
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
let active=0;
export async function verifyFormalArtifact(value:unknown):Promise<FormalVerdict> {
 const artifact=object(value)?value:{};
 const result=(state:string,message:string):FormalVerdict=>({verified:false,proof_state:state,message,errors:[message],
  program_cmr:typeof artifact.program_cmr==='string'?artifact.program_cmr.slice(0,64):undefined,
  statement:typeof artifact.statement==='string'?artifact.statement.slice(0,4000):undefined,
  proof_system:typeof artifact.proof_system==='string'?artifact.proof_system.slice(0,64):undefined});
 if(artifact.schema_version!=='1.0.0'||!['program_cmr','source_hash','proof_source_hash','proof_artifact_hash'].every(key=>typeof artifact[key]==='string'&&/^[0-9a-f]{64}$/.test(artifact[key]))
  ||!['compiler_revision','libSimplicity_revision','proof_system','statement','verification_command'].every(key=>typeof artifact[key]==='string'&&artifact[key].length<=(key==='statement'?4000:1000))
  ||!artifact.statement.trim()||!Array.isArray(artifact.dependencies)||artifact.dependencies.length>16||!artifact.dependencies.every((entry:unknown)=>typeof entry==='string'&&entry.length<=200))return result('proof_failed','Malformed or incomplete proof manifest.');
 const lean = artifact.proof_system === 'lean4' && artifact.proof_profile === LEAN_PROFILE;
 if(artifact.proof_system!==CLOSED_SYSTEM&&!lean)return result('unsupported_proof_system','No trusted kernel and program-binding adapter is configured for this proof system/profile. A manifest or claimed transcript is not a checked proof.');
 if(artifact.compiler_revision!=='simplicityhl-0.2.0'||artifact.libSimplicity_revision!=='simplicity-sys-0.5.0'
  ||JSON.stringify(artifact.dependencies)!==JSON.stringify(['simplicityhl-0.2.0','simplicity-sys-0.5.0',...(lean?['lean-4.24.0']:[])])
  ||(!lean&&artifact.statement!==CLOSED_STATEMENT)||(lean&&artifact.kernel_revision!=='lean-4.24.0'))return result('proof_failed','Unsupported revisions, dependencies or theorem statement for this bounded checker.');
 if(typeof artifact.source_text!=='string'||!artifact.source_text||Buffer.byteLength(artifact.source_text)>8192
  ||typeof artifact.program_bytes_hex!=='string'||artifact.program_bytes_hex.length>20000||! /^(?:[0-9a-f]{2})+$/.test(artifact.program_bytes_hex)
  ||typeof artifact.proof_source!=='string'||artifact.proof_source.length>1000)return result('proof_failed','Source, encoded program and bounded proof certificate are required.');
 const artifactHash=hash(Buffer.from(artifact.program_bytes_hex,'hex'));
 let certificate=JSON.stringify({claim:'closed-program-succeeds',program_cmr:artifact.program_cmr,program_bytes_sha256:artifactHash});
 let leanTerm: {left:number;right:number;proof_value:number}|undefined;
 if(lean){
  let term:any;try{term=JSON.parse(artifact.proof_source);}catch{return result('proof_failed','Invalid bounded Lean certificate JSON.');}
  if(!object(term)||term.profile!==LEAN_PROFILE||term.term!=='refl'||!['left','right','value'].every(key=>Number.isInteger(term[key])&&term[key]>=0&&term[key]<=0xffffffff))return result('proof_failed','Unsupported Lean proof term. Only bounded u32 reflexivity terms are accepted; submitted Lean code is never executed.');
  certificate=JSON.stringify({profile:LEAN_PROFILE,left:term.left,right:term.right,term:'refl',value:term.value,program_cmr:artifact.program_cmr,program_bytes_sha256:artifactHash});
  if(artifact.statement!==`(${term.left} : UInt32) = (${term.right} : UInt32)`||artifact.source_text!==`fn main() { assert!(jet::eq_32(${term.left},${term.right})); }`)return result('proof_failed','The Lean theorem does not match the exact supported Simplicity source assertion.');
  leanTerm={left:term.left,right:term.right,proof_value:term.value};
 }
 if(hash(artifact.source_text)!==artifact.source_hash||hash(artifact.proof_source)!==artifact.proof_source_hash||artifactHash!==artifact.proof_artifact_hash||artifact.proof_source!==certificate)return result('proof_failed','Source, proof certificate or program artifact hash/binding mismatch.');
 const executable=process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE;
 if(!executable||!isAbsolute(executable))throw new FormalCheckerError('checker-unavailable','The owned closed-program checker is not configured.',503);
 if(lean&&(!process.env.SIMPLICITY_LEAN_EXECUTABLE||!isAbsolute(process.env.SIMPLICITY_LEAN_EXECUTABLE)))throw new FormalCheckerError('checker-unavailable','The pinned owned Lean kernel is not configured.',503);
 if(active>=2)throw new FormalCheckerError('checker-busy','The proof checker is busy. Retry shortly.',429);
 active++;
 try {
  const stdout=await new Promise<string>((resolve,reject)=>{
   const child=execFile(executable,[],{windowsHide:true,timeout:10000,maxBuffer:16384,encoding:'utf8'},(error,out)=>{
    if(error)reject(new FormalCheckerError('checker-failed','The bounded proof checker failed or exceeded its limit.',502));else resolve(out);
   });
   child.stdin?.on('error',()=>{});
   child.stdin?.end(JSON.stringify({source_text:artifact.source_text,program_bytes_hex:artifact.program_bytes_hex,program_cmr:artifact.program_cmr,...(lean?{proof_system:'lean4',...leanTerm}:{})}));
  });
  let checked:any;try{checked=JSON.parse(stdout);}catch{throw new FormalCheckerError('checker-invalid-response','The proof checker returned an invalid response.',502);}
  if(['lean-kernel-unavailable','unsupported-lean-kernel-revision','kernel-workspace-unavailable'].includes(checked.error))throw new FormalCheckerError('checker-unavailable','The pinned owned Lean kernel/workspace is unavailable.',503);
  if(checked.verified!==true)return result('proof_failed','The independent checker did not establish the exact claim. The proof may be false, use an unsupported term, or mismatch the source/program.');
  const expectedKernelHash=leanTerm?hash(`-- Bound Simplicity program CMR: ${artifact.program_cmr}\nset_option maxRecDepth 256\nset_option maxHeartbeats 20000\ntheorem artifact : (${leanTerm.left} : UInt32) = (${leanTerm.right} : UInt32) := Eq.refl (${leanTerm.proof_value} : UInt32)\n`):undefined;
  if(checked.program_cmr!==artifact.program_cmr||checked.checker!==(lean?'lean4-simplicity-u32-equality-v1':CLOSED_SYSTEM)||!Number.isSafeInteger(checked.cost_milliweight)||checked.cost_milliweight<0
   ||lean&&(checked.kernel_revision!=='lean-4.24.0'||checked.kernel_statement!==artifact.statement||checked.kernel_artifact_hash!==expectedKernelHash))throw new FormalCheckerError('checker-invalid-response','The proof checker result did not bind the requested program.',502);
  return {verified:true,proof_state:'proof_checked',message:lean?'Lean checked the exact u32 equality theorem; independent C execution checked its bound canonical Simplicity program.':CLOSED_STATEMENT,errors:[],program_cmr:artifact.program_cmr,statement:artifact.statement,proof_system:artifact.proof_system,...(lean?{kernel_revision:checked.kernel_revision,kernel_artifact_hash:checked.kernel_artifact_hash,proof_artifact_hash:artifactHash}:{})};
 }finally{active--;}
}
