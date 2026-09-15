import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { verifyFormalArtifact } from './formal-checker';
const root=resolve(__dirname,'../../../../..');
const fixtures=JSON.parse(readFileSync(resolve(root,'tools/simplicity-proof-checker/lean-fixtures.json'),'utf8'));
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const live=process.env.SIMPLICITY_LEAN_EXECUTABLE?describe:describe.skip;
live('actual pinned Lean kernel and independently bound C program',()=>{
 const previous=process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE;
 beforeAll(()=>{process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE=resolve(root,'tools/simplicity-proof-checker/target/release/universe-simplicity-proof-checker'+(process.platform==='win32'?'.exe':''));});
 afterAll(()=>{if(previous===undefined)delete process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE;else process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE=previous;});
 it('checks the theorem with an official kernel and retains the exact generated artifact digest',async()=>{
  const result=await verifyFormalArtifact(fixtures[0]);
  expect(result).toMatchObject({verified:true,proof_system:'lean4',kernel_revision:'lean-4.24.0',kernel_artifact_hash:'70d1bfa4b59e8d9b9f6f9c3b2d88a5825bbe1d835b3b9b964a119355f6851049',proof_artifact_hash:fixtures[0].proof_artifact_hash});
 });
 it('rejects a faithfully bound false equality assertion',async()=>{expect((await verifyFormalArtifact(fixtures[1])).verified).toBe(false);});
 it('rejects a wrong reflexivity term even for a true program',async()=>{const term=JSON.parse(fixtures[0].proof_source);term.value=43;const proof_source=JSON.stringify(term);expect((await verifyFormalArtifact({...fixtures[0],proof_source,proof_source_hash:hash(proof_source)})).verified).toBe(false);});
 it('never executes the supplied verification command',async()=>{expect((await verifyFormalArtifact({...fixtures[0],verification_command:'#eval IO.println "must never execute"'})).verified).toBe(true);});
 it('rejects an attacker-rebound CMR through independent compilation',async()=>{const program_cmr='00'.repeat(32);const term={...JSON.parse(fixtures[0].proof_source),program_cmr};const proof_source=JSON.stringify(term);expect((await verifyFormalArtifact({...fixtures[0],program_cmr,proof_source,proof_source_hash:hash(proof_source)})).verified).toBe(false);});
 it('reports missing kernel as unavailable',async()=>{const executable=process.env.SIMPLICITY_LEAN_EXECUTABLE;delete process.env.SIMPLICITY_LEAN_EXECUTABLE;try{await expect(verifyFormalArtifact(fixtures[0])).rejects.toMatchObject({code:'checker-unavailable',status:503});}finally{process.env.SIMPLICITY_LEAN_EXECUTABLE=executable;}});
});
describe('strict Lean term/profile boundary',()=>{
 it.each(['#eval IO.println "anything"','axiom bad : False','by sorry','by native_decide'])('rejects arbitrary Lean source %s',async proof_source=>{expect((await verifyFormalArtifact({...fixtures[0],proof_source,proof_source_hash:hash(proof_source)})).verified).toBe(false);});
 it.each(['kernel_revision','statement','source_text'])('rejects unbound %s',async field=>{expect((await verifyFormalArtifact({...fixtures[0],[field]:'altered'})).verified).toBe(false);});
 it('does not substitute constrained proof for unsupported general Lean artifacts',async()=>{const data={...fixtures[0]};delete data.proof_profile;expect((await verifyFormalArtifact(data)).proof_state).toBe('unsupported_proof_system');});
});
