import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartComponent } from './start.component';

afterEach(() => vi.unstubAllGlobals());

describe('native timeline momentum teardown', () => {
  it('cancels its scheduled frame and cannot scroll or reschedule after destroy', () => {
    let frame: FrameRequestCallback;
    const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 42; });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel);
    const component = Object.create(StartComponent.prototype);
    Object.assign(component, {
      velocity: 1, scrollLeft: 100, stateService: { setBlockScrollingInProgress: vi.fn() },
      applyScrollLeft: vi.fn(), setScrollLeft: vi.fn(),
      timeLtrSubscription: { unsubscribe: vi.fn() }, chainTipSubscription: { unsubscribe: vi.fn() },
      markBlockSubscription: { unsubscribe: vi.fn() }, blockCounterSubscription: { unsubscribe: vi.fn() },
      resetScrollSubscription: { unsubscribe: vi.fn() },
    });
    component.animateMomentum(); expect(request).toHaveBeenCalledOnce();
    component.ngOnDestroy(); expect(cancel).toHaveBeenCalledWith(42);
    expect(component.stateService.setBlockScrollingInProgress).toHaveBeenLastCalledWith(false);
    frame(1000); component.animateMomentum();
    expect(request).toHaveBeenCalledOnce(); expect(component.applyScrollLeft).not.toHaveBeenCalled();
  });

  it('replaces a queued momentum frame when a fresh drag starts', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 23));
    const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel);
    const component = Object.create(StartComponent.prototype);
    Object.assign(component, { velocity: 1, stateService: { setBlockScrollingInProgress: vi.fn() } });
    component.animateMomentum(); component.resetMomentum(10);
    expect(cancel).toHaveBeenCalledWith(23); expect(component.velocity).toBe(0);
  });
});
