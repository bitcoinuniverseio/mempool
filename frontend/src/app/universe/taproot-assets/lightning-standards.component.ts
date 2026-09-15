import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, combineLatest, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { Bolt12DecodedOffer, matchingOffer } from './bolt12-decoded-offer';
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
export class LightningStandardsComponent implements OnInit, OnDestroy {
  offerInput = '';
  decodedOffer: Bolt12DecodedOffer | null = null;
  decodeError: string | null = null;
  decoding = false;
  decodeUnavailable = false;
  private reads?: Subscription;
  private decodingRequest?: Subscription;
  private revision = 0;

  private readonly state = new BehaviorSubject<StandardsViewModel>({ kind: 'loading' });
  readonly vm$: Observable<StandardsViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private networkState: StateService,
    private cdr: ChangeDetectorRef,
  ) {
    this.seo.setTitle('Lightning Standards Intelligence');
  }

  ngOnInit(): void {
    this.reads = this.networkState.networkChanged$.pipe(startWith(this.networkState.network), distinctUntilChanged(), switchMap(() => {
      this.clearDecode(); this.offerInput=''; this.state.next({kind:'loading'});
      return combineLatest([
      this.api.getBolt12Offers$().pipe(
        map(data => ({ offers: data.offers, error: null as string | null })),
        catchError(error => of({ offers: [], error: loadFailureMessage(classifyLoadFailure(error)) }))),
      this.api.getLightningRfq$().pipe(
        map(data => ({ quotes: data.quotes, error: null as string | null })),
        catchError(error => of({ quotes: [], error: loadFailureMessage(classifyLoadFailure(error)) }))),
    ]);
    })).subscribe(([offersData, rfqData]) => {
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
    this.clearDecode();
    const input = this.offerInput.trim();
    if (!/^lno1/i.test(input) || new TextEncoder().encode(input).length>16384) { this.decodeError='Enter a BOLT12 offer beginning lno1, at most 16 KiB.'; return; }
    const revision=this.revision, network=this.api.network||'mainnet', digest=bytesToHex(sha256(new TextEncoder().encode(input)));
    this.decoding=true;
    this.decodingRequest=this.api.decodeBolt12Offer$(input).subscribe({
      next: result => {
        if(revision!==this.revision||(this.api.network||'mainnet')!==network)return;
        this.decoding=false;
        if(matchingOffer(result,digest,network))this.decodedOffer=result;
        else {this.decodeError='The decoder returned incomplete or mismatched evidence.';this.decodeUnavailable=true;}
        this.cdr.markForCheck();
      },
      error: error => {
        if(revision!==this.revision||(this.api.network||'mainnet')!==network)return;
        this.decoding=false;this.decodeUnavailable=error?.status!==400;
        this.decodeError=error?.error?.error||(this.decodeUnavailable?'The native offer decoder is unavailable.':'The native parser rejected this offer.');this.cdr.markForCheck();
      },
    });
  }
  clearDecode(): void {this.revision++;this.decodingRequest?.unsubscribe();this.decodedOffer=null;this.decodeError=null;this.decoding=false;this.decodeUnavailable=false;this.cdr.markForCheck();}
  amountLabel(offer: Bolt12DecodedOffer): string {return offer.amount===null?'Not specified':offer.amount.kind==='bitcoin'?`${offer.amount.amount_msat} msat`:`${offer.amount.amount_minor_units} ${offer.amount.currency} minor units`;}
  quantityLabel(offer: Bolt12DecodedOffer): string {return offer.quantity.kind==='bounded'?offer.quantity.maximum:offer.quantity.kind;}
  ngOnDestroy(): void {this.clearDecode();this.reads?.unsubscribe();}
}
