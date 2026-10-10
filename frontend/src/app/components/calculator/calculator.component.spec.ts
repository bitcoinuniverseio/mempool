// @vitest-environment jsdom
import 'zone.js';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, CUSTOM_ELEMENTS_SCHEMA, inject, Pipe, PipeTransform, ɵresolveComponentResources } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CalculatorComponent, calculatorQuote } from './calculator.component';
import { ClipboardComponent } from '../clipboard/clipboard.component';
import { StateService } from '@app/services/state.service';

const calculatorHtml = readFileSync('src/app/components/calculator/calculator.component.html', 'utf8');
const clipboardHtml = readFileSync('src/app/components/clipboard/clipboard.component.html', 'utf8');
let state: Pick<StateService, 'fiatCurrency$' | 'conversions$'>;
let conversions: BehaviorSubject<Record<string, number>>;
function setupState(price = 100, time = 1): void {
  conversions = new BehaviorSubject({ USD: price, EUR: 200, time });
  state = { fiatCurrency$: new BehaviorSubject('USD'), conversions$: conversions };
}
function controller(): CalculatorComponent {
  const component = new CalculatorComponent(state as StateService, new FormBuilder(), {} as never);
  component.ngOnInit(); return component;
}
@Pipe({ name: 'fiatCurrency', standalone: true }) class CurrencyFixture implements PipeTransform {
  transform(value: number): string { return '$' + value; }
}
@Pipe({ name: 'bitcoinsatoshis', standalone: true }) class BitcoinFixture implements PipeTransform {
  transform(value: string | number): string { return String(value); }
}
@Component({ selector: 'app-clipboard', standalone: true, imports: [CommonModule], schemas: [CUSTOM_ELEMENTS_SCHEMA], template: clipboardHtml })
class RenderedClipboard extends ClipboardComponent { constructor() { super(inject(ChangeDetectorRef)); } }
@Component({ standalone: true, imports: [CommonModule, ReactiveFormsModule, RenderedClipboard, CurrencyFixture, BitcoinFixture], schemas: [CUSTOM_ELEMENTS_SCHEMA], template: calculatorHtml })
class RenderedCalculator extends CalculatorComponent { constructor() { super(state as StateService, new FormBuilder(), {} as never); } }

beforeAll(async () => {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  await ɵresolveComponentResources(url => Promise.resolve(url.endsWith('calculator.component.html') ? calculatorHtml : url.endsWith('clipboard.component.html') ? clipboardHtml : ''));
});
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('calculator independent BTC/satoshi conversion and unavailable quote', () => {
  it.each([-1, -0.5, 0, NaN, Infinity, -Infinity])('rejects price %s without corrupting BTC or satoshis', price => {
    setupState(price, 0); const component = controller();
    expect(component.currentPrice).toBeNull(); expect(component.form.get('fiat').disabled).toBe(true);
    expect(component.copyValue('fiat')).toBe(''); expect(component.form.get('bitcoin').value).toBe(1);
    expect(component.form.get('satoshis').value).toBe(100000000);
    component.form.get('satoshis').setValue(250000000);
    expect(component.form.get('bitcoin').value).toBe('2.50000000');
    conversions.next({ USD: 200, time: 1 });
    expect(component.form.get('fiat').value).toBe(500);
    expect(component.form.get('bitcoin').value).toBe('2.50000000');
    expect(component.form.get('satoshis').value).toBe(250000000);
    component.ngOnDestroy();
  });
  it('does not replay an earlier fiat edit when a quote or currency changes', () => {
    setupState(); const component = controller(); component.form.get('fiat').setValue(50);
    component.form.get('satoshis').setValue(200000000);
    conversions.next({ USD: 300, EUR: 400, time: 1 });
    expect(component.form.get('bitcoin').value).toBe('2.00000000'); expect(component.form.get('fiat').value).toBe(600);
    state.fiatCurrency$.next('EUR'); expect(component.form.get('fiat').value).toBe(800);
    expect(component.form.get('satoshis').value).toBe(200000000); component.ngOnDestroy();
  });
  it('accepts only a real positive timestamp, independently from quote availability', () => {
    for (const time of [0, -1, NaN, Infinity, Date.now() / 1000 + 100]) {expect(calculatorQuote({ USD: 100, time }, 'USD').time).toBeNull();}
    expect(calculatorQuote({ USD: 100, time: 1 }, 'USD')).toEqual({ price: 100, time: 1 });
    expect(calculatorQuote(undefined, 'USD')).toEqual({ price: null, time: null });
    expect(calculatorQuote({ time: 1 }, 'USD').price).toBeNull();
  });
});
describe('actual calculator and Clipboard templates', () => {
  it('names every input/copy control and suppresses unavailable prices and epoch age', () => {
    setupState(-1, 0); const fixture = TestBed.createComponent(RenderedCalculator); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(Array.from(element.querySelectorAll('input')).map(input => input.getAttribute('aria-label'))).toEqual(['Fiat amount', 'Bitcoin amount', 'Satoshi amount']);
    const buttons = Array.from(element.querySelectorAll('button'));
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Copy fiat amount', 'Copy bitcoin amount', 'Copy satoshi amount']);
    expect(buttons[0].disabled).toBe(true); expect(buttons[1].disabled).toBe(false);
    expect(element.textContent).toContain('Fiat conversion is unavailable'); expect(element.textContent).not.toContain('-$1');
    expect(element.querySelector('app-time')).toBeNull();
    conversions.next({ USD: 100, time: 0 }); fixture.detectChanges();
    expect(element.textContent).toContain('Fiat price update time is unavailable'); expect(element.querySelector('app-time')).toBeNull();
    conversions.next({ USD: 100, time: 1 }); fixture.detectChanges();
    expect(element.querySelector('app-time')).not.toBeNull(); expect(buttons[0].disabled).toBe(false);
  });
  it('copies a legitimate zero as text rather than ignoring it', async () => {
    vi.useFakeTimers(); setupState(); const copy = vi.spyOn(ClipboardComponent.prototype, 'copyToClipboard').mockResolvedValue(undefined);
    const fixture = TestBed.createComponent(RenderedCalculator); fixture.detectChanges();
    fixture.componentInstance.form.get('bitcoin').setValue(0); fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Copy bitcoin amount"]');
    expect(button.disabled).toBe(false); button.click(); await Promise.resolve();
    expect(copy).toHaveBeenCalledWith('0'); vi.runOnlyPendingTimers();
  });
  it('renders an accessible copy failure without a false success announcement', async () => {
    setupState(); vi.spyOn(ClipboardComponent.prototype, 'copyToClipboard').mockRejectedValue(new Error('permission denied'));
    const fixture = TestBed.createComponent(RenderedCalculator); fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Copy bitcoin amount"]').click();
    await Promise.resolve(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('Could not copy');
    expect((fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Copied to clipboard"]')).toBeNull();
  });
  it('retains the generic default name and keyboard reachability for ordinary Clipboard callers', () => {
    TestBed.configureTestingModule({ imports: [RenderedClipboard] }); const fixture = TestBed.createComponent(RenderedClipboard);
    fixture.componentInstance.text = 'address'; fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button');
    expect(button.getAttribute('aria-label')).toBe('Copy to clipboard'); expect(button.tabIndex).toBe(0);
  });
});
