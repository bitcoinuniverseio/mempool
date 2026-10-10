import * as fs from 'fs';
import zlib = require('zlib');
import { Transform } from 'stream';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { HistoryStore, HistoryWriteCleanupError } from './history-store';
import { gracefulShutdown } from '../../graceful-shutdown';

describe('streamed history durability remains part of native graceful drain', () => {
  let directory: string;
  let filename: string;
  let store: HistoryStore;
  const gzipDescriptor = Object.getOwnPropertyDescriptor(zlib, 'createGzip')!;
  const originalGzip = zlib.createGzip;
  const setGzip = (value: typeof zlib.createGzip) => Object.defineProperty(zlib, 'createGzip', { ...gzipDescriptor, value });
  beforeEach(async () => {
    directory = fs.mkdtempSync(join(tmpdir(), 'history-streamed-drain-'));
    filename = join(directory, 'state.gz'); store = new HistoryStore(filename, 'signet');
    await store.write({ previous: true });
  });
  afterEach(() => {
    setGzip(originalGzip); jest.restoreAllMocks(); store.close();
    const resolved = fs.realpathSync(directory);
    if (dirname(resolved) !== fs.realpathSync(tmpdir()) || !basename(resolved).startsWith('history-streamed-drain-')) throw new Error('Refuse cleanup outside owned fixture.');
    fs.rmSync(resolved, { recursive: true });
  });
  it('waits for the actual gzip pipeline past five seconds before publishing and releasing resources', async () => {
    const previous = fs.readFileSync(filename);
    let release!: () => void;
    let reached!: () => void;
    const atFlush = new Promise<void>(resolve => { reached = resolve; });
    setGzip(((...args: any[]) => {
      const gzip = (originalGzip as any)(...args);
      const flush = gzip._flush;
      gzip._flush = function(callback: () => void) { release = () => flush.call(this, callback); reached(); };
      return gzip;
    }) as typeof zlib.createGzip);
    const write = store.write({ next: true, unicode: '🌍'.repeat(10000) });
    const releaseResources = jest.fn(async () => undefined);
    const shutdown = gracefulShutdown({ stopAdmission: () => undefined, drainProducers: async () => undefined,
      drainDatabase: async () => undefined, flushHistory: () => write, releaseResources });
    let reachedTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([atFlush, new Promise<never>((_, reject) => { reachedTimeout = setTimeout(() => reject(new Error('Gzip flush not reached')), 2000); })]);
      if (reachedTimeout) clearTimeout(reachedTimeout);
      await new Promise(resolve => setTimeout(resolve, 5100));
      expect(releaseResources).not.toHaveBeenCalled(); expect(fs.readFileSync(filename)).toEqual(previous);
    } finally { if (reachedTimeout) clearTimeout(reachedTimeout); release?.(); }
    await shutdown; expect(releaseResources).toHaveBeenCalledTimes(1);
    expect(store.read()).toEqual({ next: true, unicode: '🌍'.repeat(10000) });
  }, 15000);
  it.each(['compression', 'fsync', 'fsync-and-close'])('preserves previous bytes and all causal failures after %s failure', async failure => {
    const previous = fs.readFileSync(filename);
    let injected = false;
    if (failure === 'compression') {
      setGzip((() => new Transform({ transform(_chunk, _encoding, callback) {
        injected = true; callback(new Error('controlled compression failure'));
      } })) as unknown as typeof zlib.createGzip);
    } else {
      const originalOpen = fs.promises.open;
      jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
        const handle = await originalOpen(...args);
        if (args[1] === 'wx') {
          handle.sync = async () => { injected = true; throw new Error('controlled fsync failure'); };
          if (failure === 'fsync-and-close') {
            const close = handle.close.bind(handle);
            handle.close = async () => { await close(); throw new Error('controlled close failure'); };
          }
        }
        return handle;
      });
    }
    const releaseResources = jest.fn(async () => undefined);
    let observed: any;
    await expect(gracefulShutdown({ stopAdmission: () => undefined, drainProducers: async () => undefined,
      drainDatabase: async () => undefined, flushHistory: () => store.write({ unsafe: true }), releaseResources })
      .catch(error => { observed = error; throw error; })).rejects.toThrow();
    expect(injected).toBe(true); expect(releaseResources).not.toHaveBeenCalled();
    expect(fs.readFileSync(filename)).toEqual(previous);
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.tmp'))).toEqual([]);
    if (failure === 'fsync') { expect(observed.message).toBe('controlled fsync failure'); }
    else {
      expect(observed).toBeInstanceOf(HistoryWriteCleanupError);
      expect(observed.primary.message).toBe(failure === 'compression' ? 'controlled compression failure' : 'controlled fsync failure');
      if (failure === 'compression') { expect(observed.cleanup.code).toBe('EBADF'); }
      else { expect(observed.cleanup.message).toBe('controlled close failure'); }
    }
  });
});
