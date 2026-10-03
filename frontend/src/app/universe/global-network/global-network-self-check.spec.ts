import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { GlobalNetworkSelfCheckComponent } from './global-network-self-check.component';

const receipt = () => ({ check_id: 'test-owned', endpoint_address: 'example.org', port: 8333,
  resolved_address: '93.184.216.7', probed_from_region: 'local test server', reachable: true,
  bip324_handshake: null, latency_ms: 12, error: null, probed_at: '2026-10-03T00:00:00Z' });
function setup() {
  const network = new BehaviorSubject('signet');
  const api = { performSelfCheck$: vi.fn().mockReturnValue(of(receipt())) };
  const component = new GlobalNetworkSelfCheckComponent(api as any, { markForCheck: vi.fn() } as any,
    { network: 'signet', networkChanged$: network } as any);
  component.ngOnInit(); component.endpointAddress = 'example.org';
  return { component, api, network };
}
afterEach(() => vi.useRealTimers());

describe('TCP-only public endpoint consumer', () => {
  it('guards pending calls and cancels old-network requests without accepting late results', () => {
    const { component, api, network } = setup(); const pending = new Subject();
    api.performSelfCheck$.mockReturnValue(pending); component.runSelfCheck(); component.runSelfCheck();
    expect(api.performSelfCheck$).toHaveBeenCalledOnce(); network.next('testnet');
    expect(pending.observed).toBe(false); expect(component.probing).toBe(false);
    pending.next(receipt()); expect(component.result).toBeNull();
  });
  it('cancels on destroy and refuses subsequent calls', () => {
    const { component, api } = setup(); const pending = new Subject();
    api.performSelfCheck$.mockReturnValue(pending); component.runSelfCheck(); component.ngOnDestroy();
    expect(pending.observed).toBe(false); component.runSelfCheck();
    expect(api.performSelfCheck$).toHaveBeenCalledOnce();
  });
  it('rejects foreign request identity, invalid values and invented handshake claims', () => {
    for (const changed of [{ endpoint_address: 'other.example' }, { port: 1 }, { reachable: 'yes' },
      { latency_ms: -1 }, { bip324_handshake: true }, { probed_at: 'invalid' }, { check_id: '' }]) {
      const { component, api } = setup(); api.performSelfCheck$.mockReturnValue(of({ ...receipt(), ...changed }));
      component.runSelfCheck(); expect(component.result).toBeNull(); expect(component.errorMessage).toBeTruthy();
    }
  });
  it('refuses whitespace endpoints and invalid port boundaries before HTTP dispatch', () => {
    for (const [host, port] of [[' ', 8333], ['example.org', 0], ['example.org', 65536], ['example.org', 1.5], ['example.org', NaN]] as const) {
      const { component, api } = setup(); component.endpointAddress = host; component.port = port;
      component.runSelfCheck(); expect(api.performSelfCheck$).not.toHaveBeenCalled();
    }
  });
  it('retains failure input for retry, accepts TCP-only success and clears projection on edits', () => {
    const { component, api } = setup(); api.performSelfCheck$.mockReturnValueOnce(throwError(() => ({ message: 'controlled unavailable' })));
    component.runSelfCheck(); expect(component.errorMessage).toContain('controlled unavailable');
    expect(component.endpointAddress).toBe('example.org'); component.runSelfCheck();
    expect(component.result?.bip324_handshake).toBeNull(); component.clearResult(); expect(component.result).toBeNull();
  });
  it('accepts a scoped timeout without claiming connection refusal', () => {
    const { component, api } = setup(); api.performSelfCheck$.mockReturnValue(of({ ...receipt(), reachable: false, latency_ms: null, error: 'TCP connect timeout' }));
    component.runSelfCheck(); expect(component.result?.error).toBe('TCP connect timeout');
    expect(component.resultLabel).toBe('Endpoint not reachable');
  });
  it('bounds an unavailable response and supports explicit retry', () => {
    vi.useFakeTimers(); const { component, api } = setup(); const pending = new Subject();
    api.performSelfCheck$.mockReturnValueOnce(pending); component.runSelfCheck();
    vi.advanceTimersByTime(15001); expect(pending.observed).toBe(false);
    expect(component.probing).toBe(false); expect(component.errorMessage).toBeTruthy();
    component.runSelfCheck(); expect(component.result?.reachable).toBe(true);
  });
  it('cancels edited input and catches synchronous source failure', () => {
    const { component, api } = setup(); const pending = new Subject();
    api.performSelfCheck$.mockReturnValueOnce(pending); component.runSelfCheck(); component.clearResult();
    expect(pending.observed).toBe(false);
    api.performSelfCheck$.mockImplementationOnce(() => { throw new Error('controlled source unavailable'); });
    expect(() => component.runSelfCheck()).not.toThrow();
    expect(component.errorMessage).toBe('controlled source unavailable'); expect(component.probing).toBe(false);
  });
});

