import axios from 'axios';
import { createHash } from 'crypto';
import { constants, promises as fs } from 'fs';
import { isAbsolute } from 'path';
import { IncidentHeader, IncidentObservation, IncidentProfile, IncidentSourceProfile } from './incident-types';
import { VerificationEvidenceError } from './verification-errors';

const HASH = /^[0-9a-f]{64}$/;
const id = /^[a-zA-Z0-9_-]{1,80}$/;
export const incidentFailure = (code: string, status = 503): VerificationEvidenceError =>
  new VerificationEvidenceError(code, 'The registered incident observation could not establish its bounded source or persistence contract.', status);
export function validateIncidentProfile(value: any): IncidentProfile {
  if (value?.schema !== 'universe-incident-profile-v1' || !['mainnet', 'testnet', 'testnet4', 'signet'].includes(value.network)
    || !Number.isSafeInteger(value.stale_after_seconds) || value.stale_after_seconds < 30 || value.stale_after_seconds > 86400
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 4) throw incidentFailure('invalid-incident-profile');
  const sources: IncidentSourceProfile[] = value.sources.map((source: any) => {
    if (!source || typeof source.source_id !== 'string' || !id.test(source.source_id) || typeof source.independence_id !== 'string' || !id.test(source.independence_id) || source.implementation !== 'bitcoin-core'
      || source.source_revision !== null && (typeof source.source_revision !== 'string' || !/^[0-9a-f]{40}$/.test(source.source_revision))
      || ![source.binary_sha256, source.configuration_sha256, source.genesis_hash, source.block_one_hash].every(v => typeof v === 'string' && HASH.test(v))
      || (value.network === 'signet' ? typeof source.signet_challenge !== 'string' || !/^(?:[0-9a-f]{2}){1,10000}$/.test(source.signet_challenge) : source.signet_challenge !== null)) throw incidentFailure('invalid-incident-profile');
    return { source_id: source.source_id, independence_id: source.independence_id, implementation: source.implementation, source_revision: source.source_revision,
      binary_sha256: source.binary_sha256, configuration_sha256: source.configuration_sha256, genesis_hash: source.genesis_hash,
      block_one_hash: source.block_one_hash, signet_challenge: source.signet_challenge };
  });
  if (new Set(sources.map(s => s.source_id)).size !== sources.length || sources.some(s => s.genesis_hash !== sources[0].genesis_hash || s.block_one_hash !== sources[0].block_one_hash || s.signet_challenge !== sources[0].signet_challenge)) throw incidentFailure('invalid-incident-profile');
  return { schema: value.schema, network: value.network, stale_after_seconds: value.stale_after_seconds, sources };
}
export const incidentProfileHash = (profile: IncidentProfile): string => createHash('sha256').update(JSON.stringify(profile)).digest('hex');

/** Selected operator files only; bounded no-follow reads never disclose content in errors. @asyncUnsafe */
export async function readIncidentProtected(file: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (!isAbsolute(file) || signal.aborted) throw incidentFailure('unavailable-incident-registration');
  const before = await fs.lstat(file);
  const valid = (s: typeof before) => s.isFile() && !s.isSymbolicLink() && s.size > 0 && s.size <= limit
    && (typeof process.getuid !== 'function' || s.uid === process.getuid() && (s.mode & 0o077) === 0);
  if (!valid(before)) throw incidentFailure('unavailable-incident-registration');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!valid(opened) || opened.ino !== before.ino || opened.dev !== before.dev) throw incidentFailure('unavailable-incident-registration');
    const bytes = Buffer.alloc(limit + 1), read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
    if (signal.aborted || !valid(after) || after.ino !== opened.ino || after.dev !== opened.dev || after.mtimeMs !== opened.mtimeMs || after.size !== read.bytesRead || read.bytesRead > limit) throw incidentFailure('unavailable-incident-registration');
    return bytes.subarray(0, read.bytesRead);
  } finally { await handle.close(); }
}
export interface IncidentCoreReader { call(method: string, params: unknown[], signal: AbortSignal): Promise<any> }
export class IncidentRpcReader implements IncidentCoreReader {
  constructor(private readonly origin: string, private readonly cookie: string) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw incidentFailure('invalid-incident-registration');
  }
  /** @asyncUnsafe Native transport and protected-file failures propagate to the monitor. */
  async call(method: string, params: unknown[], signal: AbortSignal): Promise<any> {
    if (signal.aborted || !['getblockchaininfo', 'getblockhash', 'getblockheader'].includes(method)) throw incidentFailure('invalid-incident-method');
    const bytes = await readIncidentProtected(this.cookie, 4096, signal), credential = bytes.toString('utf8').trim();
    if (!/^[^:\r\n]+:[^\r\n]+$/.test(credential)) throw incidentFailure('invalid-incident-registration');
    try {
      const response = await axios.post(this.origin, { jsonrpc: '2.0', id: 'incident', method, params }, {
        signal, timeout: 5000, maxContentLength: 65536, maxBodyLength: 4096, proxy: false, maxRedirects: 0,
        headers: { Authorization: 'Basic ' + Buffer.from(credential).toString('base64') },
      });
      if (response.data?.id !== 'incident' || response.data.error || !Object.prototype.hasOwnProperty.call(response.data, 'result')) throw incidentFailure('invalid-incident-rpc');
      return response.data.result;
    } catch { throw incidentFailure('incident-source-unavailable'); }
  }
}
/** Hash raw native headers, and fence the entire retained suffix with two fresh tip reads. @asyncUnsafe */
export async function observeIncidentSource(profile: IncidentProfile, source: IncidentSourceProfile, reader: IncidentCoreReader, signal: AbortSignal, now: () => number = Date.now): Promise<IncidentObservation> {
  /** @asyncUnsafe Source failures propagate without committing an observation. */
  const call = async (method: string, params: unknown[]) => { if (signal.aborted) throw incidentFailure('incident-deadline', 504); const result = await reader.call(method, params, signal); if (signal.aborted) throw incidentFailure('incident-deadline', 504); return result; };
  const before = await call('getblockchaininfo', []);
  const chain = profile.network === 'mainnet' ? 'main' : profile.network === 'testnet' ? 'test' : profile.network;
  const validTip = (v: any) => v?.chain === chain && v.initialblockdownload === false && Number.isSafeInteger(v.blocks) && v.blocks >= 1 && typeof v.bestblockhash === 'string' && HASH.test(v.bestblockhash)
    && (chain !== 'signet' || v.signet_challenge === source.signet_challenge);
  if (!validTip(before)) throw incidentFailure('incident-source-identity');
  const [genesis, first] = await Promise.all([call('getblockhash', [0]), call('getblockhash', [1])]);
  if (genesis !== source.genesis_hash || first !== source.block_one_hash) throw incidentFailure('incident-source-identity');
  const headers: IncidentHeader[] = [];
  for (let start = Math.max(0, before.blocks - 127); start <= before.blocks; start += 4) {
    const heights = Array.from({ length: Math.min(4, before.blocks - start + 1) }, (_, i) => start + i);
    /** @asyncUnsafe Header acquisition failures reject the bounded batch. */
    const readHeader = async (height: number) => {
      const hash = await call('getblockhash', [height]), raw = await call('getblockheader', [hash, false]);
      if (typeof hash !== 'string' || !HASH.test(hash) || typeof raw !== 'string' || !/^[0-9a-f]{160}$/.test(raw)) throw incidentFailure('invalid-incident-header');
      const bytes = Buffer.from(raw, 'hex');
      const actual = createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest().reverse().toString('hex');
      if (actual !== hash) throw incidentFailure('invalid-incident-header');
      return { height, hash, parent: Buffer.from(bytes.subarray(4, 36)).reverse().toString('hex'), timestamp: bytes.readUInt32LE(68) };
    };
    const batch = await Promise.all(heights.map(readHeader)); headers.push(...batch);
  }
  for (let i = 1; i < headers.length; i++) if (headers[i].parent !== headers[i - 1].hash) throw incidentFailure('incident-source-changed', 409);
  const after = await call('getblockchaininfo', []);
  if (!validTip(after) || before.blocks !== after.blocks || before.bestblockhash !== after.bestblockhash || headers[headers.length - 1].hash !== after.bestblockhash) throw incidentFailure('incident-source-changed', 409);
  return { source_id: source.source_id, observed_at_utc: new Date(now()).toISOString(), headers };
}
