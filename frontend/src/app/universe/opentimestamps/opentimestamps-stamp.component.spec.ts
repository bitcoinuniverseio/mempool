// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { ReplaySubject, Subject, of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { OpenTimestampsApiService } from './opentimestamps.service';
import { OpenTimestampsStampComponent } from './opentimestamps-stamp.component';

const digestA = 'aa'.repeat(32);
const stamped = {
  record_id: 'record-1', digest: digestA, network: 'signet', commitment: 'cc'.repeat(32), ots_proof_base64: 'AAEC', status: 'pending',
  calendars_contacted: [
    { calendar_id: 'universe-signet', url: 'http://127.0.0.1:14788', status: 'pending' },
    { calendar_id: 'other', url: 'https://other.example', status: 'unreachable', error: 'connect ECONNREFUSED' },
  ],
  timestamp: '2026-09-10T00:00:00Z', notices: [],
};

/** A File whose bytes hash to a known digest, or one that cannot be read. */
function file(name: string, bytes: Uint8Array | Error): File {
  const value = new File([bytes instanceof Error ? new Uint8Array() : bytes], name);
  if (bytes instanceof Error) {Object.defineProperty(value, 'arrayBuffer', { value: () => Promise.reject(bytes) });}
  else {Object.defineProperty(value, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) });}
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('OpenTimestamps stamp page', () => {
  beforeAll(() => {
    Object.defineProperty(OpenTimestampsStampComponent, 'ctorParameters', { configurable: true,
      value: () => [{ type: OpenTimestampsApiService }, { type: StateService }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function create() {
    const networkChanged$ = new ReplaySubject<string>(1);
    networkChanged$.next('signet');
    const state = { network: 'signet', networkChanged$ };
    const api = { network: 'signet', stampDigest$: vi.fn(() => of(stamped)), upgradeProof$: vi.fn() };
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: StateService, useValue: state }, { provide: OpenTimestampsApiService, useValue: api }] });
    const view = TestBed.createComponent(OpenTimestampsStampComponent);
    view.detectChanges();
    const choose = async (chosen: File) => {
      const input = view.nativeElement.querySelector('#ots-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { configurable: true, value: [chosen] });
      await view.componentInstance.hashFile({ target: input } as unknown as Event);
      view.detectChanges();
    };
    return { view, component: view.componentInstance, api, state, networkChanged$, choose };
  }

  it('hashes a chosen file locally and sends only its digest', async () => {
    const { view, component, api, choose } = create();
    const bytes = new TextEncoder().encode('a document');
    await choose(file('document.txt', bytes));
    expect(component.digest).toBe(await sha256(bytes));
    expect(component.digestValid).toBe(true);
    component.stamp(); view.detectChanges();
    expect(api.stampDigest$).toHaveBeenCalledWith(component.digest);
    expect(view.nativeElement.textContent).toContain('universe-signet');
    expect(view.nativeElement.textContent).toContain('promised');
    expect(view.nativeElement.textContent).toContain('did not answer');
    expect(view.nativeElement.textContent).not.toContain('[object Object]');
    expect(view.nativeElement.textContent).not.toContain('next Bitcoin block');
    expect(component.proofFileName).toBe('document.txt.ots');
  });

  it('keeps no digest from file A after file B fails to read', async () => {
    const { view, component, choose } = create();
    await choose(file('a.txt', new TextEncoder().encode('first')));
    const digestOfA = component.digest;
    expect(digestOfA).toHaveLength(64);
    await choose(file('b.txt', new Error('read failed')));
    expect(component.digest).toBe('');
    expect(component.digestValid).toBe(false);
    expect(component.fileName).toBe('');
    expect(component.loadError).toContain('could not be read');
    expect(digestOfA).not.toBe('');
    expect(component.proofFileName).not.toContain('b.txt');
    expect((view.nativeElement.querySelector('.btn-primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps no digest from file A after hashing file B fails', async () => {
    const { component, choose } = create();
    await choose(file('a.txt', new TextEncoder().encode('first')));
    const original = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => Promise.reject(new Error('subtle failed')));
    await choose(file('b.txt', new TextEncoder().encode('second')));
    expect(component.digest).toBe('');
    expect(component.fileName).toBe('');
    expect(component.loadError).toContain('could not be read');
    vi.restoreAllMocks();
    expect(await sha256(new TextEncoder().encode('x'))).toBe(Array.from(new Uint8Array(await original('SHA-256', new TextEncoder().encode('x')))).map(b => b.toString(16).padStart(2, '0')).join(''));
  });

  it('drops a hash that finishes after a newer file was chosen', async () => {
    const { component, choose } = create();
    const slow = new Subject<ArrayBuffer>();
    const first = new File([new Uint8Array()], 'slow.txt');
    Object.defineProperty(first, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => slow.subscribe(resolve)) });
    const input = { files: [first] } as unknown as HTMLInputElement;
    const pending = component.hashFile({ target: input } as unknown as Event);
    const secondBytes = new TextEncoder().encode('second');
    await choose(file('fast.txt', secondBytes));
    const expected = await sha256(secondBytes);
    expect(component.digest).toBe(expected);
    slow.next(new TextEncoder().encode('first').buffer);
    await pending;
    expect(component.digest).toBe(expected);
    expect(component.fileName).toBe('fast.txt');
    expect(component.hashing).toBe(false);
  });

  it('treats a typed digest as belonging to no file', async () => {
    const { view, component, choose } = create();
    await choose(file('a.txt', new TextEncoder().encode('first')));
    const input = view.nativeElement.querySelector('#ots-digest') as HTMLInputElement;
    input.value = 'bb'.repeat(32); input.dispatchEvent(new Event('input')); view.detectChanges();
    expect(component.fileName).toBe('');
    expect(component.proofFileName).toBe('bbbbbbbbbbbbbbbb.ots');
  });

  it('clears the result on a network switch and discards a stamp answer from the previous network', () => {
    const { view, component, api, state, networkChanged$ } = create();
    component.digest = digestA;
    const answer = new Subject<unknown>(); api.stampDigest$.mockReturnValue(answer);
    component.stamp();
    state.network = ''; api.network = 'mainnet'; networkChanged$.next('');
    answer.next(stamped); view.detectChanges();
    expect(component.stampResult).toBeNull();
    expect(component.stamping).toBe(false);
    expect(view.nativeElement.textContent).not.toContain('PENDING');
  });

  it('labels an attestation the reader did not verify as answered, not anchored', () => {
    const { view, component, api } = create();
    component.digest = digestA;
    component.stamp();
    api.upgradeProof$.mockReturnValue(of({
      upgraded: true, changed: true, ots_proof_base64: 'AAED', status: 'bitcoin_attestation_invalid', verified: false,
      verification: { errors: ['The proof commitment does not match the Bitcoin Merkle root at height 1.'] },
      calendars: [{ calendar_id: 'universe-signet', calendar_url: 'http://127.0.0.1:14788', status: 'upgraded', detail: 'returned a Bitcoin attestation, not yet verified' }], notices: [],
    }));
    component.checkAttestation(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain('answered, not verified');
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
    expect(view.nativeElement.textContent).toContain('did not verify');
  });
});
