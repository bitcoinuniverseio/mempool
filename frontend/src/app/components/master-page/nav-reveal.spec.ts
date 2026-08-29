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
 * What is pinned down here is when the bar moves and by how much: never on the
 * server, never on the wide layout where the bar does not scroll, never before
 * the view exists, never for a route that highlights nothing, and never for a
 * destination that is already inside the bar.
 *
 * The offset is written to the bar's own scrollLeft rather than delegated to
 * scrollIntoView, which adjusts every scrollable ancestor it can reach and so
 * could move the page's reading position as a side effect of tidying the bar.
 * These assert the offset, which is only possible because of that choice.
 */

type Rect = { left: number; right: number };

function navList(opts: {
  scrollWidth: number;
  clientWidth: number;
  active?: Rect;
  listRect?: Rect;
}): { el: HTMLElement; moved: () => number } {
  const active = opts.active
    ? { getBoundingClientRect: (): Rect => opts.active }
    : null;
  const el = {
    scrollWidth: opts.scrollWidth,
    clientWidth: opts.clientWidth,
    scrollLeft: 0,
    getBoundingClientRect: (): Rect => opts.listRect ?? { left: 0, right: opts.clientWidth },
    querySelector: (sel: string): unknown => (sel === '.nav-item.active' ? active : null),
  } as unknown as HTMLElement;
  return { el, moved: () => el.scrollLeft };
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
  it('brings a destination past the right edge back into the bar', () => {
    // 480 of destinations in a 320 window, and the active one ends 110 past
    // the right edge: arriving on Charts from a link.
    const { el, moved } = navList({
      scrollWidth: 480,
      clientWidth: 320,
      active: { left: 360, right: 430 },
    });

    withImmediateFrame(() => reveal(component(true, el)));

    // 110 to bring its right edge to the bar's, and 24 more so it does not sit
    // flush against the edge looking like the last destination there is.
    expect(moved()).toBe(134);
  });

  it('brings a destination past the left edge back into the bar', () => {
    const { el, moved } = navList({
      scrollWidth: 480,
      clientWidth: 320,
      active: { left: -40, right: 30 },
    });
    (el as unknown as { scrollLeft: number }).scrollLeft = 200;

    withImmediateFrame(() => reveal(component(true, el)));

    expect(moved()).toBe(200 - 40 - 24);
  });

  it('leaves a destination that is already inside the bar alone', () => {
    // The common case. Moving the bar here would be movement the visitor did
    // not ask for and cannot explain.
    const { el, moved } = navList({
      scrollWidth: 480,
      clientWidth: 320,
      active: { left: 40, right: 110 },
    });

    withImmediateFrame(() => reveal(component(true, el)));

    expect(moved()).toBe(0);
  });

  it('leaves the wide layout alone', () => {
    // At and above the breakpoint the bar is a static row that fits.
    const { el, moved } = navList({
      scrollWidth: 700,
      clientWidth: 700,
      active: { left: 0, right: 70 },
    });

    withImmediateFrame(() => reveal(component(true, el)));

    expect(moved()).toBe(0);
  });

  it('does nothing on the server', () => {
    const { el, moved } = navList({
      scrollWidth: 480,
      clientWidth: 320,
      active: { left: 360, right: 430 },
    });

    withImmediateFrame(() => reveal(component(false, el)));

    expect(moved()).toBe(0);
  });

  it('does nothing before the bar exists', () => {
    // The router fires a navigation before the view is ready on first paint,
    // and the shell is rendered without a bar on the routes that hide it.
    expect(() => withImmediateFrame(() => reveal(component(true, null)))).not.toThrow();
  });

  it('does nothing when no destination is current', () => {
    // An unrecognised route highlights nothing. Scrolling the bar to its start
    // in that case would be a claim about where the visitor is.
    const { el, moved } = navList({ scrollWidth: 480, clientWidth: 320 });

    withImmediateFrame(() => reveal(component(true, el)));

    expect(moved()).toBe(0);
  });
});
