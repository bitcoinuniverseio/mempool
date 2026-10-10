import { Component, OnInit, ChangeDetectionStrategy, Input, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { Price } from '@app/services/price.service';
import { StateService } from '@app/services/state.service';

@Component({
  selector: 'app-fiat',
  templateUrl: './fiat.component.html',
  styleUrls: [],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiatComponent implements OnInit, OnDestroy {
  conversions$: Observable<any>;
  currencySubscription: Subscription;
  currency: string;

  @Input() value: number;
  @Input() digitsInfo = '1.2-2';
  @Input() unavailableLabel = '';
  @Input() blockConversion: Price;
  /**
   * Fiat amounts are converted figures, not judgements.
   *
   * They defaulted to green, which in this product means proven. A dollar
   * estimate beside every fee is neither proven nor good news, and painting
   * it in the evidence colour spent that signal on decoration.
   */
  @Input() colorClass = 'fiat-amount';

  constructor(
    private stateService: StateService,
    private cd: ChangeDetectorRef,
  ) {
    this.currencySubscription = this.stateService.fiatCurrency$.subscribe((fiat) => {
      this.currency = fiat;
      this.cd.markForCheck();
    });
  }

  ngOnInit(): void {
    this.conversions$ = this.stateService.conversions$.asObservable();
  }

  ngOnDestroy(): void {
    this.currencySubscription.unsubscribe();
  }

  /**
   * The rate to convert with, or null when this deployment has no price for
   * this currency.
   *
   * A missing rate used to fall through to zero, so every amount rendered as
   * a confident $0.00. A price we do not have is not a price of nothing, and
   * showing it as one is the same class of error as reporting a failed query
   * as an empty result.
   */
  rateFrom(conversions: Record<string, number> | null | undefined): number | null {
    if (!conversions) {return null;}
    const preferred = conversions[this.currency];
    return typeof preferred === 'number' && Number.isFinite(preferred) && preferred > 0 ? preferred : null;
  }

  /** Same, for a price pinned to the block being viewed. */
  blockRate(): number | null {
    const price = this.blockConversion?.price;
    if (!price) {return null;}
    const preferred = price[this.currency];
    if (typeof preferred === 'number' && Number.isFinite(preferred) && preferred > 0) {return preferred;}
    const usd = price['USD'];
    const rate = this.blockConversion.exchangeRates?.['USD' + this.currency];
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0 && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      const converted = usd * rate;
      return Number.isFinite(converted) && converted > 0 ? converted : null;
    }
    return null;
  }

  /** Converts a satoshi amount at the given rate. */
  converted(rate: number): number {
    return rate * this.value / 100000000;
  }
}
