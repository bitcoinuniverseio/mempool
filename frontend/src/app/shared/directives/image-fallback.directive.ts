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
  /** Where to go when the source fails. */
  @Input() appImageFallback = '/resources/mining-pools/default.svg';

  private failed = false;

  constructor(private element: ElementRef<HTMLImageElement>) {}

  @HostListener('error')
  onError(): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    const image = this.element.nativeElement;
    if (image.getAttribute('src') !== this.appImageFallback) {
      image.setAttribute('src', this.appImageFallback);
    }
  }

  /** A new source is a new chance to load, so the guard resets with it. */
  @HostListener('load')
  onLoad(): void {
    if (this.element.nativeElement.getAttribute('src') !== this.appImageFallback) {
      this.failed = false;
    }
  }
}
