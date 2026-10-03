import axios from 'axios';
import { readFileSync } from 'fs';
import { ZcashPrivacyEvidenceError } from './zcash-source-error';

export interface ZcashPublicReader {
  call(method: string, params: unknown[], signal?: AbortSignal): Promise<any>;
  ready?(signal?: AbortSignal): Promise<boolean>;
  implementation?: 'zebra' | 'zcashd';
}

// Exact v7.0.0-rc.0 main/test checkpoint lists, source 6d1e414d6f55e4180d0e47baaa934bf97d5b4fec.
export const ZCASH_GENESIS: Readonly<Record<string, string>> = {
  mainnet: '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08',
  testnet: '05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38',
};

// Pinned Zebra 6d1e414 implementation constants; NU7 mainnet is unassigned.
const BRANCHES = ['5ba81b19', '76b809bb', '2bb40e60', 'f5b9230b', 'e9ff75a6', 'c2d6d0b4', 'c8e71055', '4dec4df0', '5437f330', '37a5165b', '77190ad9'];
const HEIGHTS: Readonly<Record<string, readonly number[]>> = {
  mainnet: [347500,419200,653600,903000,1046400,1687104,2726400,3146400,3364600,3428143],
  testnet: [207500,280000,584000,903800,1028500,1842420,2976000,3536500,4052000,4134000,4465026],
};
export function zcashBranchAt(network: string, height: number): string {
  const heights = HEIGHTS[network];
  if (!heights || !Number.isSafeInteger(height) || height < 0) throw new ZcashPrivacyEvidenceError('invalid-checkpoint', 'Invalid Zcash branch checkpoint.');
  let branch = '00000000';
  for (let i = 0; i < heights.length; i++) {if (height >= heights[i]) branch = BRANCHES[i];}
  return branch;
}

function configuredOrigin(name: string): URL {
  const origin = process.env[name];
  if (!origin) throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', 'An owned Zcash source is not configured.');
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid source');
    return url;
  } catch { throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', 'The owned Zcash source configuration is invalid.'); }
}

/** Operator-configured endpoints only. Browser inputs never choose source or RPC method. */
export const ownedZcashReader: ZcashPublicReader = {
  get implementation(): 'zebra' | 'zcashd' {
    if (process.env.UNIVERSE_ZCASH_RPC_IMPLEMENTATION === 'zebra') return 'zebra';
    if (process.env.UNIVERSE_ZCASH_RPC_IMPLEMENTATION === undefined || process.env.UNIVERSE_ZCASH_RPC_IMPLEMENTATION === 'zcashd') return 'zcashd';
    throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', 'The configured Zcash implementation is unsupported.');
  },
  async call(method, params, signal) {
    const url = configuredOrigin('UNIVERSE_ZCASH_RPC_ORIGIN');
    try {
      const cookiePath = process.env.UNIVERSE_ZCASH_RPC_COOKIE_FILE;
      const credentials = cookiePath ? readFileSync(cookiePath, 'utf8').trim() : `${process.env.UNIVERSE_ZCASH_RPC_USER || ''}:${process.env.UNIVERSE_ZCASH_RPC_PASSWORD || ''}`;
      const response = await axios.post(url.toString(), {jsonrpc: '1.0', id: 'public-zcash-evidence', method, params}, {
        headers: {Authorization: 'Basic ' + Buffer.from(credentials).toString('base64')}, signal, timeout: 5000,
        maxContentLength: 4100000, maxBodyLength: 1000, maxRedirects: 0, proxy: false,
      });
      if (response.data?.error || !Object.prototype.hasOwnProperty.call(response.data || {}, 'result')) throw Error('Invalid RPC response');
      return response.data.result;
    } catch { throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', 'The owned Zcash node could not return public evidence.'); }
  },
  async ready(signal) {
    if (ownedZcashReader.implementation !== 'zebra') throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'This source requires its explicit RPC sync state.');
    // A bare testnet /ready bypasses sync by default. An operator must bind the
    // strict health configuration in source qualification before enabling it.
    if (process.env.UNIVERSE_ZCASH_HEALTH_TEST_NETWORKS_ENFORCED !== 'true') throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'Strict Zcash health readiness is not configured.');
    const url = configuredOrigin('UNIVERSE_ZCASH_HEALTH_ORIGIN');
    if (url.pathname !== '/') throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'The owned Zcash health endpoint is invalid.');
    url.pathname = '/ready';
    try {
      const response = await axios.get(url.toString(), {signal, timeout: 3000, maxContentLength: 1024, maxRedirects: 0, proxy: false, validateStatus: status => status === 200 || status === 503});
      return response.status === 200;
    } catch { throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'The owned Zcash readiness source could not answer.'); }
  },
};

/** zcashd supplies an explicit IBD flag; Zebra supplies separately enforced health. */
/** @asyncUnsafe Propagates typed evidence failures to the mounted route handler. */
export async function zcashSourceReady(reader: ZcashPublicReader, info: any, signal?: AbortSignal): Promise<boolean> {
  return reader.implementation === 'zebra' ? reader.ready !== undefined && await reader.ready(signal) : info?.initial_block_download_complete === true;
}
