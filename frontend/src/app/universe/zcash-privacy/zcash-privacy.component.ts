import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ZcashPrivacySummary } from '@app/universe/universe.types';

interface PrivacyViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly summary?: ZcashPrivacySummary;
  readonly message?: string;
}

@Component({
  selector: 'app-zcash-privacy',
  templateUrl: './zcash-privacy.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZcashPrivacyComponent implements OnInit {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<PrivacyViewModel>({ kind: 'loading' });
  readonly vm$: Observable<PrivacyViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Zcash Privacy Observatory');
  }

  ngOnInit(): void {
    this.api.getZcashPrivacySummary$().subscribe({
      next: (summary) => {
        if (!summary) {
          this.state.next({ kind: 'error', message: loadFailureMessage('malformed') });
          return;
        }
        this.state.next({ kind: 'ready', summary });
      },
      // A 503 carries the name of the source the backend is missing; show it rather than a fixed line.
      error: (err) => {
        this.state.next({ kind: 'error', message: err?.error?.error || loadFailureMessage(classifyLoadFailure(err)) });
      },
    });
  }
}
