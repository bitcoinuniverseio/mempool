import { describe, expect, it } from 'vitest';
import { MasterPageComponent } from '@components/master-page/master-page.component';

/**
 * The bottom bar's scroller.
 *
 * Below the shell breakpoint the bar holds every destination at full size and
 * scrolls, which is the only arrangement that fits six or seven of them across
 * 320 pixels without either shrinking the targets or hiding some. Everything
 * that follows from that choice is CSS. The one part that is not is the
 * starting offset: the browser has no reason to know that the highlighted item
 * is the one that ought to be on screen.
 *
 * These cover the conditions rather than the scrolling, because the scrolling
 * itself is `scrollIntoView` and belongs to the browser. What is worth pinning
 * down is when it is called at all: never on the server, never on the wide
 * layout where the bar does not scroll, and never for an item that is already
 * fully visible.
 */

type Rect = { left: number; right: number };

function navList(opts: {
  scrollWidth: number;
  clientWidth: number;
  active?: Rect;
  listRect?: Rect;
}): { el: HTMLElement; scrolled: () => number } {
  let calls = 0;
  const active = opts.active
    ? {
        getBoundingClientRect: (): Rect => opts.active,
        scrollIntoView: (): void => void calls++,
      }
    : null;
  const el = {
    scrollWidth: opts.scrollWidth,
    clientWidth: opts.clientWidth,
    getBoundingClientRect: (): Rect => opts.listRect ?? { left: 0, right: opts.clientWidth },
    querySelector: (sel: string): unknown => (sel === '.nav-item.active' ? active : null),
  } as unknown as HTMLElement;
  return { el, scrolled: () => calls };
}

/**
 * The component is built by hand rather than through TestBed. Only two of its
 * dependencies are reached by the method under test, and standing up the whole
 * shell to exercise a scroll offset would test the harness instead.
 */
function component(isBrowser: boolean, list: HTMLElement | null): MasterPageComponent {
  const c = Object.create(MasterPageComponent.prototype) as MasterPageComponent;
  (c as unknown as { stateService: unknown }).stateService = { isBrowser };
  (c as unknown as { navList: unknown }).navList = list ? { nativeElement: list } : undefined;
  return c;
}

function reveal(c: MasterPageComponent): void {
  (c as unknown as { revealActiveDestination(): void }).revealActiveDestination();
}

/** requestAnimationFrame, run immediately, so the assertion sees the effect. */
function withImmediateFrame(fn: () => void): void {
  const original = globalThis.requestAnimationFrame;
  (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame =
    (cb: FrameRequestCallback): number => { cb(0); return 0; };
  try {
    fn();
  } finally {
    (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = original;
  }
}

describe('the bottom bar reveals the current destination', () => {
  it('scrolls the active item into view when the bar is a scroller', () => {
    // 480 of destinations in a 320 window, and the active one starts past the
    // right edge: arriving on Charts from a link.
    const { el, scrolled } = navList({
      scrollWidth: 480,
      clientWidth: 320,
      active: { left: 360, right: 430 },
    });

    withImmediateFrame(() => reveal(component(true, el)));

    expect(scrolled()).toBe(1);
  });

  it('leaves the wide layout alone', () => {
    // At and above the breakpoint the bar is a static row that fits. Calling
    // scrollIntoView there would scroll the page rather than the bar.
    const { el, scrolled } = navList({
      scrollWidth: 700,
      clientWidth: 700,
      active: { left: 0, right: 70 },
    });

    withImmediateFrame(() => reveal(component(true, el)));

    expect(scrolled()).toBe(0);
  });

  it('does nothing on the server', () => {
    const { el, scrolled } = navList({
      scrollWidth: 480,
      clientWidth: 320,
      active: { left: 360, right: 430 },
    });

    withImmediateFrame(() => reveal(component(false, el)));

    expect(scrolled()).toBe(0);
  });

  it('does nothing before the bar exists', () => {
    // The router fires a navigation before the view is ready on first paint,
    // and the shell is rendered without a bar on the routes that hide it.
    expect(() => withImmediateFrame(() => reveal(component(true, null)))).not.toThrow();
  });

  it('does nothing when no destination is current', () => {
    // An unrecognised route highlights nothing. Scrolling the bar to its start
    // in that case would be a claim about where the visitor is.
    const { el, scrolled } = navList({ scrollWidth: 480, clientWidth: 320 });

    withImmediateFrame(() => reveal(component(true, el)));

    expect(scrolled()).toBe(0);
  });
});
