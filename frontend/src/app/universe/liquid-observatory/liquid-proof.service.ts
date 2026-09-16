import { Injectable } from '@angular/core';
export interface LiquidProofInput {
  outputHex: string; blindingKey: string; rangeproofHex: string; surjectionproofHex: string; inputGenerators: string[];
}
export interface LiquidProofResult { assetId: string; valueSat: string; rangeproofValid: true; surjectionproofValid: true; }
interface ProofExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory; allocate(n: number): number; verify(p: number, n: number): bigint;
}
/** Each instance is single-use so all WASM memory, including crypto stack copies, can be wiped. */
export function inspectLiquidOutput(instance: WebAssembly.Instance, input: LiquidProofInput): LiquidProofResult {
  const api = instance.exports as ProofExports;
  let request: Uint8Array | undefined;
  try {
    if (!/^[a-f0-9]{64}$/i.test(input.blindingKey) || input.outputHex.length > 22000 || input.rangeproofHex.length > 10268
      || input.surjectionproofHex.length > 20000 || !input.inputGenerators.length || input.inputGenerators.length > 256) throw new Error('Invalid key, output, proof size or missing input generators.');
    request = new TextEncoder().encode(JSON.stringify(input));
    if (request.length > 100000) throw new Error('The unblinding request exceeds the local limit.');
    const pointer = api.allocate(request.length);
    if (!pointer) throw new Error('The local verifier could not allocate its input.');
    new Uint8Array(api.memory.buffer, pointer, request.length).set(request);
    const packed = api.verify(pointer, request.length);
    const resultPointer = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
    if (length > 4096) throw new Error('Invalid verifier response.');
    const result = JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer, resultPointer, length)));
    if (result.error) throw new Error(result.error);
    if (!/^[0-9a-f]{64}$/.test(result.assetId) || !/^\d+$/.test(result.valueSat)
      || result.rangeproofValid !== true || result.surjectionproofValid !== true) throw new Error('Invalid verifier response.');
    return result;
  } finally { request?.fill(0); new Uint8Array(api.memory.buffer).fill(0); }
}
@Injectable({ providedIn: 'root' })
export class LiquidProofService {
  private module: Promise<WebAssembly.Module> | null = null;
  async inspect(input: LiquidProofInput): Promise<LiquidProofResult> {
    this.module ??= fetch(new URL('resources/liquid-proof/universe_liquid_proof.wasm', document.baseURI)).then(async response => {
      if (!response.ok) throw new Error('The local Liquid verifier could not be loaded.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 10000000) throw new Error('Invalid local verifier.');
      return WebAssembly.compile(bytes);
    }).catch(error => { this.module = null; throw error; });
    return inspectLiquidOutput(await WebAssembly.instantiate(await this.module), input);
  }
}
