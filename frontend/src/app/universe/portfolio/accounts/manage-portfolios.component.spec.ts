// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { ManagePortfoliosComponent } from './manage-portfolios.component';
import { PortfoliosStore } from '../stores/portfolios.store';
import { emptyPortfolio } from '../stores/portfolio-model';
import { StateService } from '@app/services/state.service';

describe('portfolio deletion failure consumer', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());
  it('retains a retryable confirmation and the selected portfolio after an atomic storage failure', async () => {
    const deletePortfolio = vi.fn(async () => { throw new Error('controlled commit abort'); });
    TestBed.configureTestingModule({ imports: [ManagePortfoliosComponent], providers: [provideRouter([]),
      { provide: StateService, useValue: { network: '', env: { ROOT_NETWORK: 'mainnet' } } },
      { provide: PortfoliosStore, useValue: { portfolios: signal([emptyPortfolio('a', 'Keep until commit', '2026-10-03')]), vaultKind: signal('unlocked'), deletePortfolio } },
    ] });
    const fixture = TestBed.createComponent(ManagePortfoliosComponent);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.row button.danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.dialog button.danger') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(deletePortfolio).toHaveBeenCalledWith('a');
    expect(fixture.nativeElement.querySelector('.dialog [role="alert"]').textContent).toContain('Nothing was partially deleted');
    expect(fixture.nativeElement.querySelector('.dialog button.danger').disabled).toBe(false);
    expect(fixture.componentInstance.deleting()).toBe('a');
    expect(fixture.nativeElement.textContent).toContain('Keep until commit');
  });
});
