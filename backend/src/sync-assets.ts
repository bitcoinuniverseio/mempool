import axios from 'axios';
import { createWriteStream } from 'fs';
import { rename, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import config from './config';
import backendInfo from './api/backend-info';
import logger from './logger';
import { SocksProxyAgent } from 'socks-proxy-agent';

export class SyncAssets {
  constructor(private directory = '.', private timeoutMs = 30000, private maximumBytes = 128 * 1024 * 1024) {}

  /**
   * External assets are optional: a transfer that fails is logged and the
   * existing file, if any, is kept. Startup never fails on one.
   * @asyncSafe
   */
  public async syncAssets$(): Promise<void> {
    for (const url of config.MEMPOOL.EXTERNAL_ASSETS) {
      try {
        await this.downloadFile$(url);
      } catch (e) {
        logger.warn(`External asset ${url} was not refreshed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** A failed transfer never replaces an existing asset.  @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async downloadFile$(rawUrl: string): Promise<void> {
    const url = new URL(rawUrl);
    const filename = decodeURIComponent(url.pathname.split('/').pop() || '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(filename) || filename.endsWith('.') ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) {
      throw new Error('External asset URL must name a regular file without credentials.');
    }
    const temporary = join(this.directory, '.asset-' + randomUUID() + '.partial');
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.timeoutMs);
    const maximumBytes = this.maximumBytes;
    let received = 0;
    try {
      const proxy = config.SOCKS5PROXY;
      const agent = proxy.ENABLED ? new SocksProxyAgent({
        hostname: proxy.HOST, port: proxy.PORT,
        ...(proxy.USERNAME && proxy.PASSWORD ? { username: proxy.USERNAME, password: proxy.PASSWORD } : {}),
      }) : undefined;
      const response = await axios.get(rawUrl, {
        headers: { 'User-Agent': config.MEMPOOL.USER_AGENT === 'mempool' ? 'mempool/v' + backendInfo.getBackendInfo().version : config.MEMPOOL.USER_AGENT },
        httpAgent: agent, httpsAgent: agent, ...(agent ? { proxy: false as const } : {}),
        responseType: 'stream', timeout: this.timeoutMs, signal: controller.signal,
      });
      const bound = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(received > maximumBytes ? new Error('Asset size limit exceeded') : null, chunk);
      } });
      await pipeline(response.data, bound, createWriteStream(temporary, { flags: 'wx' }), { signal: controller.signal });
      await rename(temporary, join(this.directory, filename));
      logger.info('External asset ' + filename + ' saved (' + received + ' bytes)');
    } catch {
      throw new Error('Failed to download external asset ' + filename + '; the previous file was preserved.');
    } finally {
      clearTimeout(deadline);
      await rm(temporary, { force: true });
    }
  }
}

export default new SyncAssets();
