import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyBip353Proof } from './bip353-verifier.service';

// Published BIP353 CC0 fixtures are historic public DNS proofs, not wallet data.
const vectors = JSON.parse(readFileSync(resolve(process.cwd(), '../tools/dnssec-proof/bip353-official-vectors.json'), 'utf8').replace(/^\uFEFF/, '')) as { name: string; proof: string }[];
const queryName = (name: string): string => name.replace('@', '.user._bitcoin-payment.') + '.';
let instance: WebAssembly.Instance;
beforeAll(async () => {
  instance = (await WebAssembly.instantiate(readFileSync(resolve(process.cwd(), 'src/resources/dnssec/universe_dnssec_proof.wasm')))).instance;
});

describe('real local DNSSEC verification with official BIP353 proofs', () => {
  it('verifies a root-authenticated TXT proof while ignoring unrelated TXT records', () => {
    const result = verifyBip353Proof(instance, vectors[0].proof, queryName(vectors[0].name), Date.parse('2025-08-07T12:00:00Z') / 1000);
    expect(result.uri).toBe('bitcoin:?bc=bc1qztwy6xen3zdtt7z0vrgapmjtfz8acjkfp5fp7l');
    expect(result.dnssecValid).toBe(true);
  });

  it('verifies authenticated CNAME and wildcard paths', () => {
    for (const vector of vectors.slice(1, 3)) {
      expect(verifyBip353Proof(instance, vector.proof, queryName(vector.name), Date.parse('2025-08-06T12:00:00Z') / 1000).uri).toMatch(/^bitcoin:/i);
    }
  });

  it('locally inspects the BIP321 address and BOLT12 offer from the authenticated record', () => {
    const vector = vectors[2];
    const result = verifyBip353Proof(instance, vector.proof, queryName(vector.name), Date.parse('2025-08-06T12:00:00Z') / 1000, 'mainnet');
    expect(result.instructions?.methods).toContain('Lightning BOLT12');
    expect(result.instructions?.addresses.length).toBeGreaterThan(0);
    expect(() => verifyBip353Proof(instance, vector.proof, queryName(vector.name), Date.parse('2025-08-06T12:00:00Z') / 1000, 'signet')).toThrow();
  });

  it('rejects two payment TXT records and missing wildcard-denial proof', () => {
    for (const vector of vectors.slice(3)) {
      expect(() => verifyBip353Proof(instance, vector.proof, queryName(vector.name), Date.parse('2025-08-07T12:00:00Z') / 1000)).toThrow();
    }
  });

  it('rejects altered signatures, another name, expired and not-yet-valid proofs', () => {
    const proof = Buffer.from(vectors[0].proof, 'base64');
    proof[proof.length - 10] ^= 1;
    const historicTime = Date.parse('2025-08-07T12:00:00Z') / 1000;
    expect(() => verifyBip353Proof(instance, proof.toString('base64'), queryName(vectors[0].name), historicTime)).toThrow();
    expect(() => verifyBip353Proof(instance, vectors[0].proof, 'other.example.', historicTime)).toThrow();
    expect(() => verifyBip353Proof(instance, vectors[0].proof, queryName(vectors[0].name), Date.parse('2026-09-15T00:00:00Z') / 1000)).toThrow();
    expect(() => verifyBip353Proof(instance, vectors[0].proof, queryName(vectors[0].name), Date.parse('2024-01-01T00:00:00Z') / 1000)).toThrow();
  });

  it('rejects untrusted empty and malformed proofs without accepting an AD assertion', () => {
    for (const proof of ['', 'AA==', Buffer.from(JSON.stringify({ AD: true })).toString('base64')]) {
      expect(() => verifyBip353Proof(instance, proof, 'test.example.')).toThrow();
    }
  });
});
