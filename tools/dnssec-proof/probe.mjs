import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
const root = dirname(fileURLToPath(import.meta.url));
const resolver = process.env.BIP353_DNS_RESOLVER;
const name = process.argv[2];
if (!resolver || !name || !/^[a-z0-9_.-]+\.$/i.test(name)) throw new Error('Set BIP353_DNS_RESOLVER and supply the full ASCII DNS owner name with trailing dot.');
const executable = resolve(root, 'target/release/universe-dnssec-query' + (process.platform === 'win32' ? '.exe' : ''));
const { stdout } = await promisify(execFile)(executable, [resolver, name], { timeout: 10000, maxBuffer: 1400000, windowsHide: true });
const native = JSON.parse(stdout);
const wasmBytes = readFileSync(resolve(root, '../../frontend/src/resources/dnssec/universe_dnssec_proof.wasm'));
const { instance } = await WebAssembly.instantiate(wasmBytes);
const api = instance.exports;
const request = new TextEncoder().encode(JSON.stringify({ name, proof: native.proof, now: Math.floor(Date.now() / 1000), network: process.env.BIP353_VERIFY_NETWORK }));
const input = api.allocate(request.length);
let output = 0, length = 0;
try {
  new Uint8Array(api.memory.buffer, input, request.length).set(request);
  const packed = api.verify(input, request.length);
  output = Number(packed >> 32n); length = Number(packed & 0xffffffffn);
  const result = JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer, output, length)));
  if (result.error || result.uri !== native.validation.uri || result.name !== name) throw new Error('Independent WASM validation failed: ' + (result.error || 'binding mismatch'));
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), name, nativeVerified: true, wasmVerified: true,
    proofBytes: Buffer.from(native.proof, 'base64').length, ttl: native.ttl, expires: result.expires,
    proofSha256: createHash('sha256').update(Buffer.from(native.proof, 'base64')).digest('hex'),
    wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'),
    paymentMethods: result.instructions?.methods || null, activity: 'DNS proof resolution and local cryptography only; no chain or payment request' }, null, 2));
} finally { if (output) api.deallocate(output, length); api.deallocate(input, request.length); }
