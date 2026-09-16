import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { LightningStandardsComponent } from './lightning-standards.component';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

function component(failedOffers = false) {
  const api = {
    getBolt12Offers$: () => failedOffers ? throwError(() => new HttpErrorResponse({ status: 503 })) : of({ offers: [] }),
    getLightningRfq$: () => of({ quotes: [{ quoteId: 'owned-quote', validUntil: 1700000000 }] }),
  } as unknown as UniverseApiService;
  return new LightningStandardsComponent(api, { setTitle: vi.fn() } as unknown as SeoService, {network:'signet',networkChanged$:new Subject()} as any, {markForCheck:vi.fn()} as any);
}

describe('Lightning standards source evidence', () => {
  it('does not promote false or absent source validity to verification', () => {
    const view = component();
    expect(view.offerValidityLabel(true)).toBe('Source reports valid');
    expect(view.offerValidityLabel(false)).toBe('Source reports invalid');
    expect(view.offerValidityLabel(undefined)).toBe('Validity not reported');
    expect(view.offerValidityLabel('true')).toBe('Validity not reported');
  });

  it('renders the supplied Unix expiry, including an expired quote, without renewing it', () => {
    const view = component();
    expect(view.quoteExpiry(1700000000)).toBe('2023-11-14T22:13:20.000Z');
    expect(view.quoteExpiry(NaN)).toBe('Not reported');
    expect(view.quoteExpiry(-1)).toBe('Not reported');
  });

  it('retains the successful RFQ data while exposing offers unavailability', () => {
    const view = component(true);
    view.ngOnInit();
    let observed: any;
    const subscription = view.vm$.subscribe(value => { observed = value; });
    expect(observed.kind).toBe('error');
    expect(observed.offersError).toBeTruthy();
    expect(observed.quotesError).toBeNull();
    expect(observed.quotes[0].quoteId).toBe('owned-quote');
    subscription.unsubscribe();
    view.ngOnDestroy();
  });
});

const input='lno1test';
// Contract fixture only: no native parsing or payment acceptance is inferred from this response.
const decoded:any={status:'decoded',syntax_valid:true,engine:'lightning-0.2.6',network:'signet',input_sha256:bytesToHex(sha256(new TextEncoder().encode(input))),offer_id:'a'.repeat(64),canonical_offer:input,tlv_hex:'0102',description:'unit contract',issuer:null,issuer_signing_pubkey:null,amount:{kind:'currency',currency:'USD',amount_minor_units:'18446744073709551615'},quantity:{kind:'one'},absolute_expiry:null,expired:false,network_compatible:true,unknown_required_features:false,usable_for_invoice_request:true,chain_hashes_wire_order:['b'.repeat(64)],blinded_path_count:0,signature_status:'not-applicable-unsigned-offer',payment_verified:false,scope:'Unit fixture, not native evidence'};
function decoder() {
  const network={network:'signet',networkChanged$:new Subject<string>()},responses:Subject<any>[]=[];
  const api:any={network:'signet',getBolt12Offers$:()=>of({offers:[]}),getLightningRfq$:()=>of({quotes:[]}),decodeBolt12Offer$:vi.fn(()=>{const response=new Subject();responses.push(response);return response;})};
  const page=new LightningStandardsComponent(api,{setTitle:vi.fn()} as any,network as any,{markForCheck:vi.fn()} as any);page.ngOnInit();page.offerInput=input;
  return{page,network,api,responses};
}
describe('BOLT12 native offer response boundary',()=>{
  it('preserves exact decimal amounts and unsigned, unpaid semantics',()=>{
    const {page,responses}=decoder();page.decode();responses[0].next(decoded);
    expect(page.amountLabel(page.decodedOffer!)).toBe('18446744073709551615 USD minor units');expect(page.decodedOffer?.payment_verified).toBe(false);page.ngOnDestroy();
  });
  it.each([{input_sha256:'c'.repeat(64)},{network:'mainnet'},{payment_verified:true},{signature_status:'verified'},{usable_for_invoice_request:false},{amount:{kind:'bitcoin',amount_msat:1000}}])('rejects mismatched or malformed native evidence %j',change=>{
    const {page,responses}=decoder();page.decode();responses[0].next({...decoded,...change});expect(page.decodedOffer).toBeNull();expect(page.decodeUnavailable).toBe(true);page.ngOnDestroy();
  });
  it('clears pending/successful decoding on edits and network change',()=>{
    const {page,network,api,responses}=decoder();page.decode();page.offerInput='new input';page.clearDecode();responses[0].next(decoded);expect(page.decodedOffer).toBeNull();expect(responses[0].observed).toBe(false);
    page.offerInput=input;page.decode();responses[1].next(decoded);expect(page.decodedOffer).toBeTruthy();api.network='regtest';network.network='regtest';network.networkChanged$.next('regtest');expect(page.offerInput).toBe('');expect(page.decodedOffer).toBeNull();page.ngOnDestroy();
  });
  it('distinguishes native parse rejection and absent executable',()=>{
    const {page,responses}=decoder();page.decode();responses[0].error({status:400,error:{error:'Invalid offer'}});expect(page.decodeUnavailable).toBe(false);expect(page.decodeError).toBe('Invalid offer');
    page.decode();responses[1].error({status:503,error:{error:'Native decoder unavailable'}});expect(page.decodeUnavailable).toBe(true);page.ngOnDestroy();
  });
  it('rejects wrong object types and oversized strings before transport',()=>{
    const {page,api}=decoder();page.offerInput='lnr1request';page.decode();expect(api.decodeBolt12Offer$).not.toHaveBeenCalled();page.offerInput='lno1'+'q'.repeat(16384);page.decode();expect(api.decodeBolt12Offer$).not.toHaveBeenCalled();page.ngOnDestroy();
  });
});
