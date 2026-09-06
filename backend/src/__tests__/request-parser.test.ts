import express from 'express';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import qs from 'qs';

describe('patched request parsing', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.get('/parse', (request, response) => response.json(request.query));
    app.post('/parse', (request, response) => response.json(request.body));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('retains Express nested query and repeated-value behavior', async () => {
    const response = await fetch(`${origin}/parse?filter[network]=mainnet&ids[]=a&ids[]=b`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ filter: { network: 'mainnet' }, ids: ['a', 'b'] });
  });

  it('retains extended form parsing without prototype pollution', async () => {
    const response = await fetch(`${origin}/parse`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'filter[network]=mainnet&ids[]=a&ids[]=b&__proto__[explorerPolluted]=yes',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ filter: { network: 'mainnet' }, ids: ['a', 'b'] });
    expect(Object.prototype).not.toHaveProperty('explorerPolluted');
  });

  it('enforces comma-array limits for bracket keys as well as plain keys', () => {
    // GHSA-x5fp-wj9c-mxmx: use a bounded four-element regression input.
    const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
    expect(() => qs.parse('a[]=1,2,3,4', options)).toThrow(RangeError);
    expect(() => qs.parse('a=1,2,3,4', options)).toThrow(RangeError);
  });

  it('does not call attacker-controlled constructor.isBuffer while serializing', () => {
    // GHSA-4mjr-xmp4-gh2g: parsing can legally retain this own constructor key.
    const parsed = qs.parse('item[constructor][isBuffer]=not-a-function&value=retained', { allowPrototypes: true });
    expect(() => qs.stringify(parsed)).not.toThrow();
    expect(qs.stringify(parsed)).toContain('value=retained');
    expect(qs.stringify({ value: Buffer.from('retained') })).toBe('value=retained');
  });
});
