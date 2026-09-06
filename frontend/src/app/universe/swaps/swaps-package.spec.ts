import { describe, expect, it, vi } from 'vitest';
import * as bitcoinjs from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { publicSwapPackage, checkRecoveryArtifact } from './swaps-package';
import { SwapsRecoverComponent } from './swaps-recover.component';
import { SwapsApiService } from './swaps.service';
import { SwapsProvidersComponent } from './swaps-providers.component';
import { SwapsProviderDetailComponent } from './swaps-provider-detail.component';
import { SwapsInspectComponent } from './swaps-inspect.component';

// Handler tests use the real components; shared visual dependencies require a browser.
vi.mock('@app/shared/shared.module', () => ({ SharedModule: class {} }));

// The fixture serializer is bitcoinjs, while the browser verification uses scure.
// Both are declared frontend dev dependencies, so this spec resolves them from
// its own package rather than reaching into a sibling package's install tree,
// which the job that runs this spec never installs.
const { Psbt, Transaction, payments, networks, initEccLib, script, crypto } = bitcoinjs;
initEccLib(ecc);
const secret = Buffer.alloc(32, 1), pub = Buffer.from(ecc.xOnlyPointFromScalar(secret));
const leaf = script.compile([pub, script.OPS.OP_CHECKSIGVERIFY, script.number.encode(200), script.OPS.OP_CHECKLOCKTIMEVERIFY]);
const claimLeaf = script.compile([script.OPS.OP_HASH160, crypto.ripemd160(Buffer.alloc(32, 4)), script.OPS.OP_EQUALVERIFY, pub, script.OPS.OP_CHECKSIG]);
const payment = payments.p2tr({ internalPubkey: pub, network: networks.testnet, scriptTree: [{ output: leaf }, { output: claimLeaf }], redeem: { output: leaf, redeemVersion: 0xc0 } });
const destination = payments.p2wpkh({ pubkey: Buffer.from(ecc.pointFromScalar(secret)), network: networks.testnet }).address;
const prev = new Transaction(); prev.addInput(Buffer.alloc(32, 8), 0); prev.addOutput(payment.output, 100000);
const psbt = new Psbt({ network: networks.testnet }); psbt.setVersion(2).setLocktime(200);
psbt.addInput({ hash: prev.getId(), index: 0, sequence: 0xfffffffd, nonWitnessUtxo: prev.toBuffer(), witnessUtxo: prev.outs[0], tapInternalKey: pub, tapMerkleRoot: payment.hash, tapLeafScript: [{ script: leaf, controlBlock: payment.witness[1], leafVersion: 0xc0 }] });
psbt.addOutput({ address: destination, value: 99000 });
const pkg = { chain: 'bitcoin', network: 'signet', protocol_id: 'boltz_submarine_v2', swap_type: 'submarine', lockup_transaction: prev.getId(), lockup_vout: 0, lockup_address: payment.address, internal_key: pub.toString('hex'), refund_public_key: pub.toString('hex'), expected_amount_sats: 100000, timeout_height: 200, destination_address: destination, fee_sats: 1000 };
const plan: any = { stage: 'unsigned-plan-ready', unsigned_recovery_psbt: psbt.toBase64(), notes: [], source_context: { chain: 'bitcoin', network: 'signet', source_id: 'controlled-unit-authority', block_height: 200, block_hash: '11'.repeat(32), observed_at: '2026-09-05T00:00:00.000Z' } };

describe('Public swap recovery package boundary', () => {
  it('rejects malformed, private, oversized and network-mismatched packages before HTTP', () => {
    expect(() => publicSwapPackage('bad', 'signet')).toThrow(/JSON/);
    expect(() => publicSwapPackage(JSON.stringify({ ...pkg, preimage: 'private' }), 'signet')).toThrow(/public contract fields/);
    expect(() => publicSwapPackage(JSON.stringify({ ...pkg, current_height: 9999999 }), 'signet')).toThrow(/public contract fields/);
    expect(() => publicSwapPackage(' '.repeat(20000), 'signet')).toThrow(/16 KiB/);
    expect(() => publicSwapPackage(JSON.stringify(pkg), 'mainnet')).toThrow(/chain\/network/);
  });
  it('independently decodes a complete bitcoinjs PSBT with scure', () => expect(() => checkRecoveryArtifact(plan, pkg, 'signet')).not.toThrow());
  it('rejects a refund key or lockup script that differs from the intended contract', () => {
    expect(() => checkRecoveryArtifact(plan, { ...pkg, refund_public_key: Buffer.from(ecc.xOnlyPointFromScalar(Buffer.alloc(32, 2))).toString('hex') }, 'signet')).toThrow();
    expect(() => checkRecoveryArtifact(plan, { ...pkg, lockup_address: payments.p2tr({ internalPubkey: pub, network: networks.testnet }).address }, 'signet')).toThrow();
  });
  it.each(['script', 'controlBlock'])('rejects an altered refund %s despite valid transaction amounts', field => {
    const altered = Psbt.fromBase64(psbt.toBase64());
    altered.data.inputs[0].tapLeafScript[0][field][1] ^= 1;
    expect(() => checkRecoveryArtifact({ ...plan, unsigned_recovery_psbt: altered.toBase64() }, pkg, 'signet')).toThrow();
  });
  it('requires complete prevout data and a mature checkpoint', () => {
    const altered = Psbt.fromBase64(psbt.toBase64()); delete altered.data.inputs[0].nonWitnessUtxo;
    expect(() => checkRecoveryArtifact({ ...plan, unsigned_recovery_psbt: altered.toBase64() }, pkg, 'signet')).toThrow();
    expect(() => checkRecoveryArtifact({ ...plan, source_context: { ...plan.source_context, block_height: 199 } }, pkg, 'signet')).toThrow();
  });
  it('rejects a sighash that does not commit to all outputs', () => {
    const altered = Psbt.fromBase64(psbt.toBase64()); altered.data.inputs[0].sighashType = 2;
    expect(() => checkRecoveryArtifact({ ...plan, unsigned_recovery_psbt: altered.toBase64() }, pkg, 'signet')).toThrow();
  });
  it.each([{ lockup_vout: 1 }, { fee_sats: 999 }, { expected_amount_sats: 90000 }, { timeout_height: 201 }, { destination_address: 'wrong' }])('rejects changed intended output %j', changes => expect(() => checkRecoveryArtifact(plan, { ...pkg, ...changes }, 'signet')).toThrow());
  it('rejects truncated artifacts or wrong source network', () => {
    expect(() => checkRecoveryArtifact({ ...plan, unsigned_recovery_psbt: 'cHNidP8=' }, pkg, 'signet')).toThrow();
    expect(() => checkRecoveryArtifact(plan, pkg, 'mainnet')).toThrow(/context/);
  });
});

describe('Recovery form actual handlers', () => {
  const make = () => {
    const network = new Subject<string>(); const response = new Subject<any>();
    const api: any = { network: 'signet', network$: network, recover$: vi.fn(() => response) };
    const component = new SwapsRecoverComponent(api, { markForCheck: vi.fn() } as any, { navigateByUrl: vi.fn() } as any);
    component.ngOnInit(); component.raw = JSON.stringify(pkg); component.destination = destination; component.fee = 1000;
    return { component, api, response, network };
  };
  it('sends public fields and exposes only an independently decoded artifact', () => {
    const { component, api, response } = make(); component.generate(); expect(api.recover$).toHaveBeenCalledWith(pkg, 'signet');
    response.next({ recovery_plan: plan }); expect(component.decoded).toBe(true); expect(component.plan?.stage).toBe('unsigned-plan-ready'); component.ngOnDestroy();
  });
  it('rejects malformed private packages before the real service method', () => {
    const { component, api } = make(); component.raw = JSON.stringify({ ...pkg, privateKey: 'do-not-send' }); component.generate(); expect(api.recover$).not.toHaveBeenCalled(); expect(component.error).toContain('public contract'); component.ngOnDestroy();
  });
  it('cancels pending generation on edit and network switch', () => {
    const { component, response, network } = make(); component.generate(); component.reset(); response.next({ recovery_plan: plan }); expect(component.plan).toBeNull();
    component.generate(); network.next('mainnet'); response.next({ recovery_plan: plan }); expect(component.plan).toBeNull(); expect(component.loading).toBe(false); component.ngOnDestroy();
  });
  it('ignores stale file imports after an edit or network change', async () => {
    const { component, network } = make();
    let resolveFile!: (value: string) => void;
    const event = { target: { files: [{ size: 100, text: () => new Promise<string>(resolve => { resolveFile = resolve; }) }] } } as unknown as Event;
    const pending = component.importFile(event);
    component.raw = 'new editor value'; component.reset(); network.next('mainnet');
    resolveFile('old imported value'); await pending;
    expect(component.raw).toBe('new editor value'); component.ngOnDestroy();
  });
  it('shows file read failures without an unhandled rejection', async () => {
    const { component } = make();
    await component.importFile({ target: { files: [{ size: 100, text: () => Promise.reject(new Error('read failed')) }] } } as unknown as Event);
    expect(component.error).toContain('could not be read'); component.ngOnDestroy();
  });
  it('renders unavailable, waiting and spent states without an artifact', () => {
    for (const stage of ['unavailable-source', 'not-yet-mature', 'already-spent']) {
      const { component, response } = make(); component.generate(); response.next({ recovery_plan: { stage, notes: [stage] } }); expect(component.plan?.stage).toBe(stage); expect(component.decoded).toBe(false); component.ngOnDestroy();
    }
  });
  it('does not convert HTTP failure into fabricated success', () => { const { component, response } = make(); component.generate(); response.error({ error: { error: 'node unavailable' } }); expect(component.error).toBe('node unavailable'); expect(component.plan).toBeNull(); component.ngOnDestroy(); });
});

describe('Swaps consumer network and error boundary', () => {
  it('forwards selected network and propagates errors instead of returning seeded state', () => {
    const pending = new Subject<any>(), changes = new Subject<string>();
    const http: any = { get: vi.fn(() => pending) }; const state: any = { network: 'signet', networkChanged$: changes, isBrowser: true };
    const api = new SwapsApiService(http, state), error = vi.fn(); api.getOverview$().subscribe({ error });
    expect(http.get).toHaveBeenCalledWith('/api/v1/intelligence/swaps/overview', { params: { chain: 'bitcoin', network: 'signet' } });
    pending.error(new Error('offline')); expect(error).toHaveBeenCalled(); expect(api.path('/swaps/recover')).toBe('/signet/swaps/recover');
  });
  it('binds provider lookups to the requested network and encodes provider identifiers', () => {
    const http: any = { get: vi.fn(() => of(null)) };
    const api = new SwapsApiService(http, { network: 'mainnet', isBrowser: true } as any);
    api.getProviders$('signet').subscribe(); api.getProviderById$('provider/name', 'signet').subscribe();
    expect(http.get).toHaveBeenNthCalledWith(1, '/api/v1/intelligence/swaps/providers', { params: { chain: 'bitcoin', network: 'signet' } });
    expect(http.get).toHaveBeenNthCalledWith(2, '/api/v1/intelligence/swaps/providers/provider%2Fname', { params: { chain: 'bitcoin', network: 'signet' } });
  });
  it('retains unavailable-registry errors and resumes provider reads after a network change', () => {
    const network$ = new BehaviorSubject('signet'), first = new Subject<any>(), second = new Subject<any>();
    const api: any = { network$, getProviders$: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const component = new SwapsProvidersComponent(api, { markForCheck: vi.fn() } as any);
    component.ngOnInit();
    first.error({ status: 503, error: { stage: 'unavailable-registry', error: 'Authenticated registry unavailable.' } });
    expect(component.error).toBe('Authenticated registry unavailable.'); expect(component.loading).toBe(false);
    network$.next('testnet'); expect(api.getProviders$).toHaveBeenLastCalledWith('testnet');
    expect(component.error).toBe(''); expect(component.loading).toBe(true);
    second.next([]); expect(component.providers).toEqual([]); expect(component.loading).toBe(false);
    component.ngOnDestroy();
  });
  it('clears previous provider data and ignores delayed responses after switching networks', () => {
    const network$ = new BehaviorSubject('signet'), first = new Subject<any>(), second = new Subject<any>();
    const api: any = { network$, getProviders$: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const component = new SwapsProvidersComponent(api, { markForCheck: vi.fn() } as any);
    component.ngOnInit(); first.next([{ provider_id: 'unit-old-network' }]);
    network$.next('testnet'); expect(component.providers).toEqual([]);
    first.next([{ provider_id: 'unit-stale' }]); expect(component.providers).toEqual([]);
    component.ngOnDestroy(); second.next([{ provider_id: 'unit-after-destroy' }]); expect(component.providers).toEqual([]);
  });
  it('distinguishes provider lookup failures and clears stale details on route and network changes', () => {
    const network$ = new BehaviorSubject('signet'), paramMap = new BehaviorSubject(convertToParamMap({ providerId: 'first' }));
    const requests: Subject<any>[] = [];
    const api: any = { network$, getProviderById$: vi.fn(() => { const request = new Subject<any>(); requests.push(request); return request; }) };
    const component = new SwapsProviderDetailComponent({ paramMap } as any, api, { markForCheck: vi.fn() } as any);
    component.ngOnInit(); requests[0].next({ name: 'Unit first' }); expect(component.provider?.name).toBe('Unit first');
    paramMap.next(convertToParamMap({ providerId: 'second' })); expect(component.provider).toBeUndefined();
    requests[0].next({ name: 'Stale' }); expect(component.provider).toBeUndefined();
    requests[1].error({ status: 404, error: { stage: 'unknown-provider', error: 'Unknown provider identity.' } });
    expect(component.error).toBe('Unknown provider identity.');
    network$.next('testnet'); expect(api.getProviderById$).toHaveBeenLastCalledWith('second', 'testnet');
    requests[2].error({ status: 503, error: { stage: 'unavailable-registry', error: 'Registry unavailable.' } });
    expect(component.error).toBe('Registry unavailable.'); expect(component.provider).toBeUndefined();
    component.ngOnDestroy();
  });
  it('never substitutes a catalog provider when the route has no identity', () => {
    const api: any = { network$: of('signet'), getProviderById$: vi.fn() };
    const component = new SwapsProviderDetailComponent({ paramMap: of(convertToParamMap({})) } as any, api, { markForCheck: vi.fn() } as any);
    component.ngOnInit(); expect(api.getProviderById$).not.toHaveBeenCalled();
    expect(component.error).toBe('A provider identity is required.'); expect(component.loading).toBe(false); component.ngOnDestroy();
  });
});

describe('Inspector local operation and evidence boundary', () => {
  it('validates public JSON locally without sending evidence requests or accepting private fields', () => {
    const api: any = { network: 'signet', network$: of('signet'), verify$: vi.fn() };
    const component = new SwapsInspectComponent(api, { markForCheck: vi.fn() } as any);
    component.raw = JSON.stringify(pkg); component.inspect();
    expect(component.message).toContain('This checks structure only'); expect(api.verify$).not.toHaveBeenCalled();
    component.raw = JSON.stringify({ ...pkg, preimage: 'private' }); component.verify();
    expect(component.error).toContain('public contract fields'); expect(api.verify$).not.toHaveBeenCalled(); component.ngOnDestroy();
  });
  it('cancels stale inspector evidence and retains a real request failure', () => {
    const network$ = new Subject<string>(), first = new Subject<any>(), second = new Subject<any>();
    const api: any = { network: 'signet', network$, verify$: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const component = new SwapsInspectComponent(api, { markForCheck: vi.fn() } as any);
    component.raw = JSON.stringify(pkg); component.verify();
    expect(api.verify$).toHaveBeenCalledWith(pkg, 'signet'); network$.next('testnet');
    first.next({ lockup: { verified: true } }); expect(component.result).toBeNull();
    component.verify(); second.error({ error: { error: 'Owned node unavailable.' } });
    expect(component.error).toBe('Owned node unavailable.'); expect(component.result).toBeNull(); component.ngOnDestroy();
  });
});
