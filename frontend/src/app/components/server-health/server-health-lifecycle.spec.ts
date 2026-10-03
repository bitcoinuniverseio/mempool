// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { ServerHealthComponent } from './server-health.component';
import { ServerStatusComponent } from './server-status.component';

function setup() {
  const hosts = new BehaviorSubject<any[]>([]), cd = {markForCheck: vi.fn()};
  const state = {serverHealth$: hosts, chainTip$: new BehaviorSubject(0)};
  const socket = {want: vi.fn()};
  const sanitizer = {sanitize: (_context: any, url: string) => url, bypassSecurityTrustResourceUrl: (url: string) => url};
  return {hosts, cd, health: new ServerHealthComponent(socket as any, state as any, cd as any, sanitizer as any),
    status: new ServerStatusComponent(socket as any, state as any, cd as any, sanitizer as any)};
}
const host = (height: number) => ({host: 'https://owned.example', latestHeight: height, hashes: {core: '/Satoshi:30.3.0/'}});
afterEach(() => vi.useRealTimers());
describe('Native monitoring lifecycle and current host projection', () => {
  it('stops its clock after the monitoring route is destroyed', () => {
    vi.useFakeTimers(); const s = setup(); s.health.ngOnInit(); s.health.ngOnDestroy();
    vi.advanceTimersByTime(3000); expect(s.cd.markForCheck).not.toHaveBeenCalled();
  });
  it('publishes the actual highest observed host height', () => {
    vi.useFakeTimers(); const s = setup(); s.health.ngOnInit(); const sub = s.health.hosts$.subscribe();
    s.hosts.next([host(41), {...host(42), host: 'https://other.example'}]); expect(s.health.maxHeight).toBe(42);
    sub.unsubscribe(); s.health.ngOnDestroy();
  });
  it('updates host values when the roster cardinality remains unchanged without mutating shared input', () => {
    const s = setup(); s.status.ngOnInit(); const first = host(41); s.hosts.next([first]);
    const next = host(42); s.hosts.next([next]); expect(s.status.hosts[0].latestHeight).toBe(42);
    expect(next).not.toHaveProperty('link'); s.status.ngOnDestroy(); expect(s.hosts.observed).toBe(false);
  });
});
