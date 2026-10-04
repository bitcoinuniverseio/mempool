import { FractalEvidenceError } from './fractal.errors';

export const FRACTAL_TESTNET_GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
export const FRACTAL_TESTNET_BLOCK_ONE = '000000000021b22bb6a9718e5db62fca1eb2ac6e34535e70c67b374dcb29c570';
export interface FractalSourceProfile {
  network: 'fractal-testnet';
  release: '0.4.0';
  sourceRevision: '8c22167f04250c7dd03afe46af4158bd08001183';
  configurationSha256: string;
  binarySha256: string;
}
export interface FractalCheckpoint {
  height: number; hash: string;
}
export interface FractalObservation {
  schema: 'fractal-observation-v1';
  network: 'fractal-testnet'; genesisHash: string; blockOneHash: string;
  checkpoint: FractalCheckpoint; ready: boolean; observedAt: string;
  source: FractalSourceProfile;
}
export type FractalRpc = (method: string, params: unknown[], signal: AbortSignal) => Promise<unknown>;
export function evidence(condition: unknown, code = 'invalid-fractal-source', status = 503): asserts condition {
  if (!condition) { throw new FractalEvidenceError(code, 'The selected Fractal source did not establish the required observation.', status); }
}
export function object(value: unknown): Record<string, unknown> {
  evidence(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
export function height(value: unknown): number {
  evidence(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  return value;
}
export function hash(value: unknown): string {
  evidence(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value));
  return value;
}
export function atomic(value: unknown): string {
  evidence(typeof value === 'number' || typeof value === 'string');
  const rendered = typeof value === 'number' && value >= 0 && value < 1 ? value.toFixed(8) : String(value);
  evidence(typeof value !== 'number' || (Number.isFinite(value) && Number(rendered) === value), 'invalid-fractal-amount');
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/.exec(rendered);
  evidence(match, 'invalid-fractal-amount');
  return (BigInt(match[1]) * 100000000n + BigInt((match[2] || '').padEnd(8, '0'))).toString();
}
/** Preserve native JSON monetary lexemes before JavaScript number rounding. */
export function parseFractalRpcJson(text: string): unknown {
  let output = ''; let index = 0;
  while (index < text.length) {
    if (text[index] !== '"') { output += text[index++]; continue; }
    const start = index++;
    while (index < text.length) {
      if (text[index] === '\\') { index += 2; continue; }
      if (text[index++] === '"') { break; }
    }
    const token = text.slice(start, index);
    output += token;
    if (JSON.parse(token) !== 'value') { continue; }
    const amount = /^(\s*:\s*)([0-9]+(?:\.[0-9]+)?)(?=\s*[,}])/.exec(text.slice(index));
    if (amount) { output += amount[1] + JSON.stringify(amount[2]); index += amount[0].length; }
  }
  return JSON.parse(output);
}
export function inputHash(value: string): void {
  evidence(/^[0-9a-f]{64}$/.test(value), 'invalid-fractal-input', 400);
}

/** Explicit authenticated loopback transport; credentials never appear in URLs/errors. */
export function createFractalRpc(url: string, credentials: () => Promise<string>, fetcher: typeof fetch = fetch): FractalRpc {
  const endpoint = new URL(url);
  evidence(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname)
    && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'invalid-fractal-configuration');
  return /** @asyncUnsafe Transport failures propagate to the native attempt error boundary. */ async (method, params, signal) => {
    evidence(['getblockchaininfo', 'getnetworkinfo', 'getblockhash', 'getblockheader', 'getblock', 'getrawtransaction', 'getmempoolinfo', 'getindexinfo'].includes(method), 'invalid-fractal-rpc-method', 400);
    const auth = await credentials();
    evidence(auth.includes(':') && !/[\r\n]/.test(auth), 'invalid-fractal-configuration');
    evidence(!signal.aborted, 'fractal-source-timeout', 504);
    const response = await fetcher(endpoint, {
      method: 'POST', signal, redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(auth).toString('base64') },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'fractal-read', method, params }),
    });
    evidence(response.status === 200 || response.status === 500, 'unavailable-fractal-node');
    const reader = response.body?.getReader();
    evidence(reader);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      let finished = false;
      while (!finished) {
        const next = await reader.read();
        if (next.done) { finished = true; continue; }
        size += next.value.byteLength;
        evidence(size <= 16 * 1024 * 1024, 'oversized-fractal-response');
        chunks.push(next.value);
      }
      const envelope = object(parseFractalRpcJson(Buffer.concat(chunks).toString('utf8')));
      evidence(envelope.id === 'fractal-read');
      if (envelope.error) {
        const error = object(envelope.error);
        if (error.code === -5 || error.code === -8) { return null; }
        throw new FractalEvidenceError('unavailable-fractal-node', 'Native Fractal RPC rejected the read.');
      }
      evidence(response.status === 200 && Object.prototype.hasOwnProperty.call(envelope, 'result'));
      return envelope.result;
    } finally {
      try { await reader.cancel(); } catch { /* Preserve the original observation failure if cancellation also fails. */ }
    }
  };
}

export class FractalNativeReader {
  constructor(public readonly profile: FractalSourceProfile, private readonly rpc: FractalRpc, private readonly deadlineMs = 15000) {
    evidence(profile.network === 'fractal-testnet' && profile.release === '0.4.0'
      && profile.sourceRevision === '8c22167f04250c7dd03afe46af4158bd08001183'
      && /^[0-9a-f]{64}$/.test(profile.configurationSha256) && /^[0-9a-f]{64}$/.test(profile.binarySha256)
      && Number.isInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 15000, 'invalid-fractal-configuration');
  }
  public async attempt<T>(read: (signal: AbortSignal, observation: FractalObservation) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.deadlineMs);
    try {
      const result = await Promise.race([
        (async (): Promise<T> => {
          const observation = await this.observe(controller.signal);
          const value = await read(controller.signal, observation);
          const final = await this.observe(controller.signal);
          evidence(final.ready === observation.ready && final.checkpoint.height >= observation.checkpoint.height, 'fractal-context-changed', 409);
          evidence(await this.call('getblockhash', [observation.checkpoint.height], controller.signal) === observation.checkpoint.hash, 'fractal-context-changed', 409);
          return value;
        })(),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new FractalEvidenceError('fractal-source-timeout', 'The native Fractal read exceeded its total deadline.', 504)), { once: true })),
      ]);
      return result;
    } finally { clearTimeout(timeout); controller.abort(); }
  }
  public async call(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
    evidence(!signal.aborted, 'fractal-source-timeout', 504);
    try { return await this.rpc(method, params, signal); } catch (error) {
      if (error instanceof FractalEvidenceError) { throw error; }
      throw new FractalEvidenceError(signal.aborted ? 'fractal-source-timeout' : 'unavailable-fractal-node', 'The native Fractal read could not be completed.', signal.aborted ? 504 : 503);
    }
  }
  /** @asyncUnsafe Identity/readiness failures propagate to the bounded attempt boundary. */
  private async observe(signal: AbortSignal): Promise<FractalObservation> {
    const chain = object(await this.call('getblockchaininfo', [], signal));
    const network = object(await this.call('getnetworkinfo', [], signal));
    evidence(chain.chain === 'test' && network.version === 400 && network.subversion === '/Satoshi:0.4.0/', 'wrong-fractal-source');
    const genesis = await this.call('getblockhash', [0], signal);
    const one = await this.call('getblockhash', [1], signal);
    evidence(genesis === FRACTAL_TESTNET_GENESIS && one === FRACTAL_TESTNET_BLOCK_ONE, 'wrong-fractal-source');
    evidence(typeof chain.initialblockdownload === 'boolean' && height(chain.headers) >= height(chain.blocks));
    const checkpoint = { height: height(chain.blocks), hash: hash(chain.bestblockhash) };
    evidence(await this.call('getblockhash', [checkpoint.height], signal) === checkpoint.hash, 'fractal-context-changed', 409);
    return { schema: 'fractal-observation-v1', network: 'fractal-testnet', genesisHash: hash(genesis), blockOneHash: hash(one),
      checkpoint, ready: !chain.initialblockdownload, observedAt: new Date().toISOString(), source: this.profile };
  }
}
