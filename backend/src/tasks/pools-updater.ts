import axios, { AxiosResponse } from 'axios';
import poolsParser from '../api/pools-parser';
import config from '../config';
import DB from '../database';
import backendInfo from '../api/backend-info';
import logger from '../logger';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as https from 'https';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Common } from '../api/common';

/**
 * Maintain the most recent version of pools-v2.json
 */
class PoolsUpdater {
  tag = 'PoolsUpdater';

  lastRun: number = 0;
  currentSha: string | null = null;
  poolsUrl: string = config.MEMPOOL.POOLS_JSON_URL;
  treeUrl: string = config.MEMPOOL.POOLS_JSON_TREE_URL;
  poolsFile: string = config.MEMPOOL.POOLS_JSON_FILE;

  /** @asyncSafe */
  public async $startService(): Promise<void> {
    while ('Bitcoin is still alive') {
      try {
        await this.updatePoolsJson();
      } catch (e: any) {
        logger.info(`Exception ${e} in PoolsUpdater::$startService. Code: ${e.code}. Message: ${e.message}`, this.tag);
      }
      await Common.sleep$(10000);
    }
  }

  /**
   * Resolves the bundled pools file against the compiled backend directory, so
   * the same relative path works from `src` under ts-node and from `dist` in
   * production. An absolute path is used as given.
   */
  private resolvePoolsFile(): string {
    return path.isAbsolute(this.poolsFile)
      ? this.poolsFile
      : path.resolve(__dirname, '..', this.poolsFile);
  }

  /**
   * Imports mining pool metadata from the bundled first-party file instead of
   * fetching it from a third party at runtime. The identifier is the git blob
   * hash of the file contents, so it is deterministic, offline, and directly
   * comparable with the sha the database already stores.
   * @asyncSafe
   */
  private async $updatePoolsFromFile(): Promise<void> {
    const file = this.resolvePoolsFile();
    let raw: Buffer;
    try {
      raw = fs.readFileSync(file);
    } catch (e) {
      logger.err(`Cannot read the bundled mining pools file ${file}. Reason: ` + (e instanceof Error ? e.message : e), this.tag);
      return;
    }

    let poolsJson: any;
    try {
      poolsJson = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      logger.err(`The bundled mining pools file ${file} is not valid JSON.`, this.tag);
      return;
    }
    if (!Array.isArray(poolsJson) || poolsJson.length === 0) {
      logger.err(`The bundled mining pools file ${file} must hold a non-empty array of pools.`, this.tag);
      return;
    }

    const fileSha = crypto.createHash('sha1')
      .update(Buffer.from(`blob ${raw.length}`, 'utf8'))
      .update(Buffer.alloc(1))
      .update(raw)
      .digest('hex');

    if (config.DATABASE.ENABLED === true) {
      this.currentSha = await this.getShaFromDb();
    }
    if (this.currentSha === fileSha) {
      return;
    }

    poolsParser.setMiningPools(poolsJson);

    if (config.DATABASE.ENABLED === false) {
      this.currentSha = fileSha;
      logger.info(`Mining pools imported from ${file} (${fileSha}), no database`, this.tag);
      return;
    }

    try {
      await DB.query('START TRANSACTION;');
      await this.updateDBSha(fileSha);
      await poolsParser.migratePoolsJson();
      await DB.query('COMMIT;');
    } catch (e) {
      logger.err(`Could not migrate mining pools, rolling back. Exception: ${JSON.stringify(e)}`, this.tag);
      try {
        await DB.query('ROLLBACK;');
      } catch (rollbackError) {
        logger.err('Could not roll back the mining pool import. Reason: ' + (rollbackError instanceof Error ? rollbackError.message : rollbackError), this.tag);
      }
      // The sha was optimistically set before the write; the rollback undid it,
      // so clear it again rather than let startup believe pools are loaded.
      this.currentSha = null;
      return;
    }
    logger.info(`Mining pools imported from ${file} (${fileSha})`, this.tag);
  }

  /** @asyncSafe */
  public async updatePoolsJson(): Promise<void> {
    if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config.MEMPOOL.NETWORK) === false ||
      config.MEMPOOL.ENABLED === false
    ) {
      return;
    }

    const now = new Date().getTime() / 1000;
    if (now - this.lastRun < config.MEMPOOL.POOLS_UPDATE_DELAY) { // Execute the PoolsUpdate only once a week, or upon restart
      return;
    }

    this.lastRun = now;

    if (this.poolsFile) {
      try {
        await this.$updatePoolsFromFile();
      } catch (e) {
        logger.err(`PoolsUpdater failed to import the bundled pools file. Exception: ${JSON.stringify(e)}`, this.tag);
      }
      return;
    }

    try {
      if (config.DATABASE.ENABLED === true) {
        this.currentSha = await this.getShaFromDb();
      }

      const githubSha = await this.fetchPoolsSha(); // Fetch pools-v2.json sha from github
      if (githubSha === null) {
        return;
      }

      logger.debug(`pools-v2.json sha | Current: ${this.currentSha} | Github: ${githubSha}`, this.tag);
      if (this.currentSha !== null && this.currentSha === githubSha) {
        return;
      }

      // See backend README for more details about the mining pools update process
      if (this.currentSha !== null && // If we don't have any mining pool, download it at least once
        config.MEMPOOL.AUTOMATIC_POOLS_UPDATE !== true && // Automatic pools update is disabled
        !process.env.npm_config_update_pools // We're not manually updating mining pool
      ) {
        logger.warn(`Updated mining pools data is available (${githubSha}) but AUTOMATIC_POOLS_UPDATE is disabled`, this.tag);
        logger.info(`You can update your mining pools using the --update-pools command flag. You may want to clear your nginx cache as well if applicable`, this.tag);
        return;
      }

      const network = config.SOCKS5PROXY.ENABLED ? 'tor' : 'clearnet';
      if (this.currentSha === null) {
        logger.info(`Downloading pools-v2.json for the first time from ${this.poolsUrl} over ${network}`, this.tag);
      } else {
        logger.warn(`pools-v2.json is outdated, fetching latest from ${this.poolsUrl} over ${network}`, this.tag);
      }
      const poolsJson = await this.query(this.poolsUrl);
      if (poolsJson === undefined) {
        return;
      }
      poolsParser.setMiningPools(poolsJson);

      if (config.DATABASE.ENABLED === false) { // Don't run db operations
        logger.info(`Mining pools-v2.json (${githubSha}) import completed (no database)`, this.tag);
        return;
      }

      try {
        await DB.query('START TRANSACTION;');
        await this.updateDBSha(githubSha);
        await poolsParser.migratePoolsJson();
        await DB.query('COMMIT;');
      } catch (e) {
        logger.err(`Could not migrate mining pools, rolling back. Exception: ${JSON.stringify(e)}`, this.tag);
        await DB.query('ROLLBACK;');
      }
      logger.info(`Mining pools-v2.json (${githubSha}) import completed`, this.tag);

    } catch (e) {
      // fast-forward lastRun to 10 minutes before the next scheduled update
      this.lastRun = now - Math.max(config.MEMPOOL.POOLS_UPDATE_DELAY - 600, 600);
      logger.err(`PoolsUpdater failed. Will try again in 10 minutes. Exception: ${JSON.stringify(e)}`, this.tag);
    }
  }

  /**
   * Fetch our latest pools-v2.json sha from the db
   */
  private async updateDBSha(githubSha: string): Promise<void> {
    this.currentSha = githubSha;
    if (config.DATABASE.ENABLED === true) {
      try {
        await DB.query('DELETE FROM state where name="pools_json_sha"');
        await DB.query(`INSERT INTO state VALUES('pools_json_sha', NULL, '${githubSha}')`);
      } catch (e) {
        logger.err('Cannot save github pools-v2.json sha into the db. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
      }
    }
  }

  /**
   * Fetch our latest pools-v2.json sha from the db
   * @asyncSafe
   */
  public async getShaFromDb(): Promise<string | null> {
    try {
      const [rows]: any[] = await DB.query('SELECT string FROM state WHERE name="pools_json_sha"');
      return (rows.length > 0 ? rows[0].string : null);
    } catch (e) {
      logger.err('Cannot fetch pools-v2.json sha from db. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
      return null;
    }
  }

  /**
   * Fetch our latest pools-v2.json sha from github
   * @asyncUnsafe
   */
  private async fetchPoolsSha(): Promise<string | null> {
    const response = await this.query(this.treeUrl);

    if (response !== undefined) {
      for (const file of response['tree']) {
        if (file['path'] === 'pools-v2.json') {
          return file['sha'];
        }
      }
    }

    logger.err(`Cannot find "pools-v2.json" in git tree (${this.treeUrl})`, this.tag);
    return null;
  }

  /**
   * Http request wrapper
   * @asyncUnsafe
   */
  private async query(path): Promise<any[] | undefined> {
    type axiosOptions = {
      headers: {
        'User-Agent': string
      };
      timeout: number;
      httpsAgent?: https.Agent;
    };
    const setDelay = (secs: number = 1): Promise<void> => new Promise(resolve => setTimeout(() => resolve(), secs * 1000));
    const axiosOptions: axiosOptions = {
      headers: {
        'User-Agent': (config.MEMPOOL.USER_AGENT === 'mempool') ? `mempool/v${backendInfo.getBackendInfo().version}` : `${config.MEMPOOL.USER_AGENT}`
      },
      timeout: config.SOCKS5PROXY.ENABLED ? 30000 : 10000
    };
    let retry = 0;

    while (retry < config.MEMPOOL.EXTERNAL_MAX_RETRY) {
      try {
        if (config.SOCKS5PROXY.ENABLED) {
          const socksOptions: any = {
            agentOptions: {
              keepAlive: true,
            },
            hostname: config.SOCKS5PROXY.HOST,
            port: config.SOCKS5PROXY.PORT
          };

          if (config.SOCKS5PROXY.USERNAME && config.SOCKS5PROXY.PASSWORD) {
            socksOptions.username = config.SOCKS5PROXY.USERNAME;
            socksOptions.password = config.SOCKS5PROXY.PASSWORD;
          } else {
            // Retry with different tor circuits https://stackoverflow.com/a/64960234
            socksOptions.username = `circuit${retry}`;
          }

          axiosOptions.httpsAgent = new SocksProxyAgent(socksOptions);
        }

        const data: AxiosResponse = await axios.get(path, axiosOptions);
        if (data.statusText === 'error' || !data.data) {
          throw new Error(`Could not fetch data from ${path}, Error: ${data.status}`);
        }
        return data.data;
      } catch (e) {
        logger.err('Could not connect to Github. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
        retry++;
      }
      await setDelay(config.MEMPOOL.EXTERNAL_RETRY_INTERVAL);
    }
    return undefined;
  }
}

export default new PoolsUpdater();
