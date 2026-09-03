import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Bolt12Offer, LightningRfqQuote } from '@app/universe/universe.types';

interface StandardsViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly offers?: Bolt12Offer[];
  readonly quotes?: LightningRfqQuote[];
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
  decodedOffer: Bolt12Offer | null = null;

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
      this.api.getBolt12Offers$().pipe(catchError(() => of({ offers: [] }))),
      this.api.getLightningRfq$().pipe(catchError(() => of({ quotes: [] }))),
    ]).subscribe(([offersData, rfqData]) => {
      this.state.next({
        kind: 'ready',
        offers: offersData.offers,
        quotes: rfqData.quotes,
      });
    });
  }

  decode(): void {
    const input = this.offerInput.trim();
    if (!input) return;

    this.decodedOffer = {
      offerId: input,
      offerString: input,
      description: 'Decoded Custom Offer',
      currency: 'msat',
      blindRoutesCount: 2,
      valid: true,
    };
  }
}
