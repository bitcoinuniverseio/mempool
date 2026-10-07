import { Application } from 'express';
import config from '../../config';
import bitcoinApi from './bitcoin-api-factory';
import bitcoinClient from './bitcoin-client';
import backendInfo from '../backend-info';
import { ChainSourceIdentity, IdentityIndexReader, mountChainSourceIdentity } from './chain-source-identity';

export function initChainSourceIdentityRoutes(app: Application): void {
  mountChainSourceIdentity(app, new ChainSourceIdentity({
    core: bitcoinClient,
    releaseSha: () => backendInfo.getBackendInfo().releaseSha,
    index: () => {
      const api = bitcoinApi as typeof bitcoinApi & {
        $getIdentityReader?: () => IdentityIndexReader;
        $getIndexedTip?: () => Promise<number | null>;
        $getIndexBlockHash?: (height: number) => Promise<string>;
      };
      if (config.MEMPOOL.BACKEND === 'esplora' && api.$getIdentityReader) return api.$getIdentityReader();
      if (config.MEMPOOL.BACKEND === 'electrum' && api.$getIndexedTip && api.$getIndexBlockHash) return {
        selector: { backend: 'electrum', host: config.ELECTRUM.HOST, port: config.ELECTRUM.PORT, tls: config.ELECTRUM.TLS_ENABLED },
        tip: () => api.$getIndexedTip!(), hash: height => api.$getIndexBlockHash!(height),
      };
      throw new Error('Configured address index unavailable');
    },
  }));
}
