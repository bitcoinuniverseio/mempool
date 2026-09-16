import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const cargo=process.env.CARGO || 'cargo';
const bindgen=process.env.WASM_BINDGEN || 'wasm-bindgen';
const env={...process.env};
if(process.platform==='win32'){
 env.CC_wasm32_unknown_unknown ||= 'C:/Program Files/LLVM/bin/clang.exe';
 env.AR_wasm32_unknown_unknown ||= 'C:/Program Files/LLVM/bin/llvm-ar.exe';
}
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:root,env,stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw Error(`${cmd} failed (${r.status})`);}
run(cargo,['build','--locked','--release','--lib','--target','wasm32-unknown-unknown']);
const output=path.resolve(root,'../../frontend/src/resources/rgb-engine');
run(bindgen,['target/wasm32-unknown-unknown/release/universe_rgb_engine.wasm','--target','no-modules','--out-name','rgb_engine','--out-dir',output]);
const files=['rgb_engine.js','rgb_engine_bg.wasm','rgb.worker.js'];
fs.writeFileSync(path.join(output,'engine-manifest.json'),JSON.stringify({engine:'rgb-ops 0.11.1-rc.11',wasm_bindgen:'0.2.114',max_memory_bytes:268435456,files:Object.fromEntries(files.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')]))},null,2)+'\n');
