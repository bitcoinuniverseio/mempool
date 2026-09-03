import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { WildkinBraidCeremony } from '@app/universe/universe.types';

interface BloodlinesViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly braids?: WildkinBraidCeremony[];
}

@Component({
  selector: 'app-wildkin-bloodlines',
  templateUrl: './wildkin-bloodlines.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WildkinBloodlinesComponent implements OnInit {
  private readonly state = new BehaviorSubject<BloodlinesViewModel>({ kind: 'loading' });
  readonly vm$: Observable<BloodlinesViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Wildkin Bloodlines and Braids');
  }

  ngOnInit(): void {
    this.api.getWildkinBraids$()
      .pipe(catchError(() => of({ braids: [] })))
      .subscribe((data) => {
        this.state.next({ kind: 'ready', braids: data.braids });
      });
  }
}
