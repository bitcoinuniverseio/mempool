import { expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AddressCapabilityService } from './address-capability.service';

it('shares requests only within the selected network and resolves lazy subscriptions against that network', () => {
  const state = { isBrowser: true, network: '' } as any;
  const http = { get: vi.fn(() => of({ features: { addressLookup: { state: state.network ? 'syncing' : 'ready', indexedTip: state.network ? 1 : 900000 } } })) };
  const service = new AddressCapabilityService(http as any, state);
  let answer: any;
  service.getAddressLookup$().subscribe(value => answer = value); expect(answer.state).toBe('ready');
  service.getAddressLookup$().subscribe(); expect(http.get).toHaveBeenCalledTimes(1);
  const delayed = service.getAddressLookup$(); state.network = 'signet';
  delayed.subscribe(value => answer = value); expect(answer.state).toBe('syncing'); expect(answer.indexedTip).toBe(1);
  expect(http.get).toHaveBeenCalledTimes(2);
  state.network = ''; service.getAddressLookup$().subscribe(value => answer = value); expect(answer.state).toBe('ready');
});
it('does not treat malformed states or negative/nonfinite heights as capability evidence', () => {
  const http = {get: () => of({features: {addressLookup: {state:'invented',indexedTip:NaN,bitcoinCoreTip:-1,lagBlocks:Infinity,degradedReason:{private:'data'}}}})};
  const service = new AddressCapabilityService(http as any,{isBrowser:true,network:''} as any);
  service.getAddressLookup$().subscribe(value => {
    expect(value.state).toBe('unavailable'); expect(value.indexedTip).toBeNull(); expect(value.bitcoinCoreTip).toBeNull(); expect(value.lagBlocks).toBeNull(); expect(value.degradedReason).toBeNull();
  });
});
