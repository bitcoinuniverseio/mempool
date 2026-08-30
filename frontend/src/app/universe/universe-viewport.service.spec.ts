import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UniverseViewportService } from '@app/universe/universe-viewport.service';

/**
 * The service exists for one browser behaviour that cannot be reached from CSS,
 * so what is worth testing is the shape of its contract rather than the
 * arithmetic: that it publishes nothing at all where the browser cannot report
 * a visual viewport, because every stylesheet that reads its properties falls
 * back to a `dvh` value and that fallback only works if the property is absent
 * rather than wrong.
 */

type Listener = () => void;

function fakeVisualViewport(height: number, offsetTop = 0): {
  visual: Record<string, unknown>;
  fire: () => void;
  listeners: Map<string, Listener[]>;
} {
  const listeners = new Map<string, Listener[]>();
  const visual = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: Listener): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener: (type: string, fn: Listener): void => {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn));
    },
  };
  const fire = (): void => {
    for (const fn of listeners.get('resize') ?? []) {
      fn();
    }
  };
  return { visual, fire, listeners };
}

function documentWith(view: unknown): { doc: Document; props: Map<string, string> } {
  const props = new Map<string, string>();
  const doc = {
    defaultView: view,
    documentElement: {
      style: {
        setProperty: (name: string, value: string): void => void props.set(name, value),
      },
    },
  } as unknown as Document;
  return { doc, props };
}

/** NgZone's only use here is running listeners outside change detection. */
const zone = { runOutsideAngular: (fn: () => void): unknown => fn() } as never;

// Angular identifies the platform by comparing the injected token against the
// literal 'browser', so the token has to be that literal and not a stand-in
// object. Getting this wrong is silent: the service simply publishes nothing,
// which is also what it correctly does on the server.
const BROWSER = 'browser' as unknown as object;
const SERVER = 'server' as unknown as object;

function service(view: unknown, platformId: object = BROWSER): {
  svc: UniverseViewportService;
  props: Map<string, string>;
} {
  const { doc, props } = documentWith(view);
  return { svc: new UniverseViewportService(zone, doc, platformId), props };
}

describe('UniverseViewportService', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes the visible height and the keyboard inset', () => {
    const { visual } = fakeVisualViewport(400);
    const { svc, props } = service({ innerHeight: 800, visualViewport: visual });

    svc.track();

    expect(props.get('--u-visual-viewport-height')).toBe('400px');
    // 800 of window, 400 of it visible, nothing scrolled: the keyboard is
    // covering the other 400.
    expect(props.get('--u-keyboard-inset')).toBe('400px');
  });

  it('counts the offset, so a page scrolled inside the visual viewport is not read as a keyboard', () => {
    const { visual } = fakeVisualViewport(600, 200);
    const { svc, props } = service({ innerHeight: 800, visualViewport: visual });

    svc.track();

    // 800 - 600 - 200 is zero: the window is fully visible, just scrolled.
    // Without the offset this would report a 200px keyboard that is not there.
    expect(props.get('--u-keyboard-inset')).toBe('0px');
  });

  it('publishes nothing where the browser cannot report a visual viewport', () => {
    const { svc, props } = service({ innerHeight: 800 });

    svc.track();

    // Absent, not zero, and not the window height. Every rule that reads these
    // does so through a var() fallback to a CSS unit, and a fallback only
    // applies when the property was never set.
    expect(props.size).toBe(0);
  });

  it('does nothing on the server, even where a viewport appears to exist', () => {
    const { visual, listeners } = fakeVisualViewport(400);
    const { svc, props } = service({ innerHeight: 800, visualViewport: visual }, SERVER);

    svc.track();

    expect(props.size).toBe(0);
    expect((listeners.get('resize') ?? []).length).toBe(0);
  });

  it('writes only when a value changed', () => {
    const { visual, fire } = fakeVisualViewport(400);
    const writes: string[] = [];
    const doc = {
      defaultView: { innerHeight: 800, visualViewport: visual },
      documentElement: { style: { setProperty: (n: string): void => void writes.push(n) } },
    } as unknown as Document;
    const svc = new UniverseViewportService(zone, doc, BROWSER);

    svc.track();
    const afterFirst = writes.length;
    fire();
    fire();

    // A keyboard animation fires this every frame. Repeating a write that
    // changes nothing would invalidate style on a low-end phone sixty times a
    // second for no reason.
    expect(writes.length).toBe(afterFirst);
  });

  it('reacts when the visible height actually changes', () => {
    const { visual, fire } = fakeVisualViewport(800);
    const { svc, props } = service({ innerHeight: 800, visualViewport: visual });

    svc.track();
    expect(props.get('--u-keyboard-inset')).toBe('0px');

    (visual as { height: number }).height = 420;
    fire();

    expect(props.get('--u-visual-viewport-height')).toBe('420px');
    expect(props.get('--u-keyboard-inset')).toBe('380px');
  });

  it('detaches its listeners when destroyed', () => {
    const { visual, listeners } = fakeVisualViewport(400);
    const { svc } = service({ innerHeight: 800, visualViewport: visual });

    svc.track();
    expect((listeners.get('resize') ?? []).length).toBe(1);

    svc.ngOnDestroy();

    expect((listeners.get('resize') ?? []).length).toBe(0);
    expect((listeners.get('scroll') ?? []).length).toBe(0);
  });

  it('is safe to track twice', () => {
    const { visual, listeners } = fakeVisualViewport(400);
    const { svc } = service({ innerHeight: 800, visualViewport: visual });

    svc.track();
    svc.track();

    // The shell calls this from ngOnInit, and the shell is re-created on some
    // route changes. Two sets of listeners on one viewport is a leak.
    expect((listeners.get('resize') ?? []).length).toBe(1);
  });
});
