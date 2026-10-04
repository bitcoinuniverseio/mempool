import { describe, expect, it, vi, afterEach } from 'vitest';
import { of, Subject } from 'rxjs';
import { checkedOfferPage, listedOfferAmount } from './bolt12-offer-page';
import { LightningStandardsComponent } from './lightning-standards.component';

const offer = (id = '1'.repeat(64)): any => ({offerId:id, decoderOfferId:'f'.repeat(64), offerString:'lno1test', description:'Owned observation',
  amountMsat:'18446744073709551615', blindRoutesCount:1, valid:true, expiryAtomic:null, syntaxValid:true, sourceActive:true, sourceUsed:false,
  singleUse:true, networkCompatible:true, unknownRequiredFeatures:false, validity:'usable-unverified', invoiceAvailability:'unverified', paymentVerified:false});
const page = (offers = Array.from({length:20},(_,i)=>offer((i+1).toString(16).padStart(64,'0'))), nextCursor: string | null = 'opaque.cursor', total = 21): any => ({offers,total,nextCursor,source:{implementation:'CoreLightning',version:'v26.06.8',nodeId:'02'+'a'.repeat(64),network:'signet',
  genesisHash:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',signetChallenge:'51',publicationSha256:'c'.repeat(64),observedAt:'2026-10-04T00:00:00.000Z',checkpoint:{height:100,hash:'a'.repeat(64)},catalogAnchor:{height:100,hash:'a'.repeat(64)},scope:'Intentionally published owned-node offers; invoice availability unverified.'}});
function fixture() {
  const responses:Subject<any>[] = [], networkChanged$ = new Subject<string>();
  const api:any = {network:'signet',getBolt12Offers$:vi.fn(()=>{const result=new Subject<any>();responses.push(result);return result;}),getLightningRfq$:()=>of({quotes:[]})};
  const component = new LightningStandardsComponent(api,{setTitle:vi.fn()} as any,{network:'signet',networkChanged$} as any,{markForCheck:vi.fn()} as any);
  let vm:any; component.vm$.subscribe(value=>vm=value);component.ngOnInit();
  return {component,api,responses,networkChanged$,vm:()=>vm};
}
afterEach(()=>vi.useRealTimers());
describe('Owned BOLT12 offer pagination boundary',()=>{
  it('preserves exact u64 amounts/expiry and distinct catalog/decoder identifiers without payment claims',()=>{
    const row={...offer(),amountMsat:undefined,currency:'USD',currencyAmountAtomic:'18446744073709551615',expiryAtomic:'18446744073709551615'};
    const result=checkedOfferPage(page([row],null,1),'signet',20);
    expect(listedOfferAmount(result.offers[0])).toBe('18446744073709551615 USD minor units');
    expect(result.offers[0].expiryAtomic).toBe('18446744073709551615');expect(result.offers[0].offerId).not.toBe(result.offers[0].decoderOfferId);
    expect(result.offers[0].paymentVerified).toBe(false);expect(result.offers[0].invoiceAvailability).toBe('unverified');
  });
  it.each(['duplicate','empty-continuation','changed-total','changed-node','changed-publication','changed-anchor','backwards-tip','foreign-network','false-payment','rounded-amount','false-validity','overflow-expiry'])('rejects %s before appending',mutation=>{
    const first=checkedOfferPage(page(),'signet',20), next=page([offer('2'.repeat(64))],null,21);
    if(mutation==='duplicate')next.offers=[first.offers[0]];if(mutation==='empty-continuation')next.offers=[];
    if(mutation==='changed-total')next.total=3;if(mutation==='changed-node')next.source.nodeId='03'+'b'.repeat(64);
    if(mutation==='changed-publication')next.source.publicationSha256='d'.repeat(64);if(mutation==='changed-anchor')next.source.catalogAnchor.hash='e'.repeat(64);
    if(mutation==='backwards-tip')next.source.checkpoint.height=99;if(mutation==='foreign-network')next.source.network='mainnet';
    if(mutation==='false-payment')next.offers[0].paymentVerified=true;if(mutation==='rounded-amount')next.offers[0].amountMsat=Number.MAX_SAFE_INTEGER;
    if(mutation==='false-validity')next.offers[0].sourceActive=false;if(mutation==='overflow-expiry')next.offers[0].expiryAtomic='18446744073709551616';
    expect(()=>checkedOfferPage(next,'signet',20,first)).toThrow();expect(first.offers).toHaveLength(20);
  });
  it.each(['usable-unverified','source-disabled','already-used','expired','wrong-chain','unsupported-required-features'])('shows %s as observation eligibility, never payment or invoice success',validity=>{
    const row=offer();row.validity=validity;row.valid=validity==='usable-unverified';
    if(validity==='source-disabled')row.sourceActive=false;if(validity==='already-used')row.sourceUsed=true;
    if(validity==='expired')row.expiryAtomic='1';if(validity==='wrong-chain')row.networkCompatible=false;
    if(validity==='unsupported-required-features')row.unknownRequiredFeatures=true;
    const result=checkedOfferPage(page([row],null,1),'signet',20);expect(result.offers[0].validity).toBe(validity);
    expect(result.offers[0].invoiceAvailability).toBe('unverified');expect(result.offers[0].paymentVerified).toBe(false);
  });
  it('manual continuation prevents duplicates, retries same cursor after source failure, and appends once',()=>{
    const f=fixture();f.responses[0].next(page());f.component.moreOffers();f.component.moreOffers();
    expect(f.api.getBolt12Offers$.mock.calls).toEqual([[20,undefined],[20,'opaque.cursor']]);expect(f.vm().offersPending).toBe(true);
    f.responses[1].error({status:503});expect(f.vm().offers).toHaveLength(20);expect(f.vm().offersError).toBeTruthy();
    f.component.retryOffers();expect(f.api.getBolt12Offers$.mock.calls[2]).toEqual([20,'opaque.cursor']);
    f.responses[2].next(page([offer('2'.repeat(64))],null,21));expect(f.vm().offers).toHaveLength(21);expect(f.vm().offersPending).toBe(false);expect(f.vm().offerPage.nextCursor).toBeNull();
    f.component.moreOffers();expect(f.api.getBolt12Offers$).toHaveBeenCalledTimes(3);f.component.ngOnDestroy();
  });
  it('409 retains accepted observation and forces explicit restart instead of replaying changed cursor',()=>{
    const f=fixture();f.responses[0].next(page());f.component.moreOffers();f.responses[1].error({status:409});
    expect(f.vm().offers).toHaveLength(20);expect(f.vm().restartRequired).toBe(true);f.component.retryOffers();f.component.moreOffers();expect(f.api.getBolt12Offers$).toHaveBeenCalledTimes(2);
    f.component.restartOffers();expect(f.api.getBolt12Offers$.mock.calls[2]).toEqual([20,undefined]);f.responses[2].next(page([],null,0));
    expect(f.vm().offers).toEqual([]);expect(f.vm().offerPage.total).toBe(0);expect(f.vm().restartRequired).toBe(false);f.component.ngOnDestroy();
  });
  it('network replacement clears prior rows/provenance, cancels reads, and destroy prevents later retries',()=>{
    const f=fixture();f.responses[0].next(page());f.component.moreOffers();f.api.network='testnet';f.networkChanged$.next('testnet');
    expect(f.responses[1].observed).toBe(false);expect(f.vm().offers).toEqual([]);expect(f.vm().offerPage).toBeUndefined();
    f.responses[1].next(page([offer('2'.repeat(64))],null,21));expect(f.vm().offerPage).toBeUndefined();
    f.component.ngOnDestroy();expect(f.responses[2].observed).toBe(false);f.component.restartOffers();expect(f.api.getBolt12Offers$).toHaveBeenCalledTimes(3);
  });
  it('bounds a hanging page and permits an explicit retry without converting failure to empty success',()=>{
    vi.useFakeTimers();const f=fixture();vi.advanceTimersByTime(20001);expect(f.responses[0].observed).toBe(false);
    expect(f.vm().offersPending).toBe(false);expect(f.vm().offersError).toBeTruthy();expect(f.vm().offerPage).toBeUndefined();
    f.component.retryOffers();expect(f.api.getBolt12Offers$).toHaveBeenCalledTimes(2);f.component.ngOnDestroy();
  });
});
