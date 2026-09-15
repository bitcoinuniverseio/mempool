const fs=require('fs'),crypto=require('crypto'),path=require('path');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');const root=__dirname;
const original=JSON.parse(fs.readFileSync(path.join(root,'fixtures.json'),'utf8'));
const fixtures=original.map((a,i)=>{const left=42,right=i===0?42:43;const proof_source=JSON.stringify({profile:'simplicity-u32-equality-v1',left,right,term:'refl',value:42,program_cmr:a.program_cmr,program_bytes_sha256:a.proof_artifact_hash});return {...a,proof_system:'lean4',proof_profile:'simplicity-u32-equality-v1',kernel_revision:'lean-4.24.0',dependencies:[...a.dependencies,'lean-4.24.0'],statement:`(${left} : UInt32) = (${right} : UInt32)`,proof_source,proof_source_hash:hash(proof_source),verification_command:'Bounded owned Lean kernel adapter; client commands are inert.'}});
fs.writeFileSync(path.join(root,'lean-fixtures.json'),JSON.stringify(fixtures,null,2)+'\n');
fs.writeFileSync(path.resolve(root,'../../frontend/src/app/universe/simplicity/lean-proof-sample.ts'),'// Public exact-source Lean kernel fixture.\nexport const LEAN_PROOF_SAMPLE = '+JSON.stringify(fixtures[0],null,2)+' as const;\n');
