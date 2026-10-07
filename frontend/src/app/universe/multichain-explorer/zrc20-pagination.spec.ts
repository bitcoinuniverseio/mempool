import { describe, expect, it, vi } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { MultichainExplorerComponent } from './multichain-explorer.component';

describe('ZRC20 catalogue route paging', () => {
  it('uses page two offset and retains the selected ruleset on the next link', () => {
    const request = vi.fn(() => of({}));
    const component = new MultichainExplorerComponent(
      { snapshot: { queryParamMap: convertToParamMap({ ruleset: 'zord' }) } } as never,
      { url: '/zcash/protocols/zrc20' } as never,
      { getChainProtocolList$: request } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    component['pageRequest$']({ page: 'protocol-list', params: convertToParamMap({ protocol: 'zrc20' }), ruleset: 'zord', listPage: 2 }).subscribe();
    expect(request).toHaveBeenCalledWith('zcash', 'zrc20', 100, 100, 'zord');
    expect(component.pageLink(3)).toEqual({ page: '3', ruleset: 'zord' });
  });
});
