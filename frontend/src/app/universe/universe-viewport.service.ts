import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';

/**
 * The part of the window a visitor can actually see, published as CSS.
 *
 * Almost every adaptive decision in this product is made in CSS, and should be:
 * media and container queries survive rotation, folding and split-screen
 * resizing without anything having to listen for them. There is one state CSS
 * still cannot describe, and this service exists for that one state and nothing
 * else.
 *
 * When the software keyboard opens, the window does not get shorter. On iOS the
 * keyboard is painted over the page: `100dvh`, `100vh` and `window.innerHeight`
 * all keep reporting the full height, while roughly the bottom half of it is
 * behind the keyboard. So a menu or a result list capped at `100dvh` is capped
 * at a height that no longer exists, and its lower half sits under the keys
 * with nothing to say it is there. The only thing that reports the truth is
 * `visualViewport`.
 *
 * Two custom properties are published on the document element:
 *
 *   --u-visual-viewport-height   what is visible right now, keyboard excluded
 *   --u-keyboard-inset           how much of the window the keyboard covers
 *
 * Both are plain lengths, so a stylesheet uses them with `min()` beside a `dvh`
 * value and gets the smaller of the two. That ordering matters: the fallback
 * has to be the CSS one. On an engine with no `visualViewport` these properties
 * are simply never written, every `min()` that mentions them falls back to the
 * declared `dvh` cap, and the layout is the one it would have been anyway.
 *
 * Cost is deliberately near zero. It listens only while a browser is running
 * it, it writes only when a value actually changes, and every listener is
 * outside Angular so a keyboard animation cannot drive a change-detection pass
 * per frame on a low-end phone.
 */
@Injectable({ providedIn: 'root' })
export class UniverseViewportService implements OnDestroy {
  private stop: (() => void) | null = null;
  private lastHeight = -1;
  private lastInset = -1;

  constructor(
    private zone: NgZone,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {}

  /**
   * Called once by the application shell. Safe to call more than once, and
   * safe on the server, where there is no window to measure.
   */
  track(): void {
    if (this.stop || !isPlatformBrowser(this.platformId)) {
      return;
    }
    const view = this.document.defaultView;
    const visual = view?.visualViewport;
    if (!view || !visual) {
      // No visualViewport: the stylesheet's own dvh cap stands, unmodified.
      return;
    }

    const publish = (): void => {
      // The offset matters as much as the height. A page scrolled down inside
      // the visual viewport reports a height that is correct and a position
      // that is not, and the inset is the gap between the bottom of what can
      // be seen and the bottom of the window.
      const height = Math.round(visual.height);
      const inset = Math.max(0, Math.round(view.innerHeight - visual.height - visual.offsetTop));
      if (height === this.lastHeight && inset === this.lastInset) {
        return;
      }
      this.lastHeight = height;
      this.lastInset = inset;
      const root = this.document.documentElement;
      root.style.setProperty('--u-visual-viewport-height', `${height}px`);
      root.style.setProperty('--u-keyboard-inset', `${inset}px`);
    };

    this.zone.runOutsideAngular(() => {
      visual.addEventListener('resize', publish);
      visual.addEventListener('scroll', publish);
      publish();
      this.stop = (): void => {
        visual.removeEventListener('resize', publish);
        visual.removeEventListener('scroll', publish);
      };
    });
  }

  ngOnDestroy(): void {
    this.stop?.();
    this.stop = null;
  }
}
