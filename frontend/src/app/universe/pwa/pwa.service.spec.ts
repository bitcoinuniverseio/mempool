import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaService } from './pwa.service';

afterEach(() => vi.unstubAllGlobals());

async function browser(hasController = true, hasWaiting = true) {
  const controller = { postMessage: vi.fn() };
  const waiting = { postMessage: vi.fn() };
  const registration = Object.assign(new EventTarget(), {
    waiting: hasWaiting ? waiting : null,
    installing: null as (EventTarget & { state: string }) | null,
  });
  const workers = Object.assign(new EventTarget(), {
    controller: hasController ? controller : null,
    register: vi.fn(async () => registration),
  });
  const reload = vi.fn();
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: workers });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { reload } }));
  const service = new PwaService('browser');
  let updateReady = false;
  service.updateReady$.subscribe((ready) => { updateReady = ready; });
  await Promise.resolve();
  return { service, controller, waiting, registration, workers, reload, ready: () => updateReady };
}

describe('applying a service worker update', () => {
  it('activates the waiting worker, clears the banner and reloads once when it takes control', async () => {
    const b = await browser();
    expect(b.ready()).toBe(true);
    b.service.applyUpdate();
    expect(b.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(b.controller.postMessage).not.toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(b.ready()).toBe(false);
    expect(b.reload).not.toHaveBeenCalled();
    b.workers.controller = b.waiting;
    b.registration.waiting = null;
    b.workers.dispatchEvent(new Event('controllerchange'));
    b.workers.dispatchEvent(new Event('controllerchange'));
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on first install, but reloads for a later update', async () => {
    const b = await browser(false, false);
    b.workers.controller = b.controller;
    b.workers.dispatchEvent(new Event('controllerchange'));
    expect(b.ready()).toBe(false);
    expect(b.reload).not.toHaveBeenCalled();
    b.registration.installing = Object.assign(new EventTarget(), { state: 'installing' });
    b.registration.dispatchEvent(new Event('updatefound'));
    b.registration.waiting = b.waiting;
    b.registration.installing.state = 'installed';
    b.registration.installing.dispatchEvent(new Event('statechange'));
    expect(b.ready()).toBe(true);
    b.service.applyUpdate();
    b.workers.controller = b.waiting;
    b.registration.waiting = null;
    b.workers.dispatchEvent(new Event('controllerchange'));
    expect(b.ready()).toBe(false);
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it('clears an update offer when another tab activates the worker', async () => {
    const b = await browser();
    b.registration.waiting = null;
    b.workers.controller = b.waiting;
    b.workers.dispatchEvent(new Event('controllerchange'));
    expect(b.ready()).toBe(false);
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads a stale offer if the waiting worker has already gone', async () => {
    const b = await browser();
    b.registration.waiting = null;
    b.service.applyUpdate();
    b.service.applyUpdate();
    expect(b.ready()).toBe(false);
    expect(b.waiting.postMessage).not.toHaveBeenCalled();
    expect(b.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing during server rendering', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('window', undefined);
    expect(() => new PwaService('server').applyUpdate()).not.toThrow();
  });
});
