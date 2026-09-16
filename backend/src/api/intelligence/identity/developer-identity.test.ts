import * as crypto from 'crypto';
import { developerIdentity, IdentityError, isPrivateAddress, resolvePublicAddress, validateWebhookUrl, DeliveryOutcome, LIMITS } from './developer-identity';
import { MemoryOwnerStore, useOwnerStore } from './owner-store';
import config from '../../../config';

const network = config.MEMPOOL.NETWORK;

/**
 * Every test runs against a fresh in-memory store, which behaves like the
 * MySQL store for everything asserted here. The MySQL path is exercised on
 * the Signet runtime, not in unit tests.
 */
describe('developer identity: owners, keys and scopes', () => {
  beforeEach(() => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    delete process.env.UNIVERSE_INTELLIGENCE_LEGACY_MASTER_KEY;
  });

  it('bootstraps an owner with a server-generated id and the fixed bootstrap scopes', async () => {
    const key = await developerIdentity.bootstrapOwner('first key', '93.184.216.5');
    expect(key.secret_key.startsWith('uip_live_')).toBe(true);
    expect(key.owner_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(key.scopes).not.toContain('*');
    expect(key.scopes).toContain('keys:manage');
    const owner = await developerIdentity.authenticateKey(key.secret_key);
    expect(owner).toEqual({ owner_id: key.owner_id, key_id: key.key_id, scopes: key.scopes });
  });

  it('bounds owner creation per caller address', async () => {
    for (let i = 0; i < 10; i++) { await developerIdentity.bootstrapOwner(`k${i}`, '198.51.100.9'); }
    await expect(developerIdentity.bootstrapOwner('one more', '198.51.100.9')).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    await expect(developerIdentity.bootstrapOwner('other address', '198.51.100.10')).resolves.toBeTruthy();
  });

  it('nothing is seeded: an invented master key does not authenticate', async () => {
    expect(await developerIdentity.authenticateKey('uip_live_masterkey_0000000000000000000000')).toBeNull();
    expect(await developerIdentity.authenticateKey('')).toBeNull();
    expect(await developerIdentity.authenticateKey(123)).toBeNull();
  });

  it('a further key is a subset of the caller scopes and never a wildcard', async () => {
    const first = await developerIdentity.bootstrapOwner('first', '93.184.216.1');
    const owner = (await developerIdentity.authenticateKey(first.secret_key))!;
    const narrow = await developerIdentity.generateApiKey(owner, 'read only', ['read']);
    expect(narrow.owner_id).toBe(first.owner_id);
    expect(narrow.scopes).toEqual(['read']);
    await expect(developerIdentity.generateApiKey(owner, 'admin', ['*'])).rejects.toMatchObject({ code: 'invalid_scopes' });
    const manager = await developerIdentity.generateApiKey(owner, 'manager', ['read', 'keys:manage']);
    const managerOwner = (await developerIdentity.authenticateKey(manager.secret_key))!;
    await expect(developerIdentity.generateApiKey(managerOwner, 'rpc', ['node:rpc'])).rejects.toMatchObject({ code: 'scope_escalation', status: 403 });
    const narrowOwner = (await developerIdentity.authenticateKey(narrow.secret_key))!;
    await expect(developerIdentity.generateApiKey(narrowOwner, 'x', ['read'])).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('lists only the owner keys, without hashes, and revokes only the owner keys', async () => {
    const a = await developerIdentity.bootstrapOwner('a', '93.184.216.1');
    const b = await developerIdentity.bootstrapOwner('b', '93.184.216.2');
    const ownerA = (await developerIdentity.authenticateKey(a.secret_key))!;
    const ownerB = (await developerIdentity.authenticateKey(b.secret_key))!;
    const listA = await developerIdentity.listKeys(ownerA);
    expect(listA.map(k => k.key_id)).toEqual([a.key_id]);
    expect(JSON.stringify(listA)).not.toMatch(/key_hash|secret/);
    expect(await developerIdentity.revokeApiKey(ownerB, a.key_id)).toBe(false);
    expect(await developerIdentity.authenticateKey(a.secret_key)).not.toBeNull();
    expect(await developerIdentity.revokeApiKey(ownerA, a.key_id)).toBe(true);
    expect(await developerIdentity.authenticateKey(a.secret_key)).toBeNull();
  });

  it('an expired key stops authenticating', async () => {
    const first = await developerIdentity.bootstrapOwner('first', '93.184.216.1');
    const owner = (await developerIdentity.authenticateKey(first.secret_key))!;
    const short = await developerIdentity.generateApiKey(owner, 'short', ['read'], 100, 1, 1_000_000);
    expect(await developerIdentity.authenticateKey(short.secret_key, undefined, 1_000_000 + 1000)).not.toBeNull();
    expect(await developerIdentity.authenticateKey(short.secret_key, undefined, 1_000_000 + 2 * 86_400_000)).toBeNull();
  });

  it('keys survive a new service view over the same store (restart), with the stored pepper', async () => {
    const first = await developerIdentity.bootstrapOwner('first', '93.184.216.1');
    developerIdentity.resetForTests();
    expect(await developerIdentity.authenticateKey(first.secret_key)).not.toBeNull();
  });

  it('the legacy operator key is honoured only from the environment', async () => {
    process.env.UNIVERSE_INTELLIGENCE_LEGACY_MASTER_KEY = 'uip_live_' + 'f'.repeat(48);
    const owner = await developerIdentity.authenticateKey(process.env.UNIVERSE_INTELLIGENCE_LEGACY_MASTER_KEY);
    expect(owner?.scopes).toEqual(['*']);
    expect(await developerIdentity.authenticateKey('uip_live_' + 'e'.repeat(48))).toBeNull();
  });
});

describe('webhook targets: scheme, private ranges and DNS answers', () => {
  it('rejects equivalent IPv6 spellings and reserved destinations', () => {
    for (const address of ['::ffff:7f00:1', '0:0:0:0:0:ffff:ac1f:ffff', '0:0:0:0:0:0:0:1', 'febf::1', 'fe90::1', '::10.1.2.3', '192.0.2.1', '198.51.100.1', '203.0.113.1', '3fff::1', '2002:a00:1::1']) {
      expect({ address, blocked: isPrivateAddress(address) }).toEqual({ address, blocked: true });
    }
    for (const address of ['::ffff:808:808', '2606:4700:4700::1111', '8.8.8.8']) expect(isPrivateAddress(address)).toBe(false);
    for (const url of ['https://localhost./', 'https://private.local./', 'https://[::ffff:7f00:1]/']) expect(() => validateWebhookUrl(url)).toThrow();
  });
  it('classifies private, loopback, link-local, CGNAT, multicast and mapped addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '64:ff9b::a00:1']) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ['93.184.216.10', '8.8.8.8', '2606:4700::1111', '172.32.0.1']) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  it('rejects non-https, credentials and literal private hosts', () => {
    for (const url of ['http://example.org/hook', 'https://user:pw@example.org/hook', 'https://127.0.0.1/hook', 'https://localhost/hook', 'https://[::1]/hook', 'https://169.254.169.254/latest', 'not a url', '']) {
      expect(() => validateWebhookUrl(url)).toThrow(IdentityError);
    }
    expect(validateWebhookUrl('https://hooks.example.org/path?x=1').hostname).toBe('hooks.example.org');
  });

  it('refuses a hostname when any resolved answer is private (DNS rebinding)', async () => {
    const url = new URL('https://rebind.example.org/hook');
    await expect(resolvePublicAddress(url, async () => [{ address: '93.184.216.7', family: 4 }, { address: '10.0.0.9', family: 4 }])).rejects.toMatchObject({ code: 'blocked_destination' });
    await expect(resolvePublicAddress(url, async () => [])).rejects.toMatchObject({ code: 'unresolvable' });
    await expect(resolvePublicAddress(url, async () => [{ address: '93.184.216.7', family: 4 }])).resolves.toEqual({ address: '93.184.216.7', family: 4 });
  });
});

describe('webhooks: registration, secrecy and real delivery', () => {
  const publicResolver = async () => [{ address: '93.184.216.7', family: 4 as const }];
  let sent: { url: string; address: string; headers: Record<string, string>; body: string }[];
  let answer: DeliveryOutcome;

  beforeEach(() => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    developerIdentity.resolver = publicResolver;
    sent = [];
    answer = { status_code: 200, success: true, response_digest: 'd'.repeat(64), error_code: null };
    developerIdentity.transport = async input => { sent.push({ url: input.url.toString(), address: input.address, headers: input.headers, body: input.body }); return answer; };
  });

  async function ownerWithWebhook() {
    const key = await developerIdentity.bootstrapOwner('o', '93.184.216.1');
    const owner = (await developerIdentity.authenticateKey(key.secret_key))!;
    const webhook = await developerIdentity.registerWebhook(owner, 'https://hooks.example.org/receive', ['watchlist.notification']);
    return { owner, webhook };
  }

  async function notificationFor(owner: { owner_id: string }, eventId = 'evt-1'): Promise<string> {
    const { ownerStore } = await import('./owner-store');
    const id = crypto.randomUUID();
    await ownerStore().insertNotification({
      notification_id: id, owner_id: owner.owner_id, network, watchlist_id: 'w', rule_id: 'r', event_id: eventId, title: 't', message: 'm', severity: 'info',
      entity_type: 'txid', blinded_hash: 'a'.repeat(64), block_height: 1, block_hash: 'b'.repeat(64), state: 'open', created_at: new Date().toISOString(), acknowledged_at: null,
    });
    return id;
  }

  it('shows the signing secret once and never in a list', async () => {
    const { owner, webhook } = await ownerWithWebhook();
    expect(webhook.signing_secret).toHaveLength(64);
    const listed = await developerIdentity.listWebhooks(owner);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toMatch(/secret/);
    const other = await developerIdentity.bootstrapOwner('other', '93.184.216.2');
    const otherOwner = (await developerIdentity.authenticateKey(other.secret_key))!;
    expect(await developerIdentity.listWebhooks(otherOwner)).toEqual([]);
    expect(await developerIdentity.getWebhook(otherOwner, webhook.webhook_id)).toBeNull();
  });

  it('rejects private targets at registration, including through DNS', async () => {
    const key = await developerIdentity.bootstrapOwner('o', '93.184.216.1');
    const owner = (await developerIdentity.authenticateKey(key.secret_key))!;
    await expect(developerIdentity.registerWebhook(owner, 'http://169.254.169.254/latest/meta-data/', ['x'])).rejects.toMatchObject({ code: 'invalid_url' });
    await expect(developerIdentity.registerWebhook(owner, 'https://localhost:8080/callback', ['x'])).rejects.toMatchObject({ code: 'invalid_url' });
    developerIdentity.resolver = async () => [{ address: '192.168.1.5', family: 4 }];
    await expect(developerIdentity.registerWebhook(owner, 'https://internal.example.org/hook', ['x'])).rejects.toMatchObject({ code: 'blocked_destination' });
  });

  it('delivers a signed body to the pinned address and records the real outcome', async () => {
    const { owner, webhook } = await ownerWithWebhook();
    const notificationId = await notificationFor(owner);
    expect(await developerIdentity.enqueueDelivery(notificationId, webhook.webhook_id)).toBe('inserted');
    expect(await developerIdentity.enqueueDelivery(notificationId, webhook.webhook_id)).toBe('duplicate');
    const attempts = await developerIdentity.processOutbox();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ success: true, status_code: 200, attempt_number: 1, event_id: 'evt-1' });
    expect(sent).toHaveLength(1);
    expect(sent[0].address).toBe('93.184.216.7');
    expect(sent[0].url).toBe('https://hooks.example.org/receive');
    const timestamp = Number(sent[0].headers['x-universe-timestamp']);
    const expected = 'v1=' + crypto.createHmac('sha256', webhook.signing_secret).update(`${timestamp}.${sent[0].body}`).digest('hex');
    expect(sent[0].headers['x-universe-signature']).toBe(expected);
    expect(JSON.parse(sent[0].body)).toMatchObject({ event_id: 'evt-1', notification_id: notificationId });
    // Delivered rows are not claimed again.
    expect(await developerIdentity.processOutbox()).toEqual([]);
    const history = await developerIdentity.listAttempts(owner, webhook.webhook_id);
    expect(history?.map(a => a.success)).toEqual([true]);
  });

  it.each([
    [{ status_code: 500, success: false, response_digest: null, error_code: 'http_error' }, 'pending'],
    [{ status_code: 404, success: false, response_digest: null, error_code: 'http_error' }, 'pending'],
    [{ status_code: 302, success: false, response_digest: null, error_code: 'redirect' }, 'pending'],
    [{ status_code: null, success: false, response_digest: null, error_code: 'timeout' }, 'pending'],
  ])('a %o answer is a failed attempt that is retried later, never a success', async (outcome, state) => {
    const { owner, webhook } = await ownerWithWebhook();
    const notificationId = await notificationFor(owner, `evt-${outcome.error_code}-${outcome.status_code}`);
    await developerIdentity.enqueueDelivery(notificationId, webhook.webhook_id);
    answer = outcome;
    const [attempt] = await developerIdentity.processOutbox();
    expect(attempt.success).toBe(false);
    expect(attempt.error_code).toBe(outcome.error_code);
    const { ownerStore } = await import('./owner-store');
    const [row] = await ownerStore().claimOutbox(network, new Date(Date.now() + 3_600_000 * 2).toISOString(), new Date(Date.now() + 3_600_000 * 3).toISOString(), 10);
    expect(row.state).toBe(state);
    expect(row.attempt_count).toBe(1);
  });

  it('a destination that turns private between registration and delivery fails permanently', async () => {
    const { owner, webhook } = await ownerWithWebhook();
    const notificationId = await notificationFor(owner, 'evt-rebind');
    await developerIdentity.enqueueDelivery(notificationId, webhook.webhook_id);
    developerIdentity.resolver = async () => [{ address: '10.9.9.9', family: 4 }];
    const [attempt] = await developerIdentity.processOutbox();
    expect(attempt).toMatchObject({ success: false, error_code: 'blocked_destination' });
    expect(sent).toHaveLength(0);
    const { ownerStore } = await import('./owner-store');
    expect(await ownerStore().claimOutbox(network, new Date(Date.now() + 86_400_000).toISOString(), new Date(Date.now() + 2 * 86_400_000).toISOString(), 10)).toEqual([]);
  });

  it('gives up after the attempt ceiling', async () => {
    const { owner, webhook } = await ownerWithWebhook();
    const notificationId = await notificationFor(owner, 'evt-ceiling');
    await developerIdentity.enqueueDelivery(notificationId, webhook.webhook_id);
    answer = { status_code: 503, success: false, response_digest: null, error_code: 'http_error' };
    const { ownerStore } = await import('./owner-store');
    let attempts = 0;
    for (let i = 0; i < LIMITS.maxAttempts + 2; i++) {
      const [row] = await ownerStore().claimOutbox(network, new Date(Date.now() + 10 * 86_400_000).toISOString(), new Date(Date.now() + 11 * 86_400_000).toISOString(), 1);
      if (!row) { break; }
      await developerIdentity.deliver(row);
      attempts++;
    }
    expect(attempts).toBe(LIMITS.maxAttempts);
  });
});

describe('the real HTTPS transport against a loopback TLS receiver', () => {
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const https = require('https');
  const fixtures = join(__dirname, '__fixtures__');
  let server: any;
  let port: number;
  let received: { headers: Record<string, string>; body: string }[];
  let respond: (res: any) => void;

  beforeAll(async () => {
    process.env.UNIVERSE_INTELLIGENCE_WEBHOOK_CA = join(fixtures, 'webhook-receiver.crt');
    received = [];
    server = https.createServer({ key: readFileSync(join(fixtures, 'webhook-receiver.key')), cert: readFileSync(join(fixtures, 'webhook-receiver.crt')) }, (req: any, res: any) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => { received.push({ headers: req.headers, body }); respond(res); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    delete process.env.UNIVERSE_INTELLIGENCE_WEBHOOK_CA;
    await new Promise(resolve => server.close(resolve));
  });

  const send = () => {
    const { httpsTransport } = require('./developer-identity');
    const body = JSON.stringify({ hello: 'receiver' });
    return httpsTransport({
      url: new URL(`https://localhost:${port}/receive?x=1`), address: '127.0.0.1', family: 4,
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'x-universe-signature': 'v1=abc' },
      body, timeoutMs: 3000, maxResponseBytes: 1024,
    });
  };

  it('completes a TLS handshake for the hostname, posts the exact body and reports a 2xx as success', async () => {
    respond = res => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); };
    const outcome = await send();
    expect(outcome).toMatchObject({ status_code: 200, success: true, error_code: null });
    expect(outcome.response_digest).toBe(crypto.createHash('sha256').update('ok').digest('hex'));
    expect(received).toHaveLength(1);
    expect(received[0].body).toBe(JSON.stringify({ hello: 'receiver' }));
    expect(received[0].headers['x-universe-signature']).toBe('v1=abc');
    expect(received[0].headers.host).toBe(`localhost:${port}`);
  });

  it('reports non-2xx and redirects as failures, and oversized bodies as response_too_large', async () => {
    respond = res => { res.writeHead(503); res.end('busy'); };
    expect(await send()).toMatchObject({ status_code: 503, success: false, error_code: 'http_error' });
    respond = res => { res.writeHead(302, { location: 'https://elsewhere.example.org/' }); res.end(); };
    expect(await send()).toMatchObject({ status_code: 302, success: false, error_code: 'redirect' });
    respond = res => { res.writeHead(200); res.end('x'.repeat(2048)); };
    expect(await send()).toMatchObject({ success: false, error_code: 'response_too_large' });
  });

  it('a connection refused is a failure with a code, not a success', async () => {
    const { httpsTransport } = require('./developer-identity');
    const outcome = await httpsTransport({ url: new URL('https://localhost:1/receive'), address: '127.0.0.1', family: 4, headers: {}, body: '{}', timeoutMs: 2000, maxResponseBytes: 1024 });
    expect(outcome.success).toBe(false);
    expect(outcome.status_code).toBeNull();
    expect(outcome.error_code).toMatch(/econnrefused|connection_error/);
  });
});
