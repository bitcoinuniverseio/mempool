import config from '../../config';
import backendInfo from '../backend-info';
import { configuredIdentityReader } from './chain-source-identity.routes';
import { chainSourceConfigurationSha256 } from './chain-source-identity';
import { ReconstructionV4Binding } from './utxo-reconstruction-v4.types';
/** Reads only existing cached artifact metadata and static configured descriptors. */
export function configuredReconstructionV4Binding(): ReconstructionV4Binding | undefined {
  const releaseSha = backendInfo.getBackendInfo().releaseSha;
  if (!releaseSha || !/^[0-9a-f]{40}$/.test(releaseSha))
    {return undefined;}
  try {return {
    network: config.MEMPOOL.NETWORK,
    releaseSha,
    configurationSha256: chainSourceConfigurationSha256(
      configuredIdentityReader().selector
    ),
  };} catch {return undefined;}
}
