/**
 * Reserved share route.
 *
 * This release has no share creation, storage, lookup, or revocation service.
 * The route stays explicit so an old or guessed link cannot imply that a
 * missing server response means a share once existed.
 */

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-share-view',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="share">
      <h1 i18n="@@universe.portfolio.share.unavailable-title">
        Portfolio sharing is not available
      </h1>
      <p role="note" i18n="@@universe.portfolio.share.unavailable-copy">
        This release cannot create, open, or revoke portfolio shares. No share
        request was sent.
      </p>
      <a routerLink="/portfolio" i18n="@@universe.portfolio.share.back">
        Back to Portfolio Intelligence
      </a>
    </div>
  `,
  styles: [
    `
      .share {
        max-width: 560px;
        margin: 0 auto;
        padding: 48px 8px 16px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 22px;
      }
      p {
        color: var(--u-fg-soft, inherit);
      }
      a {
        display: inline-flex;
        min-height: 44px;
        align-items: center;
      }
    `,
  ],
})
export class ShareViewComponent {}
