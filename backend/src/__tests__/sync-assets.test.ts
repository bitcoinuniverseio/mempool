import { createServer, Server } from 'http';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SyncAssets } from '../sync-assets';

jest.mock('../api/backend-info', () => ({ __esModule: true, default: { getBackendInfo: () => ({ version: 'test' }) } }));
jest.mock('../logger', () => ({ __esModule: true, default: { info: jest.fn() } }));

describe('external asset transfer failure and atomic replacement', () => {
  let server: Server, directory: string, origin: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'asset-transfer-'));
    server = createServer((req, res) => {
      if (req.url === '/ok.dat') { res.end('complete asset'); return; }
      if (req.url === '/large.dat') { res.end('x'.repeat(2000)); return; }
      if (req.url === '/truncated.dat') {
        res.writeHead(200, { 'Content-Length': '100' }); res.write('partial');
        setTimeout(() => res.destroy(), 10); return;
      }
      if (req.url === '/hung.dat') { res.writeHead(200); res.write('partial'); return; }
      res.writeHead(404); res.end('missing');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + (server.address() as any).port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  it('atomically replaces an existing asset with the complete response', async () => {
    await writeFile(join(directory, 'ok.dat'), 'previous');
    await new SyncAssets(directory).downloadFile$(origin + '/ok.dat');
    expect(await readFile(join(directory, 'ok.dat'), 'utf8')).toBe('complete asset');
    expect(await readdir(directory)).toEqual(['ok.dat']);
  });
  it.each(['missing.dat', 'truncated.dat', 'hung.dat', 'large.dat'])('rejects %s and preserves the previous bytes', async filename => {
    await writeFile(join(directory, filename), 'previous');
    await expect(new SyncAssets(directory, 150, 1000).downloadFile$(origin + '/' + filename)).rejects.toThrow('previous file was preserved');
    expect(await readFile(join(directory, filename), 'utf8')).toBe('previous');
    expect(await readdir(directory)).toEqual([filename]);
  });
  it('rejects destination write errors and removes the partial file', async () => {
    await mkdir(join(directory, 'ok.dat'));
    await expect(new SyncAssets(directory).downloadFile$(origin + '/ok.dat')).rejects.toThrow();
    expect(await readdir(directory)).toEqual(['ok.dat']);
  });
  it.each(['%2e%2e%2foutside', 'CON', 'file.', ''])('rejects an unsafe filename %s before downloading', async filename => {
    await expect(new SyncAssets(directory).downloadFile$(origin + '/' + filename)).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});
