import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectNwcUri } from './nwc-uri';
import { PaymentNwcInspectComponent } from './payment-nwc-inspect.component';

const pubkey = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
// Public test-only scalar, never associated with a wallet or a relay connection.
const secret = '12'.repeat(32);
const uri = (params = `relay=${encodeURIComponent('wss://relay.example.invalid')}&secret=${secret}`, key = pubkey): string => `nostr+walletconnect://${key}?${params}`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('browser-only NWC structural inspection', () => {
  it('validates real curve points/scalars and multiple relays without claiming capabilities', () => {
    const report = inspectNwcUri(uri(`relay=${encodeURIComponent('wss://relay.example.invalid')}&relay=${encodeURIComponent('ws://127.0.0.1:8080/path')}&secret=${secret}&lud16=alice%40example.invalid`));
    expect(report.valid).toBe(true);
    expect(report.wallet_service_pubkey).toBe(pubkey);
    expect(report.relays).toHaveLength(2);
    expect(report.encryption_supported).toBeNull();
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it.each([
    uri('relay=wss%3A%2F%2Fexample.invalid'),
    uri(`secret=${secret}`),
    uri(`relay=https%3A%2F%2Fexample.invalid&secret=${secret}`),
    uri(`relay=wss%3A%2F%2Fuser%3Apass%40example.invalid&secret=${secret}`),
    uri(`relay=wss%3A%2F%2Fexample.invalid%23fragment&secret=${secret}`),
    uri(`relay=wss%3A%2F%2Fexample.invalid&secret=${'00'.repeat(32)}`),
    uri(`relay=wss%3A%2F%2Fexample.invalid&secret=${'ff'.repeat(32)}`),
    uri(`relay=wss%3A%2F%2Fexample.invalid&secret=${secret.slice(2)}`),
    uri(undefined, '02' + pubkey),
    uri(undefined, 'ff'.repeat(32)),
    uri() + `&secret=${secret}`,
    uri() + `&%73ecret=${secret}`,
    uri() + '&unknown=hidden',
    uri() + '&lud16=bad',
    uri() + '&lud16=a%40b.invalid&lud16=b%40b.invalid',
    uri() + '&lud16=%C3%28',
    uri() + '#fragment',
    uri() + '&relay=%ZZ',
  ])('fails safely for malformed NWC input #%#', input => {
    const report = inspectNwcUri(input);
    expect(report.valid).toBe(false);
    expect(report.masked_uri).toBe('');
    expect(report.relays).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it('redacts the secret if repeated in relay paths, nested escapes, lightning addresses, and public-key field', () => {
    const reflectedSecret = pubkey;
    const encoded = [...reflectedSecret].map(char => '%' + char.charCodeAt(0).toString(16)).join('');
    const relay = `wss://example.invalid/${encoded}?token=${reflectedSecret.toUpperCase()}`;
    const report = inspectNwcUri(uri(`secret=${reflectedSecret}&relay=${encodeURIComponent(relay)}&lud16=${reflectedSecret}%40example.invalid`));
    expect(report.valid).toBe(true);
    expect(report.wallet_service_pubkey).toBe('[REDACTED]');
    const serialized = JSON.stringify(report).toLowerCase();
    expect(serialized).not.toContain(reflectedSecret);
    expect(serialized).not.toContain(encoded.toLowerCase());
    expect(report.relays[0]).toContain('[REDACTED]');
  });

  it('clears raw input and prior results across inspections, edits, samples, and destruction without network access', () => {
    const fetch = vi.fn(() => { throw new Error('Network prohibited'); });
    const websocket = vi.fn(() => { throw new Error('Network prohibited'); });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('WebSocket', websocket);
    vi.stubGlobal('XMLHttpRequest', websocket);
    const component = new PaymentNwcInspectComponent();
    component.uriInput = uri();
    component.inspectUri();
    expect(component.report?.valid).toBe(true);
    expect(component.uriInput).toBe('');
    component.clearResult();
    expect(component.report).toBeNull();
    component.uriInput = uri(); component.inspectUri();
    component.loadSample();
    expect(component.report).toBeNull();
    component.inspectUri();
    expect(component.report?.valid).toBe(true);
    component.uriInput = 'invalid'; component.inspectUri();
    expect(component.report?.valid).toBe(false);
    expect(component.report?.masked_uri).toBe('');
    component.ngOnDestroy();
    expect(component.report).toBeNull();
    expect(component.uriInput).toBe('');
    expect(fetch).not.toHaveBeenCalled();
    expect(websocket).not.toHaveBeenCalled();
  });
});
