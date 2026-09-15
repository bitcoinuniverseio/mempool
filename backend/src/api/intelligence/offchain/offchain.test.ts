jest.mock('../../blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: () => 860500 } }));
jest.mock('../../fee-api', () => ({ __esModule: true, default: { getRecommendedFee: () => ({ halfHourFee: 7 }) } }));

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as secp256k1 from 'tiny-secp256k1';
import config from '../../../config';
import offchainService, { manifestDigest, verifyManifestSignature } from './offchain.service';

describe('OffchainService', () => {
  beforeEach(() => { config.MEMPOOL.NETWORK='mainnet'; offchainService.resetForTests(); offchainService.registryPath = () => undefined; });

  it('has no operators or offers unless a registry is configured, and says so', () => {
    for(const read of [()=>offchainService.getOverview(),()=>offchainService.listOperators(),()=>offchainService.getOperator('missing'),()=>offchainService.listOffers(),()=>offchainService.getOperatorHistory('missing')])expect(read).toThrow(expect.objectContaining({status:503}));
  });

  it('reads operators and offers from the configured registry file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offchain-registry-'));
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ operators: [{ operator_id: 'op-1', protocol: 'mercury_statechain', operator_public_key: '02' + 'ab'.repeat(32), display_name: 'One', networks: ['mainnet'], supported_versions: [], transfer_capabilities: [], recovery_capabilities: [], endpoints: {clearnet:'https://example.org'} }], offers: [{ offer_id: 'offer-1', maker_id: 'op-1',network:'mainnet',endpoint:'https://example.org',min_amount_sats:1,max_amount_sats:2,base_fee_sats:0,fee_rate_bps:0,supported_timelock_deltas:[] }], history: { 'op-1': [{ event_type: 'manifest_published' }] } }));
    offchainService.registryPath = () => file;
    const overview = offchainService.getOverview();
    expect(overview.total_operators).toBe(1);
    expect(overview.registry.configured).toBe(true);
    expect(offchainService.getOperator('op-1')?.display_name).toBe('One');
    expect(offchainService.getOperatorHistory('op-1')).toHaveLength(1);
    expect(offchainService.listOffers().map(o => o.offer_id)).toEqual(['offer-1']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a broken registry file is reported, not replaced with samples', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offchain-registry-'));
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(file, '{ not json');
    offchainService.registryPath = () => file;
    expect(()=>offchainService.getOverview()).toThrow(expect.objectContaining({status:503,code:'invalid-registry-source'}));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('verifies a manifest only when its signature checks out against the operator key', () => {
    const privateKey = crypto.randomBytes(32);
    const publicKey = Buffer.from(secp256k1.pointFromScalar(privateKey, true)!);
    const manifest = { signature_scheme: 'schnorr' as const, schema_version: '1', protocol: 'mercury_statechain', operator_public_key: publicKey.toString('hex'), display_name: 'Signed', networks: ['signet'], endpoints: {}, supported_versions: ['v1'], backup_transaction_policy: 'decrementing', signature_count_endpoint: 'https://x/count', effective_from: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', nonce: 'n' };
    const schnorr = Buffer.from(secp256k1.signSchnorr(manifestDigest(manifest), privateKey)).toString('hex');
    expect(verifyManifestSignature({ ...manifest, signature: schnorr })).toEqual({ valid: true, scheme: 'schnorr', reason: null });
    expect(offchainService.verifyManifest({ ...manifest, signature: schnorr })).toMatchObject({verified:true,signature_valid:true,operator_authenticated:null});
    const bound = offchainService.verifyManifest({...manifest,signature:schnorr});
    const altered = offchainService.verifyManifest({...manifest,signature:'ab'.repeat(64)});
    expect(bound.declared_scheme).toBe('schnorr');
    expect(bound.manifest_digest).toBe(manifestDigest(manifest).toString('hex'));
    expect(altered.manifest_digest).toBe(bound.manifest_digest);
    expect(altered.input_digest).not.toBe(bound.input_digest);
    expect(altered).toMatchObject({scheme:null,declared_scheme:'schnorr',signature_valid:false,verified:false});
    const sorted = Object.fromEntries(Object.entries({...manifest,signature:schnorr}).sort(([a],[b])=>a<b?-1:a>b?1:0));
    expect(bound.input_digest).toBe(crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex'));
    const ecdsaManifest = { ...manifest, signature_scheme: 'ecdsa' as const };
    const ecdsa = Buffer.from(secp256k1.sign(manifestDigest(ecdsaManifest), privateKey)).toString('hex');
    expect(verifyManifestSignature({ ...ecdsaManifest, signature: ecdsa }).scheme).toBe('ecdsa');
    // A non-empty but wrong signature is not verified; neither is a tampered body.
    expect(offchainService.verifyManifest({ ...manifest, signature: 'ab'.repeat(64) })).toMatchObject({ verified: false });
    expect(offchainService.verifyManifest({ ...manifest, display_name: 'Tampered', signature: schnorr }).verified).toBe(false);
    expect(offchainService.verifyManifest({ ...manifest, signature: schnorr, expires_at: '2020-01-01T00:00:00Z' }).errors).toContain('Manifest has expired');
    expect(offchainService.verifyManifest({ protocol: 'x', operator_public_key: 'short', signature: 'sig' }).errors.length).toBeGreaterThan(0);
  });
  it('rejects unsigned legacy metadata and fabricated heights', async () => {
    await expect(offchainService.verifyTransferPackage({ statechain_id: 'x', backup_transactions: [{ locktime: 5, server_signature: 'anything' }], current_height: 999999 })).rejects.toThrow('Unsupported protocol proof');
    await expect(offchainService.verifyCoinswapPackage({ package_id: 'x', contracts: [{ timelock: 200 }, { timelock: 100 }] })).rejects.toThrow('Unsupported protocol proof');
  });
  it('never authorizes recovery from a supplied height or target locktime', () => {
    for (const height of [1, 999999999]) {
      expect(offchainService.generateRecoveryPlan({ protocol: 'statechain', entity_id: 'x', current_stage: 'ready', target_locktime: 5, current_height: height })).toMatchObject({ recovery_state: 'insufficient_artifacts', earliest_broadcast_height: 0, requires_fee_bump: false, unsigned_psbt_hex: null });
    }
  });
});
import offchainRoutes from './offchain.routes';
describe('offchain registry bounds and authority',()=>{
 beforeEach(()=>{offchainService.resetForTests();config.MEMPOOL.NETWORK='mainnet';});
 function file(bytes:string){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'offchain-bounds-'));const name=path.join(dir,'registry.json');fs.writeFileSync(name,bytes);offchainService.registryPath=()=>name;return name;}
 it.each(['{}','null','{"operators":[],"offers":[],"history":[]}', ' '.repeat(1048577)])('fails closed for malformed or oversized source',bytes=>{
  file(bytes);expect(()=>offchainService.listOperators()).toThrow(expect.objectContaining({status:503}));expect(()=>offchainService.getOperator('missing')).toThrow(expect.objectContaining({status:503}));
 });
 it('retains a valid empty registry and publishes a digest instead of its filesystem path',()=>{
  const name=file(JSON.stringify({operators:[],offers:[],history:{}}));const result=offchainService.getOverview();expect(result.total_operators).toBe(0);expect(result.registry.source).toMatch(/^sha256:[a-f0-9]{64}$/);expect(JSON.stringify(result)).not.toContain(name);expect(offchainService.getOperator('missing')).toBeNull();
 });
 it('invalidates cached results when path changes or is removed',()=>{
  file(JSON.stringify({operators:[],offers:[],history:{}}));offchainService.getOverview();offchainService.registryPath=()=>'/does-not-exist/private';expect(()=>offchainService.getOverview()).toThrow(expect.objectContaining({status:503}));offchainService.registryPath=()=>undefined;expect(()=>offchainService.getOverview()).toThrow(expect.objectContaining({status:503}));
 });
 it('maps missing registry lookups to503 rather than false404',()=>{
  offchainService.registryPath=()=>undefined;const gets:Record<string,Function>={};const app:any={get:(url:string,h:Function)=>{gets[url]=h;return app;},post:()=>app};offchainRoutes.initRoutes(app);
  const res:any={status:jest.fn().mockReturnThis(),json:jest.fn()};gets['/api/v1/intelligence/offchain/operators/:operatorId']({params:{operatorId:'missing'}},res);expect(res.status).toHaveBeenCalledWith(503);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({stage:'unavailable-registry'}));
 });
});
