import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const env = {...process.env, CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: '-C link-arg=--max-memory=134217728'};
if(process.platform === 'win32') {
 env.CC_wasm32_unknown_unknown ??= 'C:/Program Files/LLVM/bin/clang.exe';
 env.AR_wasm32_unknown_unknown ??= 'C:/Program Files/LLVM/bin/llvm-ar.exe';
}
const result=spawnSync('cargo',['build','--locked','--release','--lib','--target','wasm32-unknown-unknown'],{cwd:root,env,stdio:'inherit',windowsHide:true});
if(result.status!==0) process.exit(result.status||1);
const dest=resolve(root,'../../frontend/src/resources/simplicity-compiler');
mkdirSync(dest,{recursive:true});
copyFileSync(resolve(root,'target/wasm32-unknown-unknown/release/universe_simplicity_compiler.wasm'),resolve(dest,'universe_simplicity_compiler.wasm'));
