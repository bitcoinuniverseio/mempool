import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { combineLatest, Observable, Subject } from 'rxjs';
import { map, shareReplay, startWith, takeUntil } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import { WebsocketService } from '@app/services/websocket.service';

const MAX_BTC_SUPPLY = 21000000;
const MAX_SATOSHI_SUPPLY = MAX_BTC_SUPPLY * 100_000_000;

export interface CalculatorQuote { price: number | null; time: number | null; }
export function calculatorQuote(conversions: Record<string, number> | null | undefined, currency: string): CalculatorQuote {
  const price = conversions?.[currency];
  const time = conversions?.time;
  return {
    price: typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null,
    time: typeof time === 'number' && Number.isSafeInteger(time) && time > 0 && time <= Date.now() / 1000 ? time : null,
  };
}

@Component({
  selector: 'app-calculator',
  templateUrl: './calculator.component.html',
  styleUrls: ['./calculator.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CalculatorComponent implements OnInit, OnDestroy {
  private readonly destroyed$ = new Subject<void>();
  satoshis = 10000;
  form: FormGroup;
  currentPrice: number | null = null;
  isMaxSupply = false;

  currency$ = this.stateService.fiatCurrency$;
  price$: Observable<number | null>;
  lastFiatPrice$: Observable<number | null>;
  quote$: Observable<CalculatorQuote>;

  constructor(
    private stateService: StateService,
    private formBuilder: FormBuilder,
    private websocketService: WebsocketService,
  ) { }

  ngOnInit(): void {
    this.form = this.formBuilder.group({
      fiat: [0],
      bitcoin: [0],
      satoshis: [0],
    });

    this.quote$ = combineLatest([this.currency$, this.stateService.conversions$]).pipe(
      map(([currency, conversions]) => calculatorQuote(conversions, currency)),
      startWith({ price: null, time: null }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.price$ = this.quote$.pipe(map(quote => quote.price));
    this.lastFiatPrice$ = this.quote$.pipe(map(quote => quote.time));
    this.quote$.pipe(takeUntil(this.destroyed$)).subscribe(quote => {
      this.currentPrice = quote.price;
      if (quote.price === null) {
        this.form.get('fiat').disable({ emitEvent: false });
        this.form.get('fiat').setValue(null, { emitEvent: false });
      } else {
        this.form.get('fiat').enable({ emitEvent: false });
        // Feed updates convert the current BTC amount. They never replay an
        // older fiat input or rewrite independently valid BTC/satoshi values.
        this.updateFiat(this.amount(this.form.get('bitcoin').value));
      }
    });
    this.form.get('fiat').valueChanges.pipe(takeUntil(this.destroyed$)).subscribe(value => {
      const amount = this.amount(value);
      if (amount === null || this.currentPrice === null) {return;}
      const bitcoin = Math.min(amount / this.currentPrice, MAX_BTC_SUPPLY);
      this.isMaxSupply = bitcoin >= MAX_BTC_SUPPLY;
      if (this.isMaxSupply) {this.updateFiat(bitcoin);}
      this.form.get('bitcoin').setValue(this.isMaxSupply ? MAX_BTC_SUPPLY.toString() : bitcoin.toFixed(8), { emitEvent: false });
      this.form.get('satoshis').setValue(Math.round(bitcoin * 100_000_000), { emitEvent: false });
    });
    this.form.get('bitcoin').valueChanges.pipe(takeUntil(this.destroyed$)).subscribe(value => {
      const amount = this.amount(value);
      if (amount === null) {return;}
      const bitcoin = Math.min(amount, MAX_BTC_SUPPLY);
      this.isMaxSupply = amount >= MAX_BTC_SUPPLY;
      if (this.isMaxSupply) {this.form.get('bitcoin').setValue(MAX_BTC_SUPPLY.toString(), { emitEvent: false });}
      this.form.get('satoshis').setValue(Math.round(bitcoin * 100_000_000), { emitEvent: false });
      this.updateFiat(bitcoin);
    });
    this.form.get('satoshis').valueChanges.pipe(takeUntil(this.destroyed$)).subscribe(value => {
      const amount = this.amount(value);
      if (amount === null) {return;}
      const satoshis = Math.min(Math.round(amount), MAX_SATOSHI_SUPPLY);
      this.isMaxSupply = amount >= MAX_SATOSHI_SUPPLY;
      if (this.isMaxSupply) {this.form.get('satoshis').setValue(satoshis, { emitEvent: false });}
      const bitcoin = satoshis / 100_000_000;
      this.form.get('bitcoin').setValue(this.isMaxSupply ? MAX_BTC_SUPPLY.toString() : bitcoin.toFixed(8), { emitEvent: false });
      this.updateFiat(bitcoin);
    });
    this.form.get('bitcoin').setValue(1, { emitEvent: true });
  }

  get fiatAvailable(): boolean { return this.currentPrice !== null; }
  copyValue(name: string): string {
    const value: unknown = this.form.get(name)?.value;
    return value === null || value === undefined ? '' : String(value);
  }
  private amount(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {return null;}
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  private updateFiat(bitcoin: number | null): void {
    const fiat = bitcoin === null || this.currentPrice === null ? null : bitcoin * this.currentPrice;
    this.form.get('fiat').setValue(fiat !== null && Number.isFinite(fiat) ? this.formatFiat(fiat) : null, { emitEvent: false });
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  transformInput(name: string): void {
    const formControl = this.form.get(name);
    if (!formControl.value) {
      return formControl.setValue('', {emitEvent: false});
    }
    let value = formControl.value.replace(',', '.').replace(/[^0-9.]/g, '');
    if (value === '.') {
      value = '0';
    }
    let sanitizedValue = this.removeExtraDots(value);
    if (name === 'bitcoin' && this.countDecimals(sanitizedValue) > 8) {
      sanitizedValue = this.toFixedWithoutRounding(sanitizedValue, 8);
    }
    if (name === 'fiat' && this.countDecimals(sanitizedValue) > 2) {
      sanitizedValue = this.toFixedWithoutRounding(sanitizedValue, 2);
    }
    if (sanitizedValue === '') {
      sanitizedValue = '0';
    }
    if (name === 'satoshis') {
      sanitizedValue = parseFloat(sanitizedValue).toFixed(0);
    }
    if (name === 'bitcoin' && parseFloat(sanitizedValue) >= MAX_BTC_SUPPLY) {
      sanitizedValue = MAX_BTC_SUPPLY.toString();
    }
    if (name === 'satoshis' && parseFloat(sanitizedValue) > MAX_SATOSHI_SUPPLY) {
      sanitizedValue = MAX_SATOSHI_SUPPLY.toString();
    }
    formControl.setValue(sanitizedValue, {emitEvent: true});
  }

  removeExtraDots(str: string): string {
    const [beforeDot, afterDot] = str.split('.', 2);
    if (afterDot === undefined) {
      return str;
    }
    const afterDotReplaced = afterDot.replace(/\./g, '');
    return `${beforeDot}.${afterDotReplaced}`;
  }

  countDecimals(numberString: string): number {
    const decimalPos = numberString.indexOf('.');
    if (decimalPos === -1) {return 0;}
    return numberString.length - decimalPos - 1;
  }

  toFixedWithoutRounding(numStr: string, fixed: number): string {
    const re = new RegExp(`^-?\\d+(?:.\\d{0,${(fixed || -1)}})?`);
    const result = numStr.match(re);
    return result ? result[0] : numStr;
  }

  selectAll(event): void {
    event.target.select();
  }

  formatFiat(num: number): string | number {
    if (Math.abs(num) >= 1000) {
      // For values >= 1000: show 2 decimals, or 0 if whole number
      if (num % 1 === 0) {
        return Math.round(num);
      }
      return (Math.round(num * 100) / 100).toFixed(2);
    }
    if (num % 1 === 0) {
      return Math.round(num);
    }
    // For small values (< 1), show more precision
    if (Math.abs(num) < 1 && num !== 0) {
      return num.toFixed(8);
    }
    return (Math.round(num * 100) / 100).toFixed(2);
  }
}
