import config from '../../config';
const bitcoin = require('../../rpc-api/index');
import { BitcoinRpcCredentials } from './bitcoin-api-abstract-factory';
import { rpcPoolLimits } from '../../rpc-api/pool-limits';

const limits = rpcPoolLimits(config.CORE_RPC);

const nodeRpcCredentials: BitcoinRpcCredentials = {
  host: config.CORE_RPC.HOST,
  port: config.CORE_RPC.PORT,
  user: config.CORE_RPC.USERNAME,
  pass: config.CORE_RPC.PASSWORD,
  timeout: config.CORE_RPC.TIMEOUT,
  cookie: config.CORE_RPC.COOKIE ? config.CORE_RPC.COOKIE_PATH : undefined,
};

// Interactive address reads must not wait behind bulk indexing batches.
// Both pools use the same owned endpoint and existing reader credentials.
export const addressBitcoinClient = new bitcoin.Client({ ...nodeRpcCredentials, maxSockets: limits.address });
export default new bitcoin.Client({ ...nodeRpcCredentials, maxSockets: limits.bulk });
