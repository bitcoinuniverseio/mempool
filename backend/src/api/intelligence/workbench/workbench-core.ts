import bitcoinClient from '../../bitcoin/bitcoin-client';
import config from '../../../config';

export interface WorkbenchCoreReader {
  call(method: string, params: unknown[]): Promise<any>;
  network: string;
}

export const ownedWorkbenchCore: WorkbenchCoreReader = {
  network: config.MEMPOOL.NETWORK,
  call: (method, params) => bitcoinClient.rpc.call(method, params),
};
