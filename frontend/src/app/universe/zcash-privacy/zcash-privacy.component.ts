import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ZcashPrivacySummary } from '@app/universe/universe.types';

interface PrivacyViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly summary?: ZcashPrivacySummary;
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
  private readonly state = new BehaviorSubject<PrivacyViewModel>({ kind: 'loading' });
  readonly vm$: Observable<PrivacyViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Zcash Privacy Observatory');
  }

  ngOnInit(): void {
    this.api.getZcashPrivacySummary$()
      .pipe(catchError(() => of(null)))
      .subscribe((summary) => {
        if (!summary) {
          this.state.next({ kind: 'error' });
          return;
        }
        this.state.next({ kind: 'ready', summary });
      });
  }
}
