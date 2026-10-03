import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src/resources/rgb-engine');
export const files = ['rgb_engine.js', 'rgb_engine_bg.wasm', 'rgb.worker.js'];
export function verifyManifest(manifest, read = name => fs.readFileSync(path.join(assets, name))) {
  for (const name of files) {
    const digest = createHash('sha256').update(read(name)).digest('hex');
    if (manifest.files?.[name] !== digest) throw Error(`RGB manifest digest mismatch: ${name}`);
  }
  return true;
}
export function writeManifest() {
  const manifest = {engine:'rgb-ops 0.11.1-rc.11',wasm_bindgen:'0.2.114',max_memory_bytes:268435456,files:Object.fromEntries(files.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(assets,name))).digest('hex')]))};
  fs.writeFileSync(path.join(assets,'engine-manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  verifyManifest(manifest);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeManifest();
