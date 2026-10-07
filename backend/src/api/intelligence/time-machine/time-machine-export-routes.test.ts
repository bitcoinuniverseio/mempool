import express from 'express';
import { request, Server } from 'http';
import { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('./time-machine.service', () => ({timeMachineService: {exportState: jest.fn()}, TimeMachineUnavailableError: class extends Error {}}));
jest.mock('./history-parquet', () => ({writeHistoryParquet: jest.fn(), HistoryParquetError: class extends Error {constructor(public code: string) {super(code);}}}));
import routes from './time-machine.routes';
import { timeMachineService } from './time-machine.service';
import { HistoryParquetError, writeHistoryParquet } from './history-parquet';

describe('mounted retained export wire and concurrency guards', () => {
  let server: Server;
  const hash = 'a'.repeat(64), capture = {state: {state_hash: hash}, txids: []};
  beforeAll(async () => {
    const app = express(); app.use(express.json({limit: '1kb'})); routes.initRoutes(app);
    server = await new Promise<Server>(resolve => {const listening = app.listen(0, '127.0.0.1', () => resolve(listening));});
  });
  afterAll(async () => {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
  beforeEach(() => {jest.resetAllMocks(); (timeMachineService.exportState as jest.Mock).mockReturnValue(capture);});
  const post = (body: unknown): Promise<{status: number; headers: Record<string, unknown>; bytes: Buffer}> => new Promise((resolve, reject) => {
    const data = JSON.stringify(body), req = request({hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/api/v1/intelligence/history/exports', method: 'POST', agent: false, headers: {'content-type': 'application/json', 'content-length': Buffer.byteLength(data)}}, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => res.statusCode === undefined ? reject(new Error('Missing HTTP response status')) : resolve({status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks)})); res.on('error', reject);
    }); req.on('error', reject); req.end(data);
  });
  it('rejects malformed hashes/foreign fields and unsupported formats before capture or serialization', async () => {
    for (const body of [{state_hash: '../private'}, {state_hash: [hash]}, {state_hash: hash, txids: []}, {state_hash: hash, format: 'csv'}]) {expect((await post(body)).status).toBe(400);}
    expect(timeMachineService.exportState).not.toHaveBeenCalled(); expect(writeHistoryParquet).not.toHaveBeenCalled();
  });
  it('preserves JSON and missing retained state semantics', async () => {
    const json = await post({state_hash: hash}); expect(json.status).toBe(200); expect(JSON.parse(json.bytes.toString())).toMatchObject({format: 'json', ...capture}); expect(json.headers['cache-control']).toBe('no-store');
    (timeMachineService.exportState as jest.Mock).mockReturnValue(null); expect((await post({state_hash: hash, format: 'parquet'})).status).toBe(404); expect(writeHistoryParquet).not.toHaveBeenCalled();
  });
  it('returns actual fixture bytes with binary MIME, exact length and attachment', async () => {
    // Serializer interoperability is qualified separately; this mock isolates wire delivery.
    const bytes = readFileSync(join(__dirname, '../../../../../frontend/src/app/universe/intelligence-platform/fixtures/history-parquet/empty.parquet'));
    (writeHistoryParquet as jest.Mock).mockResolvedValue(bytes);
    const response = await post({state_hash: hash, format: 'parquet'}); expect(response.status).toBe(200); expect(response.bytes).toEqual(bytes); expect(response.headers['content-type']).toBe('application/vnd.apache.parquet'); expect(Number(response.headers['content-length'])).toBe(bytes.length); expect(response.headers['content-disposition']).toContain('.parquet');
  });
  it('bounds concurrent serialization and releases the slot on writer failure', async () => {
    let finish!: (value: Buffer) => void;
    (writeHistoryParquet as jest.Mock).mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const first = post({state_hash: hash, format: 'parquet'});
    for (let i = 0; i < 30 && !(writeHistoryParquet as jest.Mock).mock.calls.length; i++) {await new Promise(resolve => setImmediate(resolve));}
    expect(writeHistoryParquet).toHaveBeenCalledTimes(1); const busy = await post({state_hash: hash, format: 'parquet'}); expect(busy.status).toBe(429); expect(busy.headers['retry-after']).toBe('1'); finish(Buffer.from('wire-only')); expect((await first).status).toBe(200);
    for (const [code, expected] of [['history-parquet-invalid-capture', 400], ['history-parquet-limit', 413], ['history-parquet-unavailable', 503]] as const) {
      (writeHistoryParquet as jest.Mock).mockRejectedValue(new HistoryParquetError(code)); const response = await post({state_hash: hash, format: 'parquet'}); expect(response.status).toBe(expected); expect(JSON.parse(response.bytes.toString()).code).toBe(code);
    }
  });
});
