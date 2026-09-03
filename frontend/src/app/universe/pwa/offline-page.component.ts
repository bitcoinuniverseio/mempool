import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AsyncPipe, CommonModule, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';
import { PwaService } from './pwa.service';
import { formatBytes, storageSentence } from './storage-format';

/**
 * The offline page, and with it the controls for everything this explorer
 * keeps on this device.
 *
 * This document is captured by the service worker at install, which is what
 * makes it openable with no network at all. It states what stored means,
 * shows the storage the browser reports, and offers every deletion as a
 * separate named action, because "clear everything" as one unlabeled lever is
 * how a visitor loses a workspace they meant to keep.
 */
@Component({
  selector: 'app-universe-offline-page',
  standalone: true,
  imports: [CommonModule, RouterLink, AsyncPipe, DecimalPipe],
  templateUrl: './offline-page.component.html',
  styleUrls: ['./offline-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflinePageComponent {
  private readonly pwa = inject(PwaService);

  readonly offline$ = this.pwa.offline$;
  readonly updateReady$ = this.pwa.updateReady$;
  readonly installable$ = this.pwa.installable$;
  readonly storageLine$ = this.pwa.storage$.pipe(map((report) => storageSentence(report.usageBytes, report.quotaBytes)));
  readonly supported = this.pwa.supported;

  /** Results of each deletion, stated once and never summed into spinners. */
  readonly deletedStored = signal<boolean | null>(null);
  readonly deletedPersonal = signal<number | null>(null);

  readonly formatBytes = formatBytes;

  constructor() {
    this.pwa.refreshStorage();
  }

  async deleteStored(): Promise<void> {
    this.deletedStored.set(await this.pwa.clearStoredData());
    this.pwa.refreshStorage();
  }

  deletePersonal(): void {
    this.deletedPersonal.set(this.pwa.clearLocalPersonalData());
  }

  applyUpdate(): void {
    this.pwa.applyUpdate();
  }

  async install(): Promise<void> {
    await this.pwa.promptInstall();
  }
}
