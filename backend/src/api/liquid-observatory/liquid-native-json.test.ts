import { createServer } from 'http';
import { AddressInfo } from 'net';
import { mkdtemp, writeFile, rm, symlink, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseLiquidRpcJson } from './liquid-native-json';
import { liquidAtomic } from './liquid-public-projection';
import { LiquidRpcReader, readLiquidRpcCredentials } from './liquid-paired-source';

describe('lossless native Liquid monetary envelope', () => {
  test('high supply and exponent values retain exact atomic strings before binary64 parsing', () => {
    const raw = '{"id":"public-liquid-evidence","error":null,"result":{"value":90071992.54740993,"assetamount":9.007199254740993e7,"tokenamount":1e-8}}';
    expect(String(JSON.parse(raw).result.value)).not.toBe('90071992.54740993');
    const result = parseLiquidRpcJson(raw).result;
    expect(result.value).toBe('90071992.54740993'); expect(liquidAtomic(result.value)).toBe('9007199254740993');
    expect(liquidAtomic(result.assetamount)).toBe('9007199254740993'); expect(liquidAtomic(result.tokenamount)).toBe('1');
  });
  test('escaped monetary key spellings are protected, unrelated JSON text and heights stay intact', () => {
    const result = parseLiquidRpcJson('{"result":{"\\u0076alue":1e-8,"assetamount":"1.23","height":12,"text":"value: 90071992.54740993 \\"quoted\\""}}').result;
    expect(result.value).toBe('1e-8'); expect(result.assetamount).toBe('1.23'); expect(result.height).toBe(12);
    expect(result.text).toBe('value: 90071992.54740993 "quoted"');
  });
  test.each(['0.000000001', '1e-9', '-1', '1e9999'])('invalid monetary lexeme %s is never rounded into validity', number => {
    const result = parseLiquidRpcJson('{"result":{"value":' + number + '}}');
    expect(() => liquidAtomic(result.result.value)).toThrow();
  });
  test('malformed or oversized raw JSON is rejected before publication', () => {
    expect(() => parseLiquidRpcJson('{"value":1e}')).toThrow();
    expect(() => parseLiquidRpcJson(' '.repeat(8 * 1024 * 1024 + 1))).toThrow();
    expect(() => parseLiquidRpcJson({ value: 1 })).toThrow();
  });
  test('actual raw HTTP native envelope reaches the domain parser without Axios rounding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'liquid-native-cookie-')), file = join(directory, 'cookie');
    await writeFile(file, '__cookie__:controlled-only', { mode: 0o600 });
    const server = createServer((_req, res) => res.end('{"id":"public-liquid-evidence","error":null,"result":{"value":90071992.54740993,"issuance":{"assetamount":9.007199254740993e7,"tokenamount":1e-8}}}'));
    server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const priorOrigin = process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN, priorCookie = process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE;
    process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/';
    process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE = file;
    try {
      const value = await new LiquidRpcReader('elements').call('getrawtransaction', [], new AbortController().signal);
      expect(liquidAtomic(value.value)).toBe('9007199254740993');
      expect(liquidAtomic(value.issuance.assetamount)).toBe('9007199254740993');
      expect(liquidAtomic(value.issuance.tokenamount)).toBe('1');
    } finally {
      if (priorOrigin === undefined) delete process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN; else process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN = priorOrigin;
      if (priorCookie === undefined) delete process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE; else process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE = priorCookie;
      await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
    }
  });
});
describe('selected native credential file boundary', () => {
  test('bounded regular credential read and cancellation do not expose file contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'liquid-credential-')), file = join(directory, 'cookie');
    try {
      await writeFile(file, '__cookie__:controlled-only\n', { mode: 0o600 });
      expect(await readLiquidRpcCredentials(file, new AbortController().signal)).toBe('__cookie__:controlled-only');
      await writeFile(file, 'x'.repeat(4097));
      await expect(readLiquidRpcCredentials(file, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-liquid-pair' });
      const controller = new AbortController(); controller.abort();
      await expect(readLiquidRpcCredentials(file, controller.signal)).rejects.toMatchObject({ code: 'liquid-source-deadline' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  (process.platform === 'win32' ? test.skip : test)('POSIX symlink and group-readable credentials are rejected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'liquid-credential-mode-')), file = join(directory, 'cookie'), link = join(directory, 'link');
    try {
      await writeFile(file, '__cookie__:controlled-only', { mode: 0o600 }); await symlink(file, link);
      await expect(readLiquidRpcCredentials(link, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-liquid-pair' });
      await chmod(file, 0o640);
      await expect(readLiquidRpcCredentials(file, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-liquid-pair' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
