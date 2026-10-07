import { expect, it } from 'vitest';
import { EphemeralPortfolioComponent } from './ephemeral-portfolio.component';

it('names missing decimals instead of guessing a Bitcoin unit for a protocol holding', () => {
  const label = (EphemeralPortfolioComponent.prototype as any).quantityLabel;
  expect(label.call({}, '9007199254740993')).toBe('Decimals unknown');
  expect(label.call({}, '9007199254740993', 0).replace(/[\u202f,]/g, '')).toBe('9007199254740993');
  expect(label.call({}, '123', 2)).toBe('1.23');
});
