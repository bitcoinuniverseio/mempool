import { createHash, createECDH } from 'node:crypto';
import { Point } from '@noble/secp256k1';
import { ReplaySubject, Subject, of } from 'rxjs';
import { scanSilentBundle, verifySilentBundle } from './silent-payments-scanner';
import { SilentPaymentsScanComponent } from './silent-payments-scan.component';
import { SilentPaymentsAddressComponent } from './silent-payments-address.component';
import { SILENT_PAYMENT_SAMPLE_ADDRESS } from './silent-payments-samples';
import { SilentPaymentsApiService, SilentPaymentBlockBundle, SilentPaymentBlockManifest } from './silent-payments.service';

const order = Point.CURVE().n;
function key() { const ecdh = createECDH('secp256k1'); ecdh.generateKeys(); return ecdh; }
// OpenSSL exports the scalar without leading zero bytes; BIP352 serializes exactly 32.
function scalarBytes(ecdh: ReturnType<typeof createECDH>): Buffer {
  return Buffer.from(ecdh.getPrivateKey().toString('hex').padStart(64, '0'), 'hex');
}
function tagged(tag: string, bytes: Buffer) { const t=createHash('sha256').update(tag).digest(); return createHash('sha256').update(Buffer.concat([t,t,bytes])).digest(); }
function uint32(n:number, little=false) { const b=Buffer.alloc(4); if(little)b.writeUInt32LE(n);else b.writeUInt32BE(n); return b; }

// Independent sender-side ECDH uses OpenSSL. Ephemeral test scan material is never saved.
function fixture(receiverScalar?: Buffer) {
  const input=key(); const receiver=key(); const spend=key();
  if (receiverScalar) {receiver.setPrivateKey(receiverScalar);}
  const inputPoint=input.getPublicKey(undefined,'compressed');
  const outpoint=Buffer.concat([Buffer.from('01'.repeat(32),'hex'),uint32(7,true)]);
  const inputHash=BigInt('0x'+tagged('BIP0352/Inputs',Buffer.concat([outpoint,inputPoint])).toString('hex'));
  const sender=createECDH('secp256k1');
  sender.setPrivateKey(Buffer.from(((inputHash*BigInt('0x'+input.getPrivateKey().toString('hex')))%order).toString(16).padStart(64,'0'),'hex'));
  // OpenSSL computeSecret gives only X; obtain the full point with its valid public multiplication.
  const shared=Point.fromBytes(receiver.getPublicKey(undefined,'compressed')).multiply(BigInt('0x'+sender.getPrivateKey().toString('hex'))).toBytes();
  expect(Buffer.from(shared).subarray(1)).toEqual(sender.computeSecret(receiver.getPublicKey()));
  const base=Point.fromBytes(spend.getPublicKey(undefined,'compressed'));
  const label=BigInt('0x'+tagged('BIP0352/Label',Buffer.concat([scalarBytes(receiver),uint32(0)])).toString('hex'));
  const outputs=[0,1].map((k) => {
    const tweak=BigInt('0x'+tagged('BIP0352/SharedSecret',Buffer.concat([Buffer.from(shared),uint32(k)])).toString('hex'));
    const p=base.add(Point.BASE.multiply((tweak+(k===1?label:0n))%order));
    return {vout:k,pubkey:p.toHex().slice(2),amount_sats:String(1000+k)};
  });
  const bundle:SilentPaymentBlockBundle={schema_version:1,chain:'bitcoin',network:'signet',height:12,block_hash:'02'.repeat(32),previous_block_hash:'03'.repeat(32),transactions:[{
    txid:'04'.repeat(32),spent_outpoints:[{txid:'02'.repeat(32),vout:0},{txid:'01'.repeat(32),vout:7}],input_pubkeys:[inputPoint.toString('hex')],candidate_outputs:outputs
  }]};
  const raw=JSON.stringify(bundle);
  const manifest:SilentPaymentBlockManifest={schema_version:1,chain:'bitcoin',network:'signet',height:12,block_hash:bundle.block_hash,previous_block_hash:bundle.previous_block_hash,num_inputs:1,candidate_output_count:2,bundle_hash:createHash('sha256').update(raw).digest('hex'),bundle_url:'',created_at:'2026-09-05T00:00:00Z'};
  return {bundle,raw,manifest,scan:scalarBytes(receiver).toString('hex'),spend:spend.getPublicKey(undefined,'compressed').toString('hex')};
}

describe('receiver computation and integrity',()=>{
  it.each(['random', 'leading-zero'] as const)('finds independently constructed base and change-label outputs with a %s scan scalar',async(keyCase)=>{
    const f=fixture(keyCase === 'leading-zero' ? Buffer.from([1]) : undefined);
    const matches=await scanSilentBundle(await verifySilentBundle(f.raw,f.manifest,'signet'),f.scan,f.spend);
    expect(matches.map(m=>m.vout).sort()).toEqual([0,1]);
    expect(matches.map(m=>m.amount_sats).sort()).toEqual(['1000','1001']);
  });
  it('returns a valid non-match for another receiver and honors cancellation',async()=>{
    const f=fixture();
    expect(await scanSilentBundle(f.bundle,scalarBytes(key()).toString('hex'),f.spend)).toEqual([]);
    await expect(scanSilentBundle(f.bundle,f.scan,f.spend,0,()=>true)).rejects.toThrow('cancelled');
  });
  it('rejects tampering, wrong network, wrong public keys and scan public key in the private field',async()=>{
    const f=fixture();
    await expect(verifySilentBundle(f.raw+' ',f.manifest,'signet')).rejects.toThrow('integrity');
    await expect(verifySilentBundle(f.raw,f.manifest,'mainnet')).rejects.toThrow('network');
    await expect(verifySilentBundle(f.raw,f.manifest,'signet',13)).rejects.toThrow('checkpoint');
    await expect(scanSilentBundle(f.bundle,f.spend,f.spend)).rejects.toThrow('32-byte');
    await expect(scanSilentBundle(f.bundle,f.scan,'02'+'00'.repeat(32))).rejects.toThrow();
  });
});

describe('scanner consumer privacy boundary',()=>{
  it('sends the complete BIP321 instruction from the existing address form',()=>{
    const validateAddress$=vi.fn(()=>of({valid:true,network:'mainnet'}));
    const component=new SilentPaymentsAddressComponent({validateAddress$,networkChanges$:new Subject<string>()} as any,{markForCheck:vi.fn()} as any);
    const uri=`bitcoin:?sp=${SILENT_PAYMENT_SAMPLE_ADDRESS}`;
    component.rawInput=uri;component.validate();
    expect(validateAddress$).toHaveBeenCalledWith(uri);
    expect(component.result?.valid).toBe(true);component.ngOnDestroy();
  });
  it.each(['random', 'leading-zero'] as const)('unsubscribes cancelled manifest reads before fetching a bundle with a %s scan scalar',async(keyCase)=>{
    const f=fixture(keyCase === 'leading-zero' ? Buffer.from([1]) : undefined);const pending=new Subject<SilentPaymentBlockManifest>();
    const bundle=vi.fn(()=>of(f.raw));
    const api:any={network:'signet',networkChanges$:new Subject<string>(),getBlockManifest$:()=>pending,getBlockBundleBytes$:bundle};
    const component=new SilentPaymentsScanComponent(api,{markForCheck:vi.fn()} as any);
    component.startHeight=12;component.endHeight=12;component.scanKey=f.scan;component.spendPubkey=f.spend;
    const scan=component.startScan();expect(pending.observed).toBe(true);
    component.cancelScan();await scan;
    expect(pending.observed).toBe(false);expect(bundle).not.toHaveBeenCalled();
    expect(component.scanKey).toBe('');expect(component.detectedOutputs).toEqual([]);expect(component.scanComplete).toBe(false);
    component.ngOnDestroy();
  });
  it('rejects a manifest for a height other than the requested one',()=>{
    const f=fixture();const networks=new ReplaySubject<string>(1);networks.next('signet');
    const api=new SilentPaymentsApiService({get:()=>of(f.manifest)} as any,{network:'signet',networkChanged$:networks,isBrowser:true} as any);
    const received=vi.fn();const rejected=vi.fn();
    api.getBlockManifest$(13).subscribe({next:received,error:rejected});
    expect(received).not.toHaveBeenCalled();expect(rejected).toHaveBeenCalledWith(expect.objectContaining({message:'Source returned a different checkpoint height.'}));
  });
  it('requests only public height/bundle data and clears scan capability after success',async()=>{
    const f=fixture(); const networks=new Subject<string>();
    const manifest=vi.fn(()=>of(f.manifest)); const bundle=vi.fn(()=>of(f.raw));
    const api:any={network:'signet',networkChanges$:networks,getBlockManifest$:manifest,getBlockBundleBytes$:bundle};
    const component=new SilentPaymentsScanComponent(api,{markForCheck:vi.fn()} as any);
    component.startHeight=12;component.endHeight=12;component.scanKey=f.scan;component.spendPubkey=f.spend;
    await component.startScan();
    expect(manifest.mock.calls).toEqual([[12],[12]]);expect(bundle.mock.calls).toEqual([[12]]);
    expect(component.scanComplete).toBe(true);expect(component.detectedOutputs.length).toBe(2);expect(component.scanKey).toBe('');
    component.ngOnDestroy();
  });
  it('preserves selected network in every request and cancels late responses after switching',()=>{
    const networks=new ReplaySubject<string>(1);networks.next('signet');const pending=new Subject<any>();
    const state:any={network:'signet',networkChanged$:networks,isBrowser:true};
    const http:any={get:vi.fn(()=>pending),post:vi.fn(()=>pending)};
    const api=new SilentPaymentsApiService(http,state);const results=vi.fn();
    api.getCoverage$().subscribe(results);
    expect(http.get.mock.calls[0][0]).toContain('?chain=bitcoin&network=signet');
    state.network='';networks.next('');pending.next({chain:'bitcoin',network:'signet'});
    expect(results).not.toHaveBeenCalled();expect(api.path('/payments/silent')).toBe('/payments/silent');
  });
});
