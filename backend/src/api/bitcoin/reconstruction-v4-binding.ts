import config from '../../config';
import { createRequire } from 'module';
import { ReconstructionV4Binding } from './utxo-reconstruction-v4.types';
const load = createRequire(__filename);
/** Reads only existing cached artifact metadata and static configured descriptors. */
export function configuredReconstructionV4Binding(): ReconstructionV4Binding | undefined {
  // Route registration must not initialize live clients merely to expose a
  // state inspection endpoint. Resolve the existing providers only on use.
  const backendInfo = (load('../backend-info') as typeof import('../backend-info')).default;
  const releaseSha = backendInfo.getBackendInfo().releaseSha;
  if (!releaseSha || !/^[0-9a-f]{40}$/.test(releaseSha))
    {return undefined;}
  try {
    const { configuredIdentityReader } = load('./chain-source-identity.routes') as typeof import('./chain-source-identity.routes');
    const { chainSourceConfigurationSha256 } = load('./chain-source-identity') as typeof import('./chain-source-identity');
    return {
    network: config.MEMPOOL.NETWORK,
    releaseSha,
    configurationSha256: chainSourceConfigurationSha256(
      configuredIdentityReader().selector
    ),
  };} catch {return undefined;}
}
