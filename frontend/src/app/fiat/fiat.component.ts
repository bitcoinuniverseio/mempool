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

}
