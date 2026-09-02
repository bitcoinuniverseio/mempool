import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, CommonModule, DatePipe, I18nSelectPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable, combineLatest, map } from 'rxjs';
import { PwaService } from './pwa.service';

/**
 * What the interface says about this browser's own state.
 *
 * The explorer's subject is the chain; this banner's subject is the window it
 * is being read in. Three facts can be worth saying, and no more:
 *
 * - the network is gone, so every page is the last captured one;
 * - a newer build is waiting, and applying it is the visitor's call;
 * - the browser offers installation, and this surface offers it politely.
 *
 * None of the three is ever shown as a number about the chain, and none of
 * the three interrupts what the visitor is reading.
 */

export type BannerState = 'offline' | 'update' | 'install' | null;

export function bannerState(
  offline: boolean,
  updateReady: boolean,
  installable: boolean,
): BannerState {
  if (offline) { return 'offline'; }
  if (updateReady) { return 'update'; }
  if (installable) { return 'install'; }
  return null;
}

@Component({
  selector: 'app-universe-connectivity-banner',
  standalone: true,
  imports: [CommonModule, RouterLink, AsyncPipe, DatePipe],
  templateUrl: './connectivity-banner.component.html',
  styleUrls: ['./connectivity-banner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectivityBannerComponent {
  private readonly pwa = inject(PwaService);

  readonly state$: Observable<BannerState> = combineLatest([
    this.pwa.offline$,
    this.pwa.updateReady$,
    this.pwa.installable$,
  ]).pipe(map(([offline, update, install]) => bannerState(offline, update, install)));

  applyUpdate(): void {
    this.pwa.applyUpdate();
  }

  async install(): Promise<void> {
    await this.pwa.promptInstall();
  }
}
