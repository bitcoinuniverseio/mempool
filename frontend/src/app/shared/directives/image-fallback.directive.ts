import { Directive, ElementRef, HostListener, Input } from '@angular/core';

/**
 * Swap in a fallback when an image fails to load.
 *
 * Every mining pool logo used an inline `onError` attribute for this. The
 * production Content Security Policy allows no inline script, so the handler
 * never ran: a pool whose logo is missing rendered as the browser's broken
 * image glyph, on every list that names a pool. This does the same job through
 * an ordinary event binding, which the policy allows.
 *
 * The swap happens once. A fallback that is itself missing must not start a
 * loop, and an image that has already fallen back must not be reset when the
 * element is reused for another pool.
 */
@Directive({
  selector: 'img[appImageFallback]',
  standalone: false,
})
export class ImageFallbackDirective {
  /**
   * Where to go when the source fails.
   *
   * Every use of this directive in the product writes it as a bare attribute,
   * `<img appImageFallback ...>`, which is how a directive is normally turned
   * on. Angular reads a bare attribute whose name matches an input as that
   * input set to the empty string, so the default below was never used and
   * every failed logo had its source replaced with nothing at all. A browser
   * draws an image with no source as its alt text, at whatever width the
   * sentence needs: 199 pixels on the block page, which pushed the details
   * table 120 pixels past the right edge of a 320px screen and had it clipped
   * away by the page shell.
   *
   * So an empty value means "the default", not "nothing".
   */
  @Input() appImageFallback = '';

  /** The default, named once. */
  private static readonly DEFAULT = '/resources/mining-pools/default.svg';

  private get fallback(): string {
    return this.appImageFallback || ImageFallbackDirective.DEFAULT;
  }

  private failed = false;

  constructor(private element: ElementRef<HTMLImageElement>) {}

  @HostListener('error')
  onError(): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    const image = this.element.nativeElement;
    if (image.getAttribute('src') !== this.fallback) {
      image.setAttribute('src', this.fallback);
    }
  }

  /** A new source is a new chance to load, so the guard resets with it. */
  @HostListener('load')
  onLoad(): void {
    if (this.element.nativeElement.getAttribute('src') !== this.fallback) {
      this.failed = false;
    }
  }
}
