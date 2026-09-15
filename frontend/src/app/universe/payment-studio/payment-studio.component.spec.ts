import { describe, expect, it, vi } from 'vitest';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { Subject, of } from 'rxjs';
import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Bip353VerifierService } from './bip353-verifier.service';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { PaymentStudioComponent, parseBip21Uri } from './payment-studio.component';

const testAddress = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const mainAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const uri = (query = '') => `bitcoin:${testAddress}${query ? '?' + query : ''}`;

describe('BIP21 payment URI validation', () => {
  it('decodes exact satoshis and RFC3986 text, preserving plus signs and query separators inside values', () => {
    const result = parseBip21Uri(uri('amount=0.00000029&label=Alice+Bob&message=caf%C3%A9%20%26%20tea&pj=https://example.invalid/pj?x%3D1'), 'signet');
    expect(result).toMatchObject({ amountBtc: '0.00000029', amountSats: '29', label: 'Alice+Bob', message: 'café & tea', pj: 'https://example.invalid/pj?x=1' });
  });

  it.each([
    ['0', '0'], ['.5', '50000000'], ['1.', '100000000'],
    ['0001.00000001', '100000001'], ['21000000', '2100000000000000'],
  ])('parses amount %s as %s exact satoshis', (amount, sats) => {
    expect(parseBip21Uri(uri(`amount=${amount}`), 'signet').amountSats).toBe(sats);
  });

  it.each(['', '-1', '+1', '1e-8', 'NaN', 'Infinity', '1,000', '0.000000001', '21000000.00000001', '.', 'garbage'])('rejects malformed/range-invalid amount %s', amount => {
    expect(() => parseBip21Uri(uri(`amount=${amount}`), 'signet')).toThrow();
  });

  it.each(['req-feature=1', 'req-amount=1', '%72eq-feature=1', 'amount=1&amount=2', 'amount=1&%61mount=2', 'label=%ZZ', 'label=%C3%28', 'label=hello world', 'label=x=y'])('rejects unsafe or ambiguous parameters %s', query => {
    expect(() => parseBip21Uri(uri(query), 'signet')).toThrow();
  });

  it('accepts case-insensitive scheme and optional unknown parameters without treating keys as case-insensitive', () => {
    expect(parseBip21Uri(uri('feature=1&Amount=invalid').replace('bitcoin:', 'BITCOIN:'), 'signet').amountBtc).toBeUndefined();
  });

  it.each(['bitcoin:', 'bitcoin:?amount=1', `https:${testAddress}`, `bitcoin://${testAddress}`, `${uri()}#fragment`, 'bitcoin:bc1q89abcdefabbaabbaabbaabbaabbaabbaabba'])('rejects invalid target %s', input => {
    expect(() => parseBip21Uri(input, 'signet')).toThrow();
  });

  it('validates address checksums and selected network for base58 and Segwit', () => {
    expect(parseBip21Uri(`bitcoin:${mainAddress}`, '').address).toBe(mainAddress);
    expect(() => parseBip21Uri(`bitcoin:${mainAddress}`, 'signet')).toThrow();
    expect(() => parseBip21Uri(uri(), '')).toThrow();
    expect(() => parseBip21Uri(`bitcoin:${testAddress.slice(0, -1)}1`, 'signet')).toThrow();
    const hash = Buffer.alloc(20, 42);
    const witness = bitcoinAddress.toBech32(hash, 0, 'tb');
    expect(parseBip21Uri(`bitcoin:${witness}`, 'signet').address).toBe(witness);
    expect(parseBip21Uri(`bitcoin:${witness}`, 'testnet4').address).toBe(witness);
    expect(() => parseBip21Uri(`bitcoin:${witness}`, '')).toThrow();
    const regtest = bitcoinAddress.toBech32(hash, 0, 'bcrt');
    expect(parseBip21Uri(`bitcoin:${regtest}`, 'regtest').address).toBe(regtest);
    expect(() => parseBip21Uri(`bitcoin:${regtest}`, 'signet')).toThrow();
    expect(() => parseBip21Uri(uri(), 'liquid')).toThrow();
  });
});

describe('BIP353 payment URI scope and response lifecycle', () => {
  it('cannot accept a late proof after an edit, and clears a verified result at its TTL', async () => {
    vi.useFakeTimers();
    const networkChanged$ = new Subject<string>();
    const state = { network: 'signet', networkChanged$ };
    const response = { name: 'alice.user._bitcoin-payment.example.com.', network: 'signet', proof: 'proof', ttl: 2 };
    let complete!: (value: any) => void;
    const verifier = { verify: vi.fn(() => new Promise(resolve => { complete = resolve; })) };
    const http = { get: vi.fn(() => of(response)) };
    const component = new PaymentStudioComponent({ setTitle: vi.fn() } as unknown as SeoService,
      state as unknown as StateService, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      http as unknown as HttpClient, verifier as unknown as Bip353VerifierService);
    let result: unknown;
    const sub = component.bip353$.subscribe(value => { result = value; });
    const verified = { name: response.name, uri: uri(), dnssecValid: true, maxCacheTtl: 30, expires: Math.floor(Date.now() / 1000) + 60,
      instructions: { addresses: [testAddress], methods: ['On-chain'], expires: null } };
    component.bip353Name = 'alice@example.com';
    component.resolveBip353();
    expect(http.get.mock.calls[0][0]).toContain('/signet/api/v1/payment-discovery/bip353');
    component.bip353Name = 'bob@example.com';
    component.clearBip353();
    complete(verified);
    await Promise.resolve();
    expect(result).toBeNull();
    component.bip353Name = 'alice@example.com';
    component.resolveBip353();
    complete(verified);
    await Promise.resolve();
    expect(result).toMatchObject({ resolvedAddress: testAddress, dnssecValid: true });
    vi.advanceTimersByTime(2000);
    expect(result).toBeNull();
    expect(component.bip353Error).toContain('expired');
    component.ngOnDestroy(); sub.unsubscribe(); vi.useRealTimers();
  });

  it('rejects a response from another network before verifying its proof', () => {
    const verifier = { verify: vi.fn() };
    const component = new PaymentStudioComponent({ setTitle: vi.fn() } as unknown as SeoService,
      { network: 'signet', networkChanged$: new Subject<string>() } as unknown as StateService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      { get: () => of({ name: 'alice.user._bitcoin-payment.example.com.', network: 'mainnet', proof: 'x', ttl: 30 }) } as unknown as HttpClient,
      verifier as unknown as Bip353VerifierService);
    component.bip353Name = 'alice@example.com';
    component.resolveBip353();
    expect(component.bip353Error).toContain('network');
    expect(verifier.verify).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
});

describe('BIP21 component result lifecycle', () => {
  function create() {
    const networkChanged$ = new Subject<string>();
    const state = { network: 'signet', networkChanged$ };
    const component = new PaymentStudioComponent({ setTitle: vi.fn() } as unknown as SeoService,
      state as unknown as StateService, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      {} as HttpClient, {} as Bip353VerifierService);
    let result: unknown = null;
    const subscription = component.parsedBip21$.subscribe(value => { result = value; });
    return { component, state, result: () => result, close: () => { subscription.unsubscribe(); component.ngOnDestroy(); } };
  }

  it('clears an earlier success before reporting invalid input, and clears errors after correction', () => {
    const view = create();
    view.component.bip21Uri = uri('amount=0.00000029');
    view.component.parseBip21();
    expect(view.result()).toMatchObject({ amountSats: '29' });
    view.component.bip21Uri = 'https:bad';
    view.component.parseBip21();
    expect(view.result()).toBeNull();
    expect(view.component.bip21Error).toBeTruthy();
    view.component.bip21Uri = uri('amount=1');
    view.component.parseBip21();
    expect(view.component.bip21Error).toBeNull();
    expect(view.result()).toMatchObject({ amountSats: '100000000' });
    view.close();
  });

  it('clears success immediately on edits and network changes, and unsubscribes on destroy', () => {
    const view = create();
    view.component.bip21Uri = uri();
    view.component.parseBip21();
    view.component.clearBip21();
    expect(view.result()).toBeNull();
    view.component.parseBip21();
    view.state.network = '';
    view.state.networkChanged$.next('');
    expect(view.result()).toBeNull();
    view.component.parseBip21();
    expect(view.component.bip21Error).toContain('another network');
    view.close();
    expect(view.state.networkChanged$.observed).toBe(false);
  });
});
