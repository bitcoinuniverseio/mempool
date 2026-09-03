/**
 * Watch-only derivation helpers.
 *
 * Elliptic-curve math is @scure/bip32; descriptor parsing and checksums
 * are utxo-descriptors (BIP-380); address encoding is @scure/btc-signer.
 * Nothing here is implemented from scratch and nothing here handles a
 * private key: only extended public keys and public descriptors.
 */

import { HDKey } from '@scure/bip32';
import { Address, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { hash160 } from '@scure/btc-signer/utils';
import { checksumVerify, parseDescriptor } from 'utxo-descriptors';
import type { ScriptKind } from '../stores/portfolio-model';

export const SCRIPT_KINDS: readonly ScriptKind[] = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'];

/** xpub/ypub/zpub/tpub/upub/vpub version prefixes by script kind. */
const PUBLIC_PREFIXES: readonly { prefix: string; script: ScriptKind; testnet: boolean }[] = [
  { prefix: 'xpub', script: 'p2pkh', testnet: false },
  { prefix: 'ypub', script: 'p2sh-p2wpkh', testnet: false },
  { prefix: 'zpub', script: 'p2wpkh', testnet: false },
  { prefix: 'tpub', script: 'p2pkh', testnet: true },
  { prefix: 'upub', script: 'p2sh-p2wpkh', testnet: true },
  { prefix: 'vpub', script: 'p2wpkh', testnet: true },
];

export interface ExtendedKeyInfo {
  readonly kind: 'xpub';
  readonly key: string;
  readonly script: ScriptKind;
  readonly testnet: boolean;
}

/** Classifies an extended public key, or null when it is not one. */
export function classifyExtendedKey(input: string): ExtendedKeyInfo | null {
  const text = (input ?? '').trim();
  const match = PUBLIC_PREFIXES.find((candidate) => text.startsWith(candidate.prefix));
  if (match === undefined) return null;
  try {
    HDKey.fromExtendedKey(text);
  } catch {
    return null;
  }
  return { kind: 'xpub', key: text, script: match.script, testnet: match.testnet };
}

export interface DescriptorInfo {
  readonly kind: 'descriptor';
  readonly value: string;
  readonly script: ScriptKind | 'multisig';
  readonly testnet: boolean;
  /** The extended keys the descriptor names, all public. */
  readonly extendedKeys: readonly string[];
  readonly checksumValid: boolean | null;
  readonly multipath: boolean;
}

/**
 * Parses and checksum-verifies a public output descriptor. Rejects any
 * key expression that carries no recognizable public key.
 */
export function classifyDescriptor(input: string, testnet = false): DescriptorInfo | null {
  const text = (input ?? '').trim();
  if (text.length === 0 || text.length > 1024) return null;
  // Verify the checksum separately so a broken checksum still yields a
  // parse with checksumValid=false instead of a rejection: the caller
  // shows why the descriptor was not accepted.
  const withoutChecksum = text.split('#')[0];
  try {
    const parsed = parseDescriptor(withoutChecksum);
    const keys = collectExtendedKeys(parsed);
    if (keys.length === 0) return null;
    let script: ScriptKind | 'multisig' = 'p2wpkh';
    if (/multisig/.test(withoutChecksum)) script = 'multisig';
    else if (withoutChecksum.startsWith('pkh(')) script = 'p2pkh';
    else if (withoutChecksum.startsWith('sh(')) script = 'p2sh-p2wpkh';
    else if (withoutChecksum.startsWith('tr(')) script = 'p2tr';
    let checksumValid: boolean | null = null;
    if (text.includes('#')) {
      // A wrong-length checksum throws in the verifier; that is a false,
      // not a parse failure.
      const hashIndex = text.lastIndexOf('#');
      try {
        checksumValid = checksumVerify(text.slice(0, hashIndex), text.slice(hashIndex + 1));
      } catch {
        checksumValid = false;
      }
    }
    return {
      kind: 'descriptor',
      value: text,
      script,
      testnet,
      extendedKeys: keys,
      checksumValid,
      multipath: withoutChecksum.includes('<') && withoutChecksum.includes('>'),
    };
  } catch {
    return null;
  }
}

function collectExtendedKeys(parsed: unknown): string[] {
  const keys: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(/(?:xpub|ypub|zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{30,}/g)) {
        keys.push(match[0]);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) visit(value);
    }
  };
  visit(parsed);
  return [...new Set(keys)];
}

export interface DeriveBatchRequest {
  readonly key: string;
  readonly script: ScriptKind;
  readonly testnet: boolean;
  readonly branch: 'external' | 'internal';
  readonly start: number;
  readonly count: number;
}

export interface DeriveBatchResult {
  readonly addresses: readonly { readonly index: number; readonly address: string }[];
}

/** Derives one batch of receive or change addresses from an account xpub. */
export function deriveAddressBatch(request: DeriveBatchRequest): DeriveBatchResult {
  const hd = HDKey.fromExtendedKey(request.key);
  const branchIndex = request.branch === 'external' ? 0 : 1;
  const addressEncoder = Address(request.testnet ? TEST_NETWORK : NETWORK);
  const addresses: { index: number; address: string }[] = [];
  for (let index = request.start; index < request.start + request.count; index += 1) {
    const child = hd.derive(`m/${branchIndex}/${index}`);
    if (child.publicKey === null) throw new Error('Derivation produced no public key.');
    addresses.push({
      index,
      address: encodeAddress(addressEncoder, child.publicKey, request.script),
    });
  }
  return { addresses };
}

function encodeAddress(encoder: ReturnType<typeof Address>, publicKey: Uint8Array, script: ScriptKind): string {
  switch (script) {
    case 'p2pkh':
      return encoder.encode({ type: 'pkh', hash: hash160(publicKey) });
    case 'p2sh-p2wpkh': {
      // redeemScript = OP_0 <hash160(pubkey)>; the address is p2sh of it.
      const program = new Uint8Array(22);
      program[0] = 0x00;
      program[1] = 0x14;
      program.set(hash160(publicKey), 2);
      return encoder.encode({ type: 'sh', hash: hash160(program) });
    }
    case 'p2wpkh':
      return encoder.encode({ type: 'wpkh', hash: hash160(publicKey) });
    case 'p2tr':
      return encoder.encode({ type: 'tr', pubkey: publicKey });
  }
}

/** Account-path derivation from a seed (tests, and xpub import from another watch-only tool). */
export function deriveAccountXpubFromSeed(
  seed: Uint8Array,
  script: ScriptKind,
  account: number,
): string {
  const purpose = script === 'p2pkh' ? 44 : script === 'p2sh-p2wpkh' ? 49 : script === 'p2wpkh' ? 84 : 86;
  return HDKey.fromMasterSeed(seed).derive(`m/${purpose}'/0'/${account}'`).publicExtendedKey;
}

