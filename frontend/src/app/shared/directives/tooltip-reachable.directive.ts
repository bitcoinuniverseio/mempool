import { AfterViewInit, Directive, ElementRef } from '@angular/core';

/**
 * Make a tooltip reachable without a mouse.
 *
 * `ngbTooltip` opens on hover and on focus. On the eighty-odd places in this
 * product where it hangs off a `<span>`, a `<div>`, a heading or an image,
 * there is no focus to open it with: those elements are not focusable, so the
 * tooltip could only ever be seen by a pointer that can hover. A phone has no
 * hover and a keyboard has no pointer, which meant the explanation of what
 * "Low Priority" means, what a block's health measures, and what a pool's
 * coinbase message says were all visible to exactly one kind of visitor.
 *
 * Giving the host a tab stop is what fixes it in both directions at once: a
 * keyboard tabs to it and the tooltip opens on focus, and a tap on a phone
 * focuses the element and opens it the same way. It is also what WCAG 2.2
 * 1.4.13 asks for, since the whole point of that criterion is that content
 * revealed by pointing has to be revealed some other way too.
 *
 * Written as one directive rather than eighty `tabindex="0"` attributes for the
 * ordinary reason: the next tooltip should be reachable without anyone having
 * to remember this, and eighty attributes is eighty chances to forget.
 *
 * Elements that are already focusable are left alone, including a link that
 * has an `href` and anything that has been given an explicit `tabindex`. An
 * anchor without an `href` is not focusable, so it is treated as a span.
 */
@Directive({
  selector: '[ngbTooltip]',
  standalone: false,
})
export class TooltipReachableDirective implements AfterViewInit {
  constructor(private element: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    const host = this.element.nativeElement;
    if (!host || host.hasAttribute('tabindex')) {
      return;
    }
    if (host.tagName === 'A' && host.hasAttribute('href')) {
      return;
    }
    if (/^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(host.tagName)) {
      return;
    }
    if (host.isContentEditable) {
      return;
    }
    host.setAttribute('tabindex', '0');
  }
}
