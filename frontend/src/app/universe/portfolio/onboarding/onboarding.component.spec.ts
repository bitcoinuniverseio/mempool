// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Router } from '@angular/router';
import { PortfoliosStore } from '../stores/portfolios.store';
import { OnboardingComponent } from './onboarding.component';

describe('vault onboarding progress and retry', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());

  it('disables duplicate creation, reports failure, then allows a successful retry', async () => {
    let fail!: (error: Error) => void;
    const store = { createVault: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })), vaultKind: () => 'absent' };
    TestBed.configureTestingModule({ providers: [
      { provide: PortfoliosStore, useValue: store }, { provide: Router, useValue: { navigate: vi.fn() } },
    ] });
    const view = TestBed.createComponent(OnboardingComponent);
    view.componentInstance.step.set('vault');
    view.detectChanges();
    const inputs = view.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    inputs[0].value = 'test-owned-passphrase'; inputs[1].value = 'test-owned-passphrase';
    const button = view.nativeElement.querySelector('button.primary') as HTMLButtonElement;
    button.click(); view.detectChanges();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Creating');
    button.click();
    expect(store.createVault).toHaveBeenCalledOnce();
    fail(new Error('worker unavailable'));
    await vi.waitFor(() => { view.detectChanges(); expect(button.disabled).toBe(false); });
    expect(view.nativeElement.querySelector('[role=alert]').textContent).toContain('could not be created');
    store.createVault.mockResolvedValueOnce();
    button.click();
    await vi.waitFor(() => { view.detectChanges(); expect(view.componentInstance.step()).toBe('input'); });
    expect(view.nativeElement.textContent).toContain('Add one public address');
  });
});
