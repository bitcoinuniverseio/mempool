// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PORTFOLIO_ROUTES } from '../portfolio.routes';
import { ShareViewComponent } from './share-view.component';

describe('portfolio share route and response states', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  beforeEach(() => TestBed.configureTestingModule({ providers: [
    provideRouter([{ path: 'portfolio', children: PORTFOLIO_ROUTES }]),
    provideHttpClient(), provideHttpClientTesting(),
  ] }));
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); vi.unstubAllGlobals(); });

  async function encryptedSnapshot(snapshot: unknown) {
    vi.stubGlobal('crypto', webcrypto);
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const nonce = webcrypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, bytes);
    return {
      key: Buffer.from(await webcrypto.subtle.exportKey('raw', key)).toString('base64url'),
      payload: { format: 'universe-portfolio-share', formatVersion: 1,
        nonceB64: Buffer.from(nonce).toString('base64'), ctB64: Buffer.from(ciphertext).toString('base64'),
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
    };
  }

  it('opens an independently encrypted snapshot when the same share receives its fragment key', async () => {
    const snapshot = { holdings: [{ asset: 'BTC', share: '1.25' }], createdAt: new Date().toISOString() };
    const encrypted = await encryptedSnapshot(snapshot);
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    const component = await harness.navigateByUrl('/portfolio/share/fragment', ShareViewComponent);
    http.expectOne('/api/v2/universe/portfolio-share/fragment').flush(encrypted.payload);
    await vi.waitFor(() => expect(component.state()).toBe('no-key'));
    await harness.navigateByUrl('/portfolio/share/fragment#key=' + encrypted.key, ShareViewComponent);
    const request = http.expectOne('/api/v2/universe/portfolio-share/fragment');
    expect(request.request.urlWithParams).not.toContain(encrypted.key);
    request.flush(encrypted.payload);
    await vi.waitFor(() => expect(component.state()).toBe('ready'));
    expect(component.snapshot()).toEqual(snapshot);
  });

  it('rejects authentic ciphertext with a malformed snapshot instead of rendering invalid holdings', async () => {
    const encrypted = await encryptedSnapshot({ holdings: [null], createdAt: new Date().toISOString() });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/portfolio/share/invalid#key=' + encrypted.key, ShareViewComponent);
    TestBed.inject(HttpTestingController).expectOne('/api/v2/universe/portfolio-share/invalid').flush(encrypted.payload);
    await vi.waitFor(() => expect(component.state()).toBe('failed'));
    expect(component.snapshot()).toBeNull();
  });

  it('reads the actual route ID without sending the fragment key', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/portfolio/share/first#key=client-only', ShareViewComponent);
    const request = TestBed.inject(HttpTestingController).expectOne('/api/v2/universe/portfolio-share/first');
    expect(request.request.urlWithParams).not.toContain('client-only');
    request.flush({}, { status: 404, statusText: 'Not found' });
    await Promise.resolve();
    expect(component.state()).toBe('missing');
  });

  it('keeps upstream failure distinct from a revoked share', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/portfolio/share/unavailable', ShareViewComponent);
    TestBed.inject(HttpTestingController).expectOne('/api/v2/universe/portfolio-share/unavailable')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await Promise.resolve();
    expect(component.state()).toBe('failed');
  });

  it('ignores an old response after the route changes', async () => {
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    await harness.navigateByUrl('/portfolio/share/old', ShareViewComponent);
    const old = http.expectOne('/api/v2/universe/portfolio-share/old');
    const component = await harness.navigateByUrl('/portfolio/share/new', ShareViewComponent);
    const current = http.expectOne('/api/v2/universe/portfolio-share/new');
    old.flush({}, { status: 404, statusText: 'Not found' });
    await Promise.resolve();
    expect(component.state()).toBe('loading');
    current.flush({}, { status: 410, statusText: 'Expired' });
    await Promise.resolve();
    expect(component.state()).toBe('expired');
  });
});
