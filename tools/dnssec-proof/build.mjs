import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
if (process.platform === 'win32' && existsSync('C:/Program Files/LLVM/bin/clang.exe')) {
  env.CC_wasm32_unknown_unknown ??= 'C:/Program Files/LLVM/bin/clang.exe';
  env.AR_wasm32_unknown_unknown ??= 'C:/Program Files/LLVM/bin/llvm-ar.exe';
}
for (const args of [
  ['build', '--locked', '--release', '--lib', '--target', 'wasm32-unknown-unknown'],
  ['build', '--locked', '--release', '--bin', 'universe-dnssec-query'],
]) {
  const result = spawnSync('cargo', args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
const destination = resolve(root, '../../frontend/src/resources/dnssec');
mkdirSync(destination, { recursive: true });
copyFileSync(resolve(root, 'target/wasm32-unknown-unknown/release/universe_dnssec_proof.wasm'), resolve(destination, 'universe_dnssec_proof.wasm'));
