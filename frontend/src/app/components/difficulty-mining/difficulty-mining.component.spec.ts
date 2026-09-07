import { BehaviorSubject, Subject } from 'rxjs';
import { DifficultyMiningComponent } from './difficulty-mining.component';

describe('difficulty mining source lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('bounds a silent socket, retries its source, and disposes pending work', async () => {
    vi.useFakeTimers();
    const blocks$ = new Subject<any[]>();
    const difficultyAdjustment$ = new Subject<any>();
    const connectionState$ = new BehaviorSubject(2);
    const reconnectWebsocket = vi.fn();
    const component = new DifficultyMiningComponent(
      { blocks$, difficultyAdjustment$, connectionState$ } as any,
      { reconnectWebsocket } as any,
    );
    component.ngOnInit();
    const states: any[] = [];
    const subscription = component.epochState$.subscribe(state => states.push(state));
    expect(states.at(-1).status).toBe('loading');
    await vi.advanceTimersByTimeAsync(20_001);
    expect(states.at(-1)).toMatchObject({ status: 'error', reason: 'timeout' });
    component.onRetry();
    expect(reconnectWebsocket).toHaveBeenCalledOnce();
    expect(states.at(-1).status).toBe('loading');
    blocks$.next([{ height: 900000 }]);
    difficultyAdjustment$.next({ progressPercent: 50, difficultyChange: 1, remainingBlocks: 1008 });
    expect(states.at(-1).status).toBe('data');
    subscription.unsubscribe();
    expect(blocks$.observed).toBe(false);
    expect(difficultyAdjustment$.observed).toBe(false);
    expect(connectionState$.observed).toBe(false);
  });
});
