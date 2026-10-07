import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { FormBuilder } from '@angular/forms';
import { CalculatorComponent } from './calculator/calculator.component';

describe('native calculator lifecycle', () => {
  it('releases all price/control observers after route destruction and permits fresh entry', () => {
    const currency = new BehaviorSubject('USD');
    const conversions = new BehaviorSubject({ USD: 100, time: 1 });
    const state = { fiatCurrency$: currency, conversions$: conversions };
    const create = () => {
      const component = new CalculatorComponent(state as any, new FormBuilder(), {} as any);
      component.ngOnInit();
      return component;
    };
    const first = create();
    expect(first.form.get('fiat').value).toBe(100);
    first.form.get('satoshis').setValue(200000000);
    expect(first.form.get('bitcoin').value).toBe('2.00000000');
    first.ngOnDestroy();
    expect(currency.observed).toBe(false);
    expect(conversions.observed).toBe(false);
    expect((first.form.get('satoshis').valueChanges as any).observed).toBe(false);
    const previous = first.form.getRawValue();
    conversions.next({ USD: 200, time: 2 });
    expect(first.form.getRawValue()).toEqual(previous);
    const next = create();
    expect(next.form.get('fiat').value).toBe(200);
    next.form.get('bitcoin').setValue(3);
    expect(next.form.get('satoshis').value).toBe(300000000);
    next.ngOnDestroy();
    expect(conversions.observed).toBe(false);
  });
});
