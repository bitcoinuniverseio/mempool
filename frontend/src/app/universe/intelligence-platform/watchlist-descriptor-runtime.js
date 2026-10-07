import { Output, networks } from '@bitcoinerlab/descriptors';

// Version 3.2's exported declarations refer outside the package to
// ../../../dist/bitcoinLib. This small runtime boundary keeps our contract
// explicit without suppressing project or dependency type checking.
export function derivePublicScript(descriptor, index, testnet) {
  return publicOutput(descriptor, index, testnet).getScriptPubKey();
}

export function derivePublicAddress(descriptor, index, testnet) {
  return publicOutput(descriptor, index, testnet).getAddress();
}

function publicOutput(descriptor, index, testnet) {
  const ranged = descriptor.includes('*');
  if (!ranged && index !== 0) throw Error('A fixed descriptor has one output at index zero');
  return new Output({ descriptor, ...(ranged ? { index } : {}), checksumRequired: true, network: testnet ? networks.testnet : networks.bitcoin });
}
