import express from 'express';
import { request, Server } from 'http';
import { AddressInfo } from 'net';
import config from '../../../config';
import { UtxoStatsCache } from './utxo-source';
import { UtxoIntelligenceService } from './utxo-intelligence.service';
import { UtxoRoutes } from './utxo.routes';
import { UtxoSetService } from '../../utxo-set/utxo-set.service';
import { UtxoSetRoutes } from '../../utxo-set/utxo-set.routes';

describe('UTXO response source context and cache policy', () => {
  let server: Server;
  let service: UtxoIntelligenceService;
  const hash = 'ab'.repeat(32), muhash = 'cd'.repeat(32);
  const point = { network: 'regtest', block_height: 12, block_hash: hash, block_time: 1700000000, total_utxos: 0, total_amount_sats: 0, muhash, bogo_size: '0' };
  beforeEach(async () => {
    const stats = new UtxoStatsCache({ read: async () => ({ ...point, observed_at_utc: new Date().toISOString() }) });
    const projection = { sync: async () => undefined, getState: () => ({ ...point, rollback_floor_height: 0, persistence: 'process-memory-only' }), getCoins: () => [], getTransitions: () => [] };
    service = new UtxoIntelligenceService(stats, projection as any);
    const app = express();
    new UtxoRoutes(service).initRoutes(app);
    new UtxoSetRoutes(new UtxoSetService(service)).initRoutes(app);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
  });
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const get = (path: string): Promise<{ status: number; cache: unknown; body: any }> => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path, agent: false }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', part => text += part);
      response.on('end', () => resolve({ status: response.statusCode!, cache: response.headers['cache-control'], body: JSON.parse(text) }));
    }); req.on('error', reject); req.end();
  });
  it('preserves genuine source network and checkpoint on all successful intelligence partitions, including an empty transition list', async () => {
    for (const path of ['cohorts', 'economic-thresholds', 'spend-transitions', 'history']) {
      const result = await get('/api/v1/intelligence/utxo/' + path + '?network=signet');
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ network: point.network, block_height: point.block_height, block_hash: point.block_hash });
      expect(result.cache).toBe('no-store');
    }
  });
  it('retains source identity through legacy checkpoint and distribution adaptation without inventing a chain checkpoint', async () => {
    for (const path of ['checkpoints', 'distribution']) {
      const result = await get(config.MEMPOOL.API_URL_PREFIX + 'utxo-set/' + path);
      expect(result.status).toBe(200); expect(result.cache).toBe('no-store');
      expect(result.body.network).toBe(point.network);
      if (path === 'checkpoints') expect(result.body.checkpoints[0]).toMatchObject({ network: point.network, blockHash: hash, totalAmountSats: '0' });
      else expect(result.body).toMatchObject({ blockHeight: 12, blockHash: hash, valueCohorts: [], scriptTypes: [] });
    }
  });
  it('prevents storing overview and reconciliation responses and genuine missing-authority errors', async () => {
    for (const path of ['/api/v1/intelligence/utxo/overview', '/api/v1/intelligence/utxo/reconciliation', config.MEMPOOL.API_URL_PREFIX + 'utreexo/roots']) {
      const result = await get(path); expect(result.cache).toBe('no-store');
      if (path.endsWith('roots')) expect(result).toMatchObject({ status: 503, body: { stage: 'unavailable-utreexo-bridge' } });
      else expect(result.body.network).toBe(point.network);
    }
  });
});
