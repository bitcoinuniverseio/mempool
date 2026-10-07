import { describe, expect, it, vi } from 'vitest';
import { Observable, Subject } from 'rxjs';
import { ProtocolExplorerComponent } from './protocol-explorer.component';

function component(streams: Observable<unknown>[]) {
  const api = { decodeProtocolPayload$: vi.fn() };
  streams.forEach(stream => api.decodeProtocolPayload$.mockReturnValueOnce(stream));
  return { c: new ProtocolExplorerComponent(api as never, { markForCheck: vi.fn() } as never), api };
}
describe('protocol decoder request ownership', () => {
  it('clear cancels the old request and a new request alone can populate results', () => {
    const old = new Subject(), current = new Subject(); const { c, api } = component([old, current]);
    c.decodeInput = '6a'; c.decodePayload(); expect(old.observed).toBe(true);
    c.resetDecode(); expect(old.observed).toBe(false); expect(c.decoding).toBe(false);
    c.decodeInput = '6a5d'; c.decodePayload();
    old.next({ decoded: [{ protocol_name: 'stale' }] });
    expect(c.decodedResults).toEqual([]);
    current.next({ decoded: [{ protocol_name: 'current' }] });
    expect(c.decodedResults[0].protocol_name).toBe('current');
    expect(api.decodeProtocolPayload$).toHaveBeenNthCalledWith(2, '6a5d');
    c.ngOnDestroy();
  });
  it('sample and direct duplicate invocation do not overwrite active request input or create concurrency', () => {
    const active = new Subject(); const { c, api } = component([active]);
    c.decodeInput = 'abcd'; c.decodePayload(); c.loadSamplePayload(); c.decodePayload();
    expect(c.decodeInput).toBe('abcd'); expect(api.decodeProtocolPayload$).toHaveBeenCalledOnce();
    c.ngOnDestroy(); expect(active.observed).toBe(false);
    c.loadSamplePayload(); c.decodePayload(); expect(api.decodeProtocolPayload$).toHaveBeenCalledOnce();
  });
  it('a failed request allows retry while clear removes its failure', () => {
    const failed = new Subject(), retry = new Subject(); const { c, api } = component([failed, retry]);
    c.decodeInput = '6a'; c.decodePayload(); failed.error({ message: 'controlled failure' });
    expect(c.decodeError).toBe('controlled failure'); expect(c.decoding).toBe(false);
    c.decodePayload(); expect(api.decodeProtocolPayload$).toHaveBeenCalledTimes(2);
    expect(c.decodeError).toBeNull(); c.resetDecode(); expect(retry.observed).toBe(false);
  });
});
