import fs = require('fs');
import { join } from 'path';
import { tmpdir } from 'os';
import { readRbfSnapshot, validateRbfSnapshot, RBF_SNAPSHOT_MAX_BYTES, RbfSnapshotError } from '../api/rbf-snapshot';

const id = (n: number): string => n.toString(16).padStart(64, '0');
const snapshot = (count = 2): any => ({ network: 'signet', rbfCacheSchemaVersion: 1, rbf: {
  txs: Array.from({ length: count }, (_, n) => [id(n), { txid: id(n), weight: 400, vin: [{ sequence: 1 }], vout: [{ value: 1 }] }]),
  trees: [{ root: id(0), [id(0)]: { tx: id(0), time: 123.5, fullRbf: false, replaces: [id(1)] },
    [id(1)]: { tx: id(1), time: 122, fullRbf: false, replaces: [] } }],
  expiring: Array.from({ length: count }, (_, n) => [id(n), 1000000]),
} });

describe('RBF snapshot allocation admission and graph closure', () => {
  let directory: string;
  let file: string;
  beforeEach(() => { directory = fs.mkdtempSync(join(tmpdir(), 'rbf-bound-')); file = join(directory, 'rbfcache.json'); });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
  it('rejects the observed 320675973-byte size before any read/decode and preserves it', () => {
    const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 320675973); fs.closeSync(fd);
    const read = jest.spyOn(fs, 'readSync');
    expect(() => readRbfSnapshot(file, 'signet')).toThrow('snapshot-oversize');
    expect(read).not.toHaveBeenCalled(); expect(fs.statSync(file).size).toBe(320675973);
  });
  it('accepts an exact-byte boundary but rejects one byte less before reading', () => {
    const text = JSON.stringify(snapshot()); fs.writeFileSync(file, text);
    expect(readRbfSnapshot(file, 'signet', Buffer.byteLength(text))?.txs).toHaveLength(2);
    const read = jest.spyOn(fs, 'readSync');
    expect(() => readRbfSnapshot(file, 'signet', Buffer.byteLength(text) - 1)).toThrow('snapshot-oversize');
    expect(read).not.toHaveBeenCalled();
  });
  it('validates the observed record count without pretending synthetic bytes are native history', () => {
    const value = snapshot(2348); fs.writeFileSync(file, JSON.stringify(value));
    expect(readRbfSnapshot(file, 'signet')?.txs).toHaveLength(2348);
  });
  it('returns absent only for an absent file, not malformed/read failures', () => {
    expect(readRbfSnapshot(file, 'signet')).toBeNull(); fs.writeFileSync(file, '{');
    expect(() => readRbfSnapshot(file, 'signet')).toThrow('snapshot-invalid');
    expect(fs.readFileSync(file, 'utf8')).toBe('{');
  });
  it('rejects unsafe bounds before filesystem operations', () => {
    const open = jest.spyOn(fs, 'openSync');
    for (const limit of [0, -1, 1.5, NaN, Infinity, RBF_SNAPSHOT_MAX_BYTES + 1]) {
      expect(() => readRbfSnapshot(file, 'signet', limit)).toThrow(RbfSnapshotError);
    }
    expect(open).not.toHaveBeenCalled();
  });
  it('closes its descriptor when content grows during the bounded read', () => {
    fs.writeFileSync(file, JSON.stringify(snapshot())); const original = fs.readSync;
    let appended = false; const close = jest.spyOn(fs, 'closeSync');
    jest.spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
      if (!appended) { appended = true; fs.appendFileSync(file, ' '); }
      return (original as any)(...args);
    }) as any);
    expect(() => readRbfSnapshot(file, 'signet')).toThrow('snapshot-changed');
    expect(close).toHaveBeenCalled();
  });
  it('rejects inode substitution between pathname metadata and open', () => {
    fs.writeFileSync(file, JSON.stringify(snapshot())); const original = fs.openSync;
    jest.spyOn(fs, 'openSync').mockImplementation(((path: any, flags: any, ...rest: any[]) => {
      if (path === file && flags === (fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))) {
        fs.renameSync(file, file + '.old'); fs.writeFileSync(file, JSON.stringify(snapshot()));
      }
      return (original as any)(path, flags, ...rest);
    }) as any);
    expect(() => readRbfSnapshot(file, 'signet')).toThrow('snapshot-changed');
  });
  it('rejects foreign network/schema and malformed graph without partial restore', () => {
    for (const alter of [
      (v: any) => { v.network = 'mainnet'; },
      (v: any) => { v.rbfCacheSchemaVersion = 2; },
      (v: any) => { v.rbf.txs.push(v.rbf.txs[0]); },
      (v: any) => { v.rbf.trees[0][id(1)].replaces = [id(0)]; },
      (v: any) => { v.rbf.trees[0][id(0)].replaces = [id(2)]; },
      (v: any) => { v.rbf.trees[0][id(2)] = v.rbf.trees[0][id(1)]; },
      (v: any) => { v.rbf.expiring.push([id(9), 100]); },
      (v: any) => { v.rbf.expiring[0][1] = -1; },
      (v: any) => { v.rbf.txs[0][1].vin[0].sequence = 'bad'; },
    ]) { const value = snapshot(); alter(value); expect(() => validateRbfSnapshot(value, 'signet')).toThrow('snapshot-invalid'); }
  });
  it('rejects recursive import depth before entering the importer', () => {
    const value = snapshot(131); const tree: any = { root: id(0) };
    for (let n = 0; n < 131; n++) { tree[id(n)] = { tx: id(n), time: 100, fullRbf: false, replaces: n === 130 ? [] : [id(n + 1)] }; }
    value.rbf.trees = [tree]; expect(() => validateRbfSnapshot(value, 'signet')).toThrow('snapshot-invalid');
  });
});

describe('RBF historical failure remains distinct from fresh observations', () => {
  it('starts pending, refuses unowned completion and publishes only an explicit completed outcome', () => {
    jest.isolateModules(() => {
      const state = require('../api/rbf-snapshot').rbfRestoreState;
      expect(state.diagnostic().reason).toBe('rbf_restore_pending'); expect(state.unavailable).toBe(true);
      expect(state.completeRestore('no-file')).toBe(false); expect(state.beginRestore()).toBe(true);
      expect(state.beginRestore()).toBe(false); expect(state.completeRestore('forged')).toBe(false);
      expect(state.unavailable).toBe(true); expect(state.completeRestore('no-file')).toBe(true);
      expect(state.diagnostic()).toEqual({schemaVersion:'universe-rbf-history-availability-v1',status:'available',reason:null});
      expect(state.beginRestore()).toBe(false);
    });
  });
  it('returns a copy, stays unavailable and preserves first failure reason', () => {
    jest.isolateModules(() => {
      const state = require('../api/rbf-snapshot').rbfRestoreState;
      state.fail('snapshot-oversize'); const copy = state.diagnostic(); copy.reason = null;
      state.fail('snapshot-invalid'); expect(state.unavailable).toBe(true);
      expect(state.beginRestore()).toBe(false); expect(state.completeRestore('restored')).toBe(false);
      expect(state.diagnostic()).toEqual({ schemaVersion: 'universe-rbf-history-availability-v1', status: 'unavailable', reason: 'snapshot-oversize' });
    });
  });
});
