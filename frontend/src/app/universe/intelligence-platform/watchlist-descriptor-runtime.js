import { Output, networks } from '@bitcoinerlab/descriptors';

// Version 3.2's exported declarations refer outside the package to
// ../../../dist/bitcoinLib. This small runtime boundary keeps our contract
// explicit without suppressing project or dependency type checking.
export function derivePublicScript(descriptor, index, testnet) {
  return new Output({ descriptor, index, checksumRequired: true, network: testnet ? networks.testnet : networks.bitcoin }).getScriptPubKey();
}
