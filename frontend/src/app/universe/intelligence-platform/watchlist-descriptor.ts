import { derivePublicScript } from './watchlist-descriptor-runtime';
import { sha256 } from '@noble/hashes/sha256';
import { classifyDescriptor } from '../portfolio/shared/derivation';
import { looksSecretLike } from '../portfolio/shared/secret-detection';

export interface DescriptorScripts {
  version: 1;
  network: string;
  children: { script_hash: string; derivation_index: number }[];
}

/** Derive only checksummed public descriptors over an explicit finite range. */
export function descriptorScripts(descriptor: string, network: string, start: number, count: number): DescriptorScripts {
  if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(network)) throw Error('Unsupported descriptor network');
  if (looksSecretLike(descriptor).secret || /(?:x|y|z|t|u|v)prv/i.test(descriptor)
    || descriptor.split(/[(),/[\]#]/).some(token => looksSecretLike(token).secret)) throw Error('Private material is not accepted');
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1 || count > 1000 || start + count > 0x80000000) throw Error('Choose a valid range of at most 1000 children');
  const classified = classifyDescriptor(descriptor, network !== 'mainnet');
  if (!classified || classified.checksumValid !== true || classified.multipath) throw Error('A checksummed public descriptor with one derivation path is required');
  const children = [];
  for (let index = start; index < start + count; index++) {
    const hash = sha256(derivePublicScript(descriptor, index, network !== 'mainnet'));
    children.push({ script_hash: [...hash].map(byte => byte.toString(16).padStart(2, '0')).join(''), derivation_index: index });
  }
  return { version: 1, network, children };
}
