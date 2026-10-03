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
// IMPLEMENTATION-HANDOFF [WP-RS-002]
// Coverage: COV-RS-RGB-MANIFEST. Defect: DEF-RS-002. Comments-only preparation.
// Verified baseline mismatch: engine-manifest.json declares rgb.worker.js SHA256
// 83c2fd7fba720f2cf7439ccb3f67a60785f43c4a522a507b6c8088646aa7394b,
// but the committed worker hashes to
// 557af7914c8dd3e1b0028aa0b37c275c2a05a29a6e56755df1566b57f414aed8.
// The JS/WASM hashes match. The current browser loader does not check this
// manifest, so this is inaccurate release metadata, not a reproduced load error.
// 1. Review the worker bytes against the intended source revision, then refresh
//    the manifest from the final three artifacts using the createHash algorithm
//    below. Do not rebuild unchanged WASM only to refresh a worker digest, and do
//    not hand-edit a digest without hashing its actual reviewed artifact bytes.
// 2. Add the companion manifest assertion in rgb-wasm.test.mjs (same WP ID).
//    It must reject a mutation of any declared file and require all three files.
//    Include node --test rust/rgb-engine/rgb-wasm.test.mjs in the packaging gate;
//    coordinate .github/workflows/universe-ci.yml with the CI owner. The baseline
//    fixture-only run passed 10 tests while the separate manifest check failed.
// 3. Package frontend/src/resources/rgb-engine/engine-manifest.json and all three
//    files as one revision. Preserve the WASM memory cap and pinned engine/bindgen
//    metadata. No schema migration, secret, signing, or chain transaction applies.
//    Acceptance: every declared hash matches packaged bytes, all ten fixture
//    regressions pass, and a worker mutation fails the manifest regression.
//    Roll back the complete asset/manifest set together. Prerequisites: none.
const { writeManifest } = await import('./manifest.mjs');
writeManifest();
