import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Bolt12Offer, LightningRfqQuote } from '@app/universe/universe.types';

interface StandardsViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly offers?: Bolt12Offer[];
  readonly quotes?: LightningRfqQuote[];
}

export interface OfferInspectionResult {
  readonly kind: 'invalid-input' | 'unavailable';
  readonly message: string;
}

@Component({
  selector: 'app-lightning-standards',
  templateUrl: './lightning-standards.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LightningStandardsComponent implements OnInit {
  offerInput = '';
  offerInspection: OfferInspectionResult | null = null;

  private readonly state = new BehaviorSubject<StandardsViewModel>({ kind: 'loading' });
  readonly vm$: Observable<StandardsViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Lightning Standards Intelligence');
  }

  ngOnInit(): void {
    combineLatest([
      this.api.getBolt12Offers$(),
      this.api.getLightningRfq$(),
    ]).pipe(
      map(([offersData, rfqData]): StandardsViewModel => ({
        kind: 'ready',
        offers: offersData.offers,
        quotes: rfqData.quotes,
      })),
      catchError(() => of<StandardsViewModel>({ kind: 'error' })),
    ).subscribe((viewModel) => this.state.next(viewModel));
  }

  decode(): void {
    const input = this.offerInput.trim();
    const lower = input.toLowerCase();
    const hasMixedCase = input !== lower && input !== input.toUpperCase();
    const hasOfferShape = /^lno1[023456789ac-hj-np-z]+$/.test(lower) && !hasMixedCase;
    this.offerInspection = {
      kind: hasOfferShape ? 'unavailable' : 'invalid-input',
      message: hasOfferShape
        ? 'BOLT12 decoding and checksum verification are unavailable in this build. No offer fields were decoded.'
        : 'Enter a single-case BOLT12 offer beginning with lno1.',
    };
  }
}
