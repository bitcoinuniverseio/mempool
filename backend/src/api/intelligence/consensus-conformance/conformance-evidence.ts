import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { HistoryStore } from '../time-machine/history-store';
export class ConformanceEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 503
  ) {
    super(message);
  }
}
export const CAMPAIGN_LIMITS = {
  campaigns: 20,
  cases: 640,
  replays: 64,
  inputs: 32,
  inputBytes: 4096,
  timeoutMs: 30000,
  processOutputBytes: 1048576,
} as const;
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class ConformanceStore {
  private readonly store: HistoryStore;
  private readonly key: Buffer;
  constructor(path: string, keyFile: string) {
    if (statSync(keyFile).size !== 32)
      throw new ConformanceEvidenceError('invalid-artifact-key', 'Campaign authentication key must contain 32 bytes.');
    this.key = readFileSync(keyFile);
    this.store = new HistoryStore(path, 'conformance-local-v1');
  }
  private tag(body: string) {
    return createHmac('sha256', this.key).update(body).digest();
  }
  read(): any | null {
    const value: any = this.store.read();
    if (!value) return null;
    if (
      value.schema !== 'conformance-auth-v1' ||
      typeof value.body !== 'string' ||
      Buffer.byteLength(value.body) > 16 * 1024 * 1024 ||
      typeof value.mac !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.mac) ||
      !timingSafeEqual(this.tag(value.body), Buffer.from(value.mac, 'hex'))
    )
      throw new ConformanceEvidenceError(
        'artifact-authentication-failed',
        'Persisted campaign artifact authentication failed.'
      );
    return JSON.parse(value.body);
  }
  async write(value: any) {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 16 * 1024 * 1024)
      throw new ConformanceEvidenceError('artifact-capacity', 'Campaign artifact storage capacity reached.', 429);
    await this.store.write({ schema: 'conformance-auth-v1', body, mac: this.tag(body).toString('hex') });
  }
  close() {
    this.store.close();
    this.key.fill(0);
  }
}
