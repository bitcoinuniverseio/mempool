import { ChangeDetectionStrategy, Component, inject, PLATFORM_ID } from '@angular/core';
import { AsyncPipe, CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { Network } from '@app/shared/regex.utils';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { routeForSharedValue, SharedTarget } from './share-target';

/**
 * Where the operating system lands a share.
 *
 * The manifest names this page as the share target, so a visitor can send a
 * transaction id from a messenger, a link from their browser, or a block
 * height from a note, and arrive at the page about it. What it receives is
 * resolved with the same rules search uses. Whatever it cannot resolve is
 * stated rather than guessed at.
 */

type Resolution =
  | { readonly state: 'opening' }
  | { readonly state: 'resolving'; readonly value: string }
  | { readonly state: 'failed'; readonly value: string };

@Component({
  selector: 'app-universe-share-receiver',
  standalone: true,
  imports: [CommonModule, RouterLink, AsyncPipe],
  templateUrl: './share-receiver.component.html',
  styleUrls: ['./share-receiver.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareReceiverComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly stateService = inject(StateService);
  private readonly electrsApi = inject(ElectrsApiService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * On the server there is no share to read, so the page states the least it
   * can truthfully say and leaves the rest to the browser.
   */
  readonly resolution$: Observable<Resolution> = this.browser
    ? this.route.queryParamMap.pipe(
        map((params) => {
          const target = routeForSharedValue(
            params.get('text'),
            params.get('url'),
            {
              origin: window.location.origin,
              network: this.stateService.network as Network,
            },
          );
          return { target, title: params.get('title') };
        }),
        switchMap(({ target, title }) => this.open(target, title)),
        catchError(() => of({ state: 'failed', value: '' } as Resolution)),
      )
    : of({ state: 'opening' });

  private open(target: SharedTarget, title: string | null): Observable<Resolution> {
    if (target.kind === 'route') {
      void this.router.navigateByUrl(target.path);
      return of({ state: 'opening' });
    }

    if (target.kind === 'ambiguous-hash') {
      // One 64 character hash, two possible subjects. The chain is asked
      // which one it is, block first, then transaction, and if it answers
      // neither, that refusal is the answer.
      return this.electrsApi.getBlock$(target.value).pipe(
        map(() => {
          void this.router.navigate(['/block', target.value]);
          return { state: 'opening' } as Resolution;
        }),
        catchError(() => this.electrsApi.getTransaction$(target.value).pipe(
          map(() => {
            void this.router.navigate(['/tx', target.value]);
            return { state: 'opening' } as Resolution;
          }),
          catchError(() => of({ state: 'failed', value: title ?? target.value } as Resolution)),
        )),
      );
    }

    return of({ state: 'failed', value: title ?? target.value } as Resolution);
  }
}
