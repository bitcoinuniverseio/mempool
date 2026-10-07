// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AddressComponent } from './address.component';
function setup(): any {
  const c = new AddressComponent(undefined, undefined, undefined, {network:'signet',env:{ROOT_NETWORK:'mainnet'}} as any,
    undefined, undefined, undefined, undefined, undefined);
  c.network='signet';c.addressString='tb1qpublictestaddress';return c;
}
const offered = (c: any): boolean => c.reconstructionOffered ?? ['limit','unavailable'].includes(c.utxoSourceState);
describe('independent reconstruction offer lifetime',()=>{
  it('preserves an already offered tool through same-address native refresh and recovery',()=>{
    const c=setup();c.utxoSourceState='limit';expect(offered(c)).toBe(true);
    for(const state of ['loading','unavailable','complete','loading','limit']){c.utxoSourceState=state;expect(offered(c)).toBe(true);}
  });
  it('does not offer a reconstruction before native capability failure',()=>{
    const c=setup();for(const state of ['idle','loading','complete']){c.utxoSourceState=state;expect(offered(c)).toBe(false);}
  });
  it('forgets an offered tool on a different address and does not resurrect it on return',()=>{
    const c=setup();c.utxoSourceState='limit';c.addressString='tb1qotherpublicaddress';c.utxoSourceState='idle';expect(offered(c)).toBe(false);
    c.addressString='tb1qpublictestaddress';c.utxoSourceState='loading';expect(offered(c)).toBe(false);
  });
  it('scopes the offer to the selected network even for the same test-family address',()=>{
    const c=setup();c.utxoSourceState='unavailable';expect(offered(c)).toBe(true);
    c.network='testnet4';expect(offered(c)).toBe(false);c.utxoSourceState='idle';
    c.network='signet';c.utxoSourceState='loading';expect(offered(c)).toBe(false);
  });
  it('offers an independent read only after an explicit validated completed-scope opt-in, without source calls or false native failure',()=>{
    const c=setup();c.address={address:c.addressString,is_pubkey:false};c.isLoadingAddress=false;c.utxoSourceState='complete';
    expect(c.canOfferIndependentReconstruction).toBe(true);expect(offered(c)).toBe(false);
    c.offerIndependentReconstruction();expect(offered(c)).toBe(true);expect(c.utxoSourceState).toBe('complete');
    c.utxoSourceState='loading';expect(offered(c)).toBe(true);c.network='testnet4';expect(offered(c)).toBe(false);
    c.offerIndependentReconstruction();expect(offered(c)).toBe(false);c.utxoSourceState='idle';c.network='signet';c.utxoSourceState='loading';expect(offered(c)).toBe(false);
  });
  it('rejects loading, stale address, pubkey and non-Bitcoin scope opt-in',()=>{
    for(const mutate of [c=>c.isLoadingAddress=true,c=>c.address.address='tb1qother',c=>c.address.is_pubkey=true,c=>c.network='liquidtestnet',c=>c.utxoSourceState='loading']){
      const c=setup();c.address={address:c.addressString,is_pubkey:false};c.isLoadingAddress=false;c.utxoSourceState='complete';mutate(c);
      expect(c.canOfferIndependentReconstruction).toBe(false);c.offerIndependentReconstruction();expect(offered(c)).toBe(false);
    }
  });
});
