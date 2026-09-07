import { Subject } from 'rxjs';
import { NavigationStart } from '@angular/router';
import { MiningDashboardComponent } from './mining-dashboard.component';

describe('MiningDashboardComponent navigation lifecycle', () => {
  it('only focuses search for the mounted dashboard', () => {
    const events = new Subject<NavigationStart>();
    const focusSearchInputDesktop = vi.fn();
    const mount = () => {
      const component = new MiningDashboardComponent(
        {} as any, {} as any, {} as any,
        { focusSearchInputDesktop } as any, { events } as any,
      );
      component.ngAfterViewInit();
      return component;
    };
    for (let i = 0; i < 3; i++) {
      const component = mount();
      (component as any).ngOnDestroy?.();
    }
    const current = mount();
    focusSearchInputDesktop.mockClear();
    events.next(new NavigationStart(1, '/blocks'));
    expect(focusSearchInputDesktop).toHaveBeenCalledTimes(1);
    events.next(new NavigationStart(2, '/graphs/mining/pools'));
    expect(focusSearchInputDesktop).toHaveBeenCalledTimes(1);
    (current as any).ngOnDestroy?.();
    events.next(new NavigationStart(3, '/'));
    expect(focusSearchInputDesktop).toHaveBeenCalledTimes(1);
  });
});
