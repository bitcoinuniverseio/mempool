import { Injectable } from '@angular/core';

export interface VerifiedPaymentRecord {
  name: string;
  uri: string;
  validFrom: number;
  expires: number;
  maxCacheTtl: number;
  dnssecValid: true;
  instructions?: { addresses: string[]; methods: string[]; expires: number | null };
}

interface VerifierExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  allocate(length: number): number;
  deallocate(pointer: number, length: number): void;
  verify(pointer: number, length: number): bigint;
}

export function verifyBip353Proof(instance: WebAssembly.Instance, proof: string, name: string, now = Math.floor(Date.now() / 1000), network?: string): VerifiedPaymentRecord {
  if (typeof proof !== 'string' || proof.length > 1333336 || !Number.isSafeInteger(now)) throw new Error('Invalid DNSSEC proof.');
  const request = new TextEncoder().encode(JSON.stringify({ proof, name, now, network }));
  const api = instance.exports as VerifierExports;
  const input = api.allocate(request.length);
  if (!input) throw new Error('The DNSSEC proof exceeds the verifier limit.');
  let output = 0;
  let length = 0;
  try {
    new Uint8Array(api.memory.buffer, input, request.length).set(request);
    const packed = api.verify(input, request.length);
    output = Number(packed >> 32n);
    length = Number(packed & 0xffffffffn);
    if (length > 32768) throw new Error('The DNSSEC proof result exceeds the verifier limit.');
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(api.memory.buffer, output, length)));
    if (result.error || result.name !== name || result.dnssecValid !== true
      || typeof result.uri !== 'string' || result.uri.length > 8192 || !/^bitcoin:/i.test(result.uri)
      || !Number.isSafeInteger(result.validFrom) || !Number.isSafeInteger(result.expires)
      || now < result.validFrom || now >= result.expires || !Number.isSafeInteger(result.maxCacheTtl) || result.maxCacheTtl < 0) {
      throw new Error('DNSSEC proof verification failed or no unique authenticated payment record exists.');
    }
    if (network !== undefined && (!result.instructions || !Array.isArray(result.instructions.addresses)
      || !result.instructions.addresses.every((value: unknown) => typeof value === 'string')
      || !Array.isArray(result.instructions.methods) || !result.instructions.methods.length
      || !result.instructions.methods.every((value: unknown) => typeof value === 'string')
      || (result.instructions.expires !== null && (!Number.isSafeInteger(result.instructions.expires) || result.instructions.expires <= now)))) {
      throw new Error('The authenticated payment instructions are invalid for this network.');
    }
    return result as VerifiedPaymentRecord;
  } finally {
    if (output) api.deallocate(output, length);
    api.deallocate(input, request.length);
  }
}

@Injectable({ providedIn: 'root' })
export class Bip353VerifierService {
  private verifier: Promise<WebAssembly.Instance> | null = null;

  async verify(proof: string, name: string, network: string): Promise<VerifiedPaymentRecord> {
    if (!this.verifier) {
      this.verifier = fetch(new URL('resources/dnssec/universe_dnssec_proof.wasm', document.baseURI)).then(async response => {
        if (!response.ok) throw new Error('The local DNSSEC verifier could not be loaded.');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 10000000) throw new Error('The local DNSSEC verifier is invalid.');
        return (await WebAssembly.instantiate(bytes)).instance;
      }).catch(error => { this.verifier = null; throw error; });
    }
    return verifyBip353Proof(await this.verifier, proof, name, Math.floor(Date.now() / 1000), network);
  }
}
