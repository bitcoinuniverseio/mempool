import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { closeFractalRuntime, FractalRuntimeConfiguration, readFractalFile, startFractalRuntime } from './fractal.runtime';

describe('explicit Fractal startup reader fencing', () => {
  let root: string;
  let configuration: FractalRuntimeConfiguration;
  let selected: Record<string, unknown>;
  const profile = async (): Promise<void> => {
    await fs.writeFile(configuration.PROFILE_FILE, JSON.stringify({ schema: 'fractal-reader-profile-v1',
      native: { network: 'fractal-testnet', release: '0.4.0', sourceRevision: '8c22167f04250c7dd03afe46af4158bd08001183',
        configurationSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64) },
      cat: { sourceRevision: '8d5aeee7484bacc33d0014b44503c0b59d39aaff', schemaSha256: 'c'.repeat(64),
        configurationSha256: createHash('sha256').update(JSON.stringify(selected)).digest('hex') }, selected }));
  };
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'fractal-runtime-'));
    configuration = { ENABLED: true, PROFILE_FILE: join(root, 'profile.json'), RPC_URL: 'http://127.0.0.1:47732',
      COOKIE_PATH: join(root, 'cookie'), CAT_CONNECTION_FILE: join(root, 'connection.json'), CURSOR_KEY_FILE: join(root, 'cursor') };
    selected = { nativeConfigurationSha256: 'a'.repeat(64), schemaSha256: 'c'.repeat(64),
      trackerSourceRevision: '8d5aeee7484bacc33d0014b44503c0b59d39aaff', rpcOrigin: configuration.RPC_URL,
      host: '127.0.0.1', port: 47742, database: 'cat_test', readerRole: 'reader', maximumPoolSize: 1, connectionTimeoutMillis: 5000 };
    await profile();
    await fs.writeFile(configuration.CAT_CONNECTION_FILE, JSON.stringify({ host: '127.0.0.1', port: 47742,
      database: 'cat_test', user: 'reader', password: 'test-only-not-a-credential', max: 1, connectionTimeoutMillis: 5000 }), { mode: 0o600 });
    await fs.writeFile(configuration.CURSOR_KEY_FILE, Buffer.alloc(32, 7), { mode: 0o600 });
  });
  afterEach(async () => { await closeFractalRuntime(); await fs.rm(root, { recursive: true, force: true }); });
  function pool(writable = false): { connect: jest.Mock; end: jest.Mock; release: jest.Mock; query: jest.Mock } {
    const release = jest.fn();
    const query = jest.fn().mockResolvedValue({ rows: [{ role: 'reader', database: 'cat_test', schema: 'public', readonly: 'on',
      privileged: false, writable, readable: true }] });
    return { connect: jest.fn().mockResolvedValue({ query, release }), end: jest.fn().mockResolvedValue(undefined), release, query };
  }
  it('does not discover sources or load a driver when disabled', async () => {
    const factory = jest.fn();
    await startFractalRuntime({ ...configuration, ENABLED: false, PROFILE_FILE: '' }, factory);
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects a selected origin mismatch before acquiring a database connection', async () => {
    const factory = jest.fn();
    await expect(startFractalRuntime({ ...configuration, RPC_URL: 'http://127.0.0.1:47733' }, factory)).rejects.toMatchObject({ code: 'invalid-fractal-configuration' });
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects mutated selected profile commitments', async () => {
    const text = (await fs.readFile(configuration.PROFILE_FILE, 'utf8')).replace('cat_test', 'other_database');
    await fs.writeFile(configuration.PROFILE_FILE, text);
    await expect(startFractalRuntime(configuration, jest.fn())).rejects.toMatchObject({ code: 'invalid-fractal-configuration' });
  });
  it('refuses a credential symlink rather than reading its target', async () => {
    const link = join(root, 'linked-key');
    await fs.symlink(configuration.CURSOR_KEY_FILE, link, 'file');
    await expect(readFractalFile(link, true, 4096)).rejects.toMatchObject({ code: 'invalid-fractal-configuration' });
  });
  it('closes and refuses a role with effective write access', async () => {
    const reader = pool(true);
    await expect(startFractalRuntime(configuration, () => reader)).rejects.toMatchObject({ code: 'invalid-fractal-reader-role' });
    expect(reader.end).toHaveBeenCalledTimes(1);
    expect(reader.release).toHaveBeenCalledTimes(1);
  });
  it('preserves the selected one-connection read-only scope and closes it on shutdown', async () => {
    const reader = pool(); const factory = jest.fn(() => reader);
    await startFractalRuntime(configuration, factory);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ max: 1, connectionTimeoutMillis: 5000,
      options: '-c search_path=public -c default_transaction_read_only=on' }));
    expect(reader.query.mock.calls[0][0].text).toContain('has_table_privilege');
    await closeFractalRuntime();
    expect(reader.end).toHaveBeenCalledTimes(1);
  });
});
