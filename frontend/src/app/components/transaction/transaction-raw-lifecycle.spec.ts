// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { TransactionRawComponent } from './transaction-raw.component';

function component() {
  const c = Object.create(TransactionRawComponent.prototype);
  c.stateService = { isBrowser: true, markBlock$: { next: vi.fn() } };
  c.router = { navigate: vi.fn() };
  c.relativeUrlPipe = { transform: (x: string) => x };
  c.transaction = { txid: 'original' };
  c.rawHexTransaction = 'test-owned-unbroadcast-bytes';
  return c;
}
afterEach(() => vi.useRealTimers());
describe('raw transaction async lifecycle', () => {
  it('bounds absent-container retries, cancels on destroy, and schedules nothing during SSR', () => {
    vi.useFakeTimers(); const c = component();
    c.setGraphSize(); vi.runAllTimers(); expect(vi.getTimerCount()).toBe(0);
    c.setGraphSize(); expect(vi.getTimerCount()).toBe(1);
    c.ngOnDestroy(); expect(vi.getTimerCount()).toBe(0);
    c.setGraphSize(); expect(vi.getTimerCount()).toBe(0);
    const ssr = component(); ssr.stateService.isBrowser = false; ssr.setGraphSize();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('measures a late container and coalesces repeated resize requests', () => {
    vi.useFakeTimers(); const c = component(); c.setGraphSize(); c.setGraphSize();
    expect(vi.getTimerCount()).toBe(1); vi.advanceTimersByTime(16);
    c.graphContainer = { nativeElement: { clientWidth: 777 } }; vi.runAllTimers();
    expect(c.graphWidth).toBe(777); expect(vi.getTimerCount()).toBe(0);
  });
  it('handles broadcast failure once, retains transaction for retry and cancels pending retry on destroy', () => {
    const c = component(); const first = new Subject<string>(), retry = new Subject<string>();
    c.apiService = { postTransaction$: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(retry) };
    c.postTx(); c.postTx(); expect(c.apiService.postTransaction$).toHaveBeenCalledOnce();
    first.error({ error: 'controlled transport unavailable' });
    expect(c.errorBroadcast).toContain('controlled transport unavailable'); expect(c.isLoadingBroadcast).toBe(false);
    expect(c.transaction.txid).toBe('original'); expect(c.router.navigate).not.toHaveBeenCalled();
    c.postTx(); c.ngOnDestroy(); expect(retry.observed).toBe(false);
    c.postTx(); expect(c.apiService.postTransaction$).toHaveBeenCalledTimes(2);
  });
});
