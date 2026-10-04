import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, defaultIfEmpty, distinctUntilChanged, finalize, startWith, take, timeout } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Bolt12DecodedOffer, matchingOffer } from './bolt12-decoded-offer';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Bolt12Offer, Bolt12OfferPage, LightningRfqQuote } from '@app/universe/universe.types';
import { checkedOfferPage, listedOfferAmount, OfferCatalogChangedError } from './bolt12-offer-page';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface StandardsViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly offers?: Bolt12Offer[];
  readonly quotes?: LightningRfqQuote[];
  readonly offersError?: string | null;
  readonly quotesError?: string | null;
  readonly offersPending?: boolean;
  readonly offerPage?: Bolt12OfferPage;
  readonly restartRequired?: boolean;
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
  private offerRequest?: Subscription;
  private rfqRequest?: Subscription;
  private scopeRevision = 0;
  private destroyed = false;
  private retryContinuation = false;
  readonly listedAmount = listedOfferAmount;
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
    this.reads = this.networkState.networkChanged$.pipe(startWith(this.networkState.network), distinctUntilChanged()).subscribe(() => {
      this.scopeRevision++; this.offerRequest?.unsubscribe(); this.rfqRequest?.unsubscribe();
      this.clearDecode(); this.offerInput=''; this.state.next({kind:'loading', offers:[], quotes:[]});
      this.readOffers(false);
      const revision = this.scopeRevision;
      this.rfqRequest = this.api.getLightningRfq$().pipe(timeout(15000), take(1)).subscribe({
        next: data => { if (revision === this.scopeRevision) this.publish({quotes:data.quotes, quotesError:null}); },
        error: error => { if (revision === this.scopeRevision) this.publish({quotes:[], quotesError:loadFailureMessage(classifyLoadFailure(error))}); },
      });
    });
  }

  private publish(patch: Partial<StandardsViewModel>): void {
    const next = {...this.state.value, ...patch};
    this.state.next({...next, kind:next.offersError || next.quotesError ? 'error' : 'ready'});
  }
  moreOffers(): void { if (this.state.value.offerPage?.nextCursor && !this.state.value.restartRequired) this.readOffers(true); }
  restartOffers(): void { this.readOffers(false); }
  retryOffers(): void { if (this.state.value.offersError && !this.state.value.restartRequired) this.readOffers(this.retryContinuation); }
  private readOffers(continuation: boolean): void {
    if (this.destroyed || this.state.value.offersPending) return;
    const revision = this.scopeRevision, network = this.api.network || 'mainnet';
    const prior = continuation ? this.state.value.offerPage : undefined;
    if (continuation && !prior?.nextCursor) return;
    this.retryContinuation = continuation;
    this.publish({offersPending:true, offersError:null});
    this.offerRequest = this.api.getBolt12Offers$(20, prior?.nextCursor ?? undefined).pipe(timeout(20000), take(1), defaultIfEmpty(null),
      finalize(() => { if (!this.destroyed && revision === this.scopeRevision) this.publish({offersPending:false}); })).subscribe({
      next: raw => {
        if (revision !== this.scopeRevision || (this.api.network || 'mainnet') !== network) return;
        try {
          const page = checkedOfferPage(raw, network, 20, prior);
          this.publish({offerPage:page, offers:page.offers, offersError:null, restartRequired:false});
        } catch (error) { this.publish({offersError:(error as Error).message, restartRequired:error instanceof OfferCatalogChangedError}); }
      },
      error: error => {
        if (revision !== this.scopeRevision) return;
        this.publish({offersError:error?.status === 409 ? 'The public offer catalog changed or its cursor expired. Restart the offer list; accepted rows remain the previous observation.' : loadFailureMessage(classifyLoadFailure(error)), restartRequired:error?.status === 409});
      },
    });
  }

  listedValidity(offer: Bolt12Offer): string {
    return ({'usable-unverified':'Eligible at observation; invoice availability unverified', 'source-disabled':'Disabled by the source', 'already-used':'Single-use offer already used',
      expired:'Expired at observation', 'wrong-chain':'Offer excludes selected chain', 'unsupported-required-features':'Unsupported required features'} as const)[offer.validity];
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
  ngOnDestroy(): void {this.destroyed=true;this.scopeRevision++;this.clearDecode();this.reads?.unsubscribe();this.offerRequest?.unsubscribe();this.rfqRequest?.unsubscribe();this.state.complete();}
}
