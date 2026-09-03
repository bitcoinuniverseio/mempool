import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { WildkinStatusSummary } from '@app/universe/universe.types';

interface WildkinViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly status?: WildkinStatusSummary;
}

@Component({
  selector: 'app-wildkin',
  templateUrl: './wildkin.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WildkinComponent implements OnInit {
  private readonly state = new BehaviorSubject<WildkinViewModel>({ kind: 'loading' });
  readonly vm$: Observable<WildkinViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Wildkin Evidence Explorer');
  }

  ngOnInit(): void {
    this.api.getWildkinStatus$()
      .pipe(catchError(() => of(null)))
      .subscribe((status) => {
        if (!status) {
          this.state.next({ kind: 'error' });
          return;
        }
        this.state.next({ kind: 'ready', status });
      });
  }
}
