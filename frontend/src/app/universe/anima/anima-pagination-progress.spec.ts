import { describe, expect, it, vi } from 'vitest';
import { Subject, firstValueFrom, of } from 'rxjs';
import { AnimaItemsComponent } from './anima-items.component';
import { AnimaTransitionsComponent } from './anima-transitions.component';

for (const [Component, method, key, idKey] of [
  [AnimaItemsComponent, 'getAnimaOrganisms$', 'organisms', 'id'],
  [AnimaTransitionsComponent, 'getAnimaEvents$', 'events', 'eventId'],
] as const) {
  describe(`${Component.name} continuation progress`, () => {
    for (const rows of [[], [{ [idKey]: 'first' }]]) {
      it(`retains accepted rows and reports ${rows.length ? 'repeated' : 'empty'} nonterminal page as malformed`, async () => {
        const page = new Subject<any>();
        const read = vi.fn().mockReturnValueOnce(of({ total: 3, [key]: [{ [idKey]: 'first' }] })).mockReturnValue(page);
        const component = new Component({ getAnimaStatus$: () => of({ state: 'served' }), [method]: read } as any,
          { setTitle: () => undefined } as any, { onDestroy: () => () => undefined } as any,
          { network: '', networkChanged$: new Subject<string>() } as any);
        component.ngOnInit();
        component.more();
        page.next({ total: 3, [key]: rows });
        const vm: any = await firstValueFrom(component.vm$);
        expect(vm[key === 'events' ? 'events' : 'organisms'] instanceof Array
          ? vm.organisms : vm.events.events).toEqual([{ [idKey]: 'first' }]);
        expect(vm.pageFailure).toEqual({ kind: 'malformed' });
        expect(vm.loadingMore).toBe(false);
        component.more();
        expect(read.mock.calls.at(-1)?.[0]).toBe(1);
      });
    }
    for (const total of [0, 1, 4]) it(`rejects changed total ${total} before appending or claiming completion`, async () => {
      const page = new Subject<any>();
      const read = vi.fn().mockReturnValueOnce(of({ total: 3, [key]: [{ [idKey]: 'first' }] })).mockReturnValue(page);
      const component = new Component({ getAnimaStatus$: () => of({ state: 'served' }), [method]: read } as any,
        { setTitle: () => undefined } as any, { onDestroy: () => () => undefined } as any,
        { network: '', networkChanged$: new Subject<string>() } as any);
      component.ngOnInit(); component.more();
      page.next({ total, [key]: total === 1 ? [] : [{ [idKey]: 'second' }] });
      const vm: any = await firstValueFrom(component.vm$);
      expect(vm.pageFailure).toEqual({ kind: 'malformed' });
      expect(vm.total).toBe(3);
      expect(vm.canLoadMore).toBe(true);
    });
  });
}
