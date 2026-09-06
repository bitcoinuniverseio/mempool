import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { PortfolioVaultService } from '../stores/vault.service';
import { OwnedPortfolioShare, PortfolioShareService } from './portfolio-share.service';

// Real WebCrypto and service logic; the vault persistence boundary and HTTP transport are test doubles.
describe('encrypted portfolio share owner workflow', () => {
  const createdAt = '2026-09-05T12:00:00.000Z';
  const holdings = [{ asset: 'BTC', share: '12.5%', address: 'private-address', value: '123456.789' }];
  let records: Map<string, OwnedPortfolioShare>;
  let vault: { isUnlocked: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; listByType: ReturnType<typeof vi.fn> };
  let http: { post: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let service: PortfolioShareService;

  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    records = new Map();
    vault = {
      isUnlocked: vi.fn(() => true),
      put: vi.fn(async (_type: string, id: string, value: OwnedPortfolioShare) => { records.set(id, structuredClone(value)); }),
      get: vi.fn(async (id: string) => records.get(id) ?? null),
      listByType: vi.fn(async () => [...records].map(([id, value]) => ({ id, value }))),
    };
    http = {
      post: vi.fn((_url, body) => {
        expect(records.get(`portfolio-share:${body.shareId}`)?.state).toBe('pending');
        return of({ shareId: body.shareId, createdAt, expiresAt: new Date(Date.now() + 86400000).toISOString() });
      }),
      delete: vi.fn(() => of(null)),
    };
    service = new PortfolioShareService(http as unknown as HttpClient, vault as unknown as PortfolioVaultService);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('uploads only an encrypted projection and independently decrypts it with the fragment key', async () => {
    const id = await service.create('owner-one', holdings, createdAt, 86400);
    const stored = records.get(`portfolio-share:${id}`)!;
    const body = http.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['shareId', 'ownerToken', 'format', 'formatVersion', 'nonceB64', 'ctB64', 'ttlSeconds'].sort());
    const link = new URL(await service.link(id, 'owner-one', 'https://example.test'));
    const keyText = new URLSearchParams(link.hash.slice(1)).get('key')!;
    expect(new Set([id, body.ownerToken, keyText]).size).toBe(3);
    expect(JSON.stringify(body)).not.toContain(keyText);
    expect(JSON.stringify(body)).not.toContain('private-address');
    expect(JSON.stringify(body)).not.toContain('123456.789');
    expect(link.pathname).toBe(`/portfolio/share/${id}`);
    expect(link.search).toBe('');
    expect(link.href).not.toContain(body.ownerToken);
    const key = await webcrypto.subtle.importKey('raw', Buffer.from(keyText, 'base64url'), 'AES-GCM', false, ['decrypt']);
    const plaintext = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(body.nonceB64, 'base64') }, key, Buffer.from(body.ctB64, 'base64'));
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual({ holdings: [{ asset: 'BTC', share: '12.5%' }], createdAt });
    expect(stored.state).toBe('active');
    const summary = await service.list('owner-one');
    expect(Object.keys(summary[0]).sort()).toEqual(['shareId', 'state', 'createdAt', 'expiresAt'].sort());
  });

  it('retains the exact pending request across an uncertain response and a recreated service', async () => {
    http.post.mockImplementationOnce(() => throwError(() => new Error('response lost')));
    await expect(service.create('owner-one', holdings, createdAt, 86400)).rejects.toThrow('response lost');
    const pending = [...records.values()][0];
    expect(pending.state).toBe('pending');
    const retry = new PortfolioShareService(http as unknown as HttpClient, vault as unknown as PortfolioVaultService);
    await retry.retry(pending.shareId, 'owner-one');
    expect(http.post.mock.calls[1][1]).toEqual(http.post.mock.calls[0][1]);
    expect(records.get(`portfolio-share:${pending.shareId}`)?.keyB64Url).toBe(pending.keyB64Url);
    expect((await retry.list('owner-one'))[0].state).toBe('active');
  });

  it('preserves pending ownership if server response does not match the request', async () => {
    http.post.mockReturnValueOnce(of({ shareId: 'unexpected', createdAt, expiresAt: createdAt }));
    await expect(service.create('owner-one', holdings, createdAt, 60)).rejects.toThrow('invalid response');
    expect([...records.values()][0].state).toBe('pending');
  });

  it('requires the same local portfolio for management and keeps two owners separate', async () => {
    const first = await service.create('owner-one', holdings, createdAt, 86400);
    const second = await service.create('owner-two', holdings, createdAt, 86400);
    expect((await service.list('owner-one')).map((row) => row.shareId)).toEqual([first]);
    expect((await service.list('owner-two')).map((row) => row.shareId)).toEqual([second]);
    await expect(service.link(first, 'owner-two', 'https://example.test')).rejects.toThrow('no owner capability');
    await expect(service.revoke(first, 'owner-two')).rejects.toThrow('no owner capability');
    expect(http.delete).not.toHaveBeenCalled();
    await service.revoke(first, 'owner-one');
    expect(http.delete.mock.calls[0]).toEqual([`/api/v2/universe/portfolio-share/${first}`, {
      headers: { Authorization: `Bearer ${records.get(`portfolio-share:${first}`)!.request.ownerToken}` },
    }]);
    expect((await service.list('owner-one'))[0].state).toBe('revoked');
    expect((await service.list('owner-two'))[0].state).toBe('active');
    await expect(service.link(first, 'owner-one', 'https://example.test')).rejects.toThrow('not active');
  });

  it('does not mark a failed revoke successful or expose an expired link', async () => {
    const id = await service.create('owner-one', holdings, createdAt, 86400);
    http.delete.mockReturnValueOnce(throwError(() => new Error('offline')));
    await expect(service.revoke(id, 'owner-one')).rejects.toThrow('offline');
    expect((await service.list('owner-one'))[0].state).toBe('active');
    records.get(`portfolio-share:${id}`)!.expiresAt = '2020-01-01T00:00:00.000Z';
    expect((await service.list('owner-one'))[0].state).toBe('expired');
    await expect(service.link(id, 'owner-one', 'https://example.test')).rejects.toThrow('not active');
  });

  it('does not upload if the vault is locked or saving the owner capability fails', async () => {
    vault.isUnlocked.mockReturnValueOnce(false);
    await expect(service.create('owner-one', holdings, createdAt, 60)).rejects.toThrow('Unlock');
    vault.put.mockRejectedValueOnce(new Error('vault full'));
    await expect(service.create('owner-one', holdings, createdAt, 60)).rejects.toThrow('vault full');
    expect(http.post).not.toHaveBeenCalled();
  });

  it.each([0, 59, 2_592_001, 1.5])('rejects invalid TTL %s before persistence', async (ttl) => {
    await expect(service.create('owner-one', holdings, createdAt, ttl)).rejects.toThrow('valid expiry');
    expect(vault.put).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('rejects an oversized snapshot before persistence or upload', async () => {
    const large = Array.from({ length: 300 }, () => ({ asset: 'a'.repeat(200), share: '100%' }));
    await expect(service.create('owner-one', large, createdAt, 60)).rejects.toThrow('too large');
    expect(vault.put).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
});
