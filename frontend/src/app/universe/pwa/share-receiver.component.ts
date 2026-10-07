import { ChangeDetectionStrategy, Component, inject, OnDestroy, PLATFORM_ID } from '@angular/core';
import { AsyncPipe, CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { Network } from '@app/shared/regex.utils';
import { Observable, of, Subject } from 'rxjs';
import { catchError, filter, map, switchMap, takeUntil } from 'rxjs/operators';
import { routeForSharedValue, SharedTarget } from './share-target';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

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
  imports: [RelativeUrlPipe, CommonModule, RouterLink, AsyncPipe],
  templateUrl: './share-receiver.component.html',
  styleUrls: ['./share-receiver.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareReceiverComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly stateService = inject(StateService);
  private readonly electrsApi = inject(ElectrsApiService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyed$ = new Subject<void>();
  private readonly relativeUrl = new RelativeUrlPipe(this.stateService);

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
          return { target, title: params.get('title'), network: this.stateService.network };
        }),
        switchMap(({ target, title, network }) => this.open(target, title, network).pipe(
          takeUntil(this.stateService.networkChanged$.pipe(filter((selected) => selected !== network))),
        )),
        catchError(() => of({ state: 'failed', value: '' } as Resolution)),
        takeUntil(this.destroyed$),
      )
    : of({ state: 'opening' });

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  private open(target: SharedTarget, title: string | null, network: string): Observable<Resolution> {
    if (target.kind === 'route') {
      // Explicit links already carry their destination context. Plain identifiers
      // resolve within the network selected when the share was received.
      const path = target.label === 'page' || target.label === 'home'
        ? target.path : this.relativeUrl.transform(target.path, network);
      void this.router.navigateByUrl(path);
      return of({ state: 'opening' });
    }

    if (target.kind === 'ambiguous-hash') {
      // One 64 character hash, two possible subjects. The chain is asked
      // which one it is, block first, then transaction, and if it answers
      // neither, that refusal is the answer.
      return this.electrsApi.getBlock$(target.value).pipe(
        map(() => {
          void this.router.navigateByUrl(this.relativeUrl.transform('/block/' + target.value, network));
          return { state: 'opening' } as Resolution;
        }),
        catchError(() => this.electrsApi.getTransaction$(target.value).pipe(
          map(() => {
            void this.router.navigateByUrl(this.relativeUrl.transform('/tx/' + target.value, network));
            return { state: 'opening' } as Resolution;
          }),
          catchError(() => of({ state: 'failed', value: title ?? target.value } as Resolution)),
        )),
      );
    }

    return of({ state: 'failed', value: title ?? target.value } as Resolution);
  }
}
