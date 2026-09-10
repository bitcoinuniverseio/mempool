import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Bolt12Offer, LightningRfqQuote } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface StandardsViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly offers?: Bolt12Offer[];
  readonly quotes?: LightningRfqQuote[];
  readonly offersError?: string | null;
  readonly quotesError?: string | null;
}

@Component({
  selector: 'app-lightning-standards',
  templateUrl: './lightning-standards.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LightningStandardsComponent implements OnInit {
  offerInput = '';
  decodedOffer: Bolt12Offer | null = null;
  decodeError: string | null = null;

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
      this.api.getBolt12Offers$().pipe(
        map(data => ({ offers: data.offers, error: null as string | null })),
        catchError(error => of({ offers: [], error: loadFailureMessage(classifyLoadFailure(error)) }))),
      this.api.getLightningRfq$().pipe(
        map(data => ({ quotes: data.quotes, error: null as string | null })),
        catchError(error => of({ quotes: [], error: loadFailureMessage(classifyLoadFailure(error)) }))),
    ]).subscribe(([offersData, rfqData]) => {
      this.state.next({
        kind: offersData.error || rfqData.error ? 'error' : 'ready',
        offers: offersData.offers,
        quotes: rfqData.quotes,
        offersError: offersData.error,
        quotesError: rfqData.error,
      });
    });
  }

  offerValidityLabel(valid: unknown): string {
    return valid === true ? 'Source reports valid' : valid === false ? 'Source reports invalid' : 'Validity not reported';
  }

  quoteExpiry(validUntil: number): string {
    // The owned RFQ API reports Unix seconds. Show its absolute value rather
    // than inventing a fresh lifetime every time the row renders.
    return Number.isSafeInteger(validUntil) && validUntil >= 0 && validUntil <= 8_640_000_000_000
      ? new Date(validUntil * 1000).toISOString() : 'Not reported';
  }

  decode(): void {
    const input = this.offerInput.trim();
    if (!input) return;

    // No BOLT12 decoder ships here. The revision this replaces echoed the
    // input back with an invented description, an invented blinded-route count
    // and a badge reading "Valid BOLT12 Syntax", for any string at all.
    this.decodedOffer = null;
    this.decodeError = $localize`:@@bolt12.decoder.unavailable:This deployment carries no BOLT12 decoder, so this offer has not been read.`;
  }
}
