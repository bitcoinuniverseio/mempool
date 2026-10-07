// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';
import { ApiDocsComponent } from '@app/docs/api-docs/api-docs.component';
vi.mock('@app/docs/api-docs/api-docs-data', () => ({faqData: [], restApiDocsData: [], wsApiDocsData: [], electrumApiDocsData: []}));

function setup() {
  const network = new BehaviorSubject('signet');
  const c = new ApiDocsComponent({
    network: 'signet', networkChanged$: network, backend$: of('esplora'),
    env: {BASE_MODULE: 'mempool', ROOT_NETWORK: ''}, timeLtr: new BehaviorSubject(false),
  } as any, {snapshot: {fragment: null}} as any);
  c.ngOnInit();
  return {c, network};
}
afterEach(() => vi.useRealTimers());
describe('API documentation context and teardown', () => {
  it('resets selected-network URL context when returning to the root network', () => {
    const {c, network} = setup();
    expect(c.baseNetworkUrl).toBe('/signet');
    network.next('');
    expect(c.baseNetworkUrl).toBe('');
    network.next('testnet4');
    expect(c.baseNetworkUrl).toBe('/testnet4');
    c.ngOnDestroy();
  });
  it('does not install a delayed scroll listener after destruction', () => {
    vi.useFakeTimers();
    const add = vi.spyOn(window, 'addEventListener');
    const {c} = setup();
    c.ngAfterViewInit();
    c.ngOnDestroy();
    vi.runAllTimers();
    expect(add.mock.calls.filter(([name]) => name === 'scroll')).toEqual([]);
    add.mockRestore();
  });
});

