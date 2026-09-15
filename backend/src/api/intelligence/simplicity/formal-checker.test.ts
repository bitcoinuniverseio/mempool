import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { verifyFormalArtifact } from './formal-checker';
const root=resolve(__dirname,'../../../../..');
const fixtures=JSON.parse(readFileSync(resolve(root,'tools/simplicity-proof-checker/fixtures.json'),'utf8'));
const previous=process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE;
beforeAll(()=>{process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE=resolve(root,'tools/simplicity-proof-checker/target/release/universe-simplicity-proof-checker'+(process.platform==='win32'?'.exe':''));});
afterAll(()=>{if(previous===undefined)delete process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE;else process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE=previous;});
describe('actual independent closed-program proof checker',()=>{
 it('binds a real compiled program and independently establishes its exact closed claim',async()=>{
  expect(await verifyFormalArtifact(fixtures[0])).toMatchObject({verified:true,proof_state:'proof_checked',program_cmr:fixtures[0].program_cmr});
 });
 it('rejects an intact artifact whose semantic claim is false',async()=>{
  expect(await verifyFormalArtifact(fixtures[1])).toMatchObject({verified:false,proof_state:'proof_failed'});
 });
 it.each(['source_text','proof_source','program_bytes_hex','program_cmr','statement','compiler_revision','libSimplicity_revision','source_hash','proof_source_hash','proof_artifact_hash'])('rejects alteration of %s',async field=>{
  const changed={...fixtures[0],[field]:fixtures[0][field]+'00'};
  expect((await verifyFormalArtifact(changed)).verified).toBe(false);
 });
 it('rejects altered source even when the attacker updates its hash',async()=>{
  const source_text='fn main() {}';const source_hash=createHash('sha256').update(source_text).digest('hex');
  expect((await verifyFormalArtifact({...fixtures[0],source_text,source_hash})).verified).toBe(false);
 });
 it.each(['coq','lean4','isabelle','dafny','custom-prover'])('never treats %s metadata/claimed verifier output as proof',async proof_system=>{
  expect(await verifyFormalArtifact({...fixtures[0],proof_system,verification_result:{verified:true,verifier_output:'Qed'}})).toMatchObject({verified:false,proof_state:'unsupported_proof_system'});
 });
 it('does not execute the untrusted verification command',async()=>{
  expect((await verifyFormalArtifact({...fixtures[0],verification_command:'untrusted-request-command --must-never-run'})).verified).toBe(true);
 });
 it.each([null,[],{},true,'manifest'])('safely rejects malformed input',async input=>{expect((await verifyFormalArtifact(input)).verified).toBe(false);});
 it('reports missing owned checker distinctly',async()=>{
  const executable=process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE;delete process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE;
  try{await expect(verifyFormalArtifact(fixtures[0])).rejects.toMatchObject({code:'checker-unavailable',status:503});}finally{process.env.SIMPLICITY_PROOF_CHECKER_EXECUTABLE=executable;}
 });
});
