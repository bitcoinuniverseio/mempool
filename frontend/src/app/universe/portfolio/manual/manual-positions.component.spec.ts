// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { emptyPortfolio, type LocalPortfolio } from '../stores/portfolio-model';
import { ManualPositionsComponent } from './manual-positions.component';

describe('manual positions editor', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());

  function fixture() {
    const activePortfolio = signal<LocalPortfolio | null>(emptyPortfolio('manual-one', 'Local only', '2026-09-06'));
    const valuesHidden = signal(false);
    const updatePortfolio = vi.fn(async (_id: string, mutate: (portfolio: LocalPortfolio) => LocalPortfolio) => {
      activePortfolio.set(mutate(activePortfolio()!));
    });
    TestBed.configureTestingModule({ providers: [
      { provide: PortfoliosStore, useValue: { activePortfolio, updatePortfolio } },
      { provide: PortfolioSessionService, useValue: { valuesHidden } },
    ] });
    const view = TestBed.createComponent(ManualPositionsComponent);
    view.detectChanges();
    const component = view.componentInstance;
    component.draft = { name: ' Explicit local position ', kind: 'asset', quantity: '9007199254740993.12345678', unitPrice: '0.00000003', quoteCurrency: ' usd ', effectiveAt: '2026-09-06' };
    return { view, component, activePortfolio, updatePortfolio, valuesHidden };
  }

  it('persists exact user-entered fields through the store without adding public accounts or combined balances', async () => {
    const { view, component, activePortfolio, updatePortfolio } = fixture();
    await component.save();
    view.detectChanges();
    expect(updatePortfolio).toHaveBeenCalledOnce();
    expect(activePortfolio()!.accounts).toEqual([]);
    expect(activePortfolio()!.manualEntries).toEqual([expect.objectContaining({
      name: 'Explicit local position', quantity: '9007199254740993.12345678', unitPrice: '0.00000003', quoteCurrency: 'USD',
      authority: 'user', includedInCombined: false, effectiveAt: '2026-09-06T00:00:00.000Z',
    })]);
    expect(view.nativeElement.querySelector('tbody').textContent).toContain('270\u202f215\u202f977.6422297937037034');
    expect(component.message()).toContain('saved');
  });

  it('edits the selected ID and removes it without changing other positions', async () => {
    const { component, activePortfolio } = fixture();
    await component.save();
    const first = activePortfolio()!.manualEntries[0];
    component.draft = { name: 'Unpriced liability', kind: 'liability', quantity: '2.50', unitPrice: '', quoteCurrency: '', effectiveAt: '2026-09-06' };
    await component.save();
    component.edit(first);
    component.draft.quantity = '0.00000001';
    await component.save();
    expect(activePortfolio()!.manualEntries[0]).toMatchObject({ id: first.id, quantity: '0.00000001' });
    expect(activePortfolio()!.manualEntries[1]).toMatchObject({ name: 'Unpriced liability', kind: 'liability', quantity: '2.50', unitPrice: undefined, quoteCurrency: undefined });
    await component.remove(first.id);
    expect(activePortfolio()!.manualEntries.map(entry => entry.name)).toEqual(['Unpriced liability']);
  });

  it('keeps stored entries and the editable draft when persistence fails', async () => {
    const { component, activePortfolio, updatePortfolio } = fixture();
    updatePortfolio.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await component.save();
    expect(activePortfolio()!.manualEntries).toEqual([]);
    expect(component.error()).toContain('could not be saved');
    expect(component.draft.quantity).toBe('9007199254740993.12345678');
    expect(component.busy()).toBe(false);
    await component.save();
    expect(activePortfolio()!.manualEntries).toHaveLength(1);
  });

  it('refuses invalid input before storage and prevents duplicate submits while saving', async () => {
    const { component, updatePortfolio } = fixture();
    component.draft.quantity = '1e9';
    await component.save();
    expect(updatePortfolio).not.toHaveBeenCalled();
    component.draft.quantity = '1';
    let finish!: () => void;
    updatePortfolio.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = component.save();
    await component.save();
    expect(updatePortfolio).toHaveBeenCalledOnce();
    finish(); await pending;
  });

  it('masks stored quantity and estimated value when session privacy is enabled', async () => {
    const { view, component, valuesHidden } = fixture();
    await component.save();
    valuesHidden.set(true); view.detectChanges();
    const table = view.nativeElement.querySelector('tbody').textContent;
    expect(table).not.toContain('9007199254740993');
    expect(table).not.toContain('6422297937037034');
  });

  it('clears an old edit draft when the active portfolio changes', async () => {
    const { view, component, activePortfolio } = fixture();
    await component.save(); component.edit(activePortfolio()!.manualEntries[0]);
    activePortfolio.set(emptyPortfolio('manual-two', 'Another local portfolio', '2026-09-06'));
    view.detectChanges();
    expect(component.editing()).toBe('');
    expect(component.draft.name).toBe('');
    expect(component.entries()).toEqual([]);
  });

  it('removes an active editor from the DOM on privacy hide and prevents hidden edits or saves', async () => {
    const { view, component, activePortfolio, valuesHidden, updatePortfolio } = fixture();
    await component.save();
    const entry = activePortfolio()!.manualEntries[0];
    component.edit(entry); view.detectChanges(); await view.whenStable();
    expect(view.nativeElement.querySelector('input[name="quantity"]').value).toBe(entry.quantity);
    valuesHidden.set(true); view.detectChanges();
    expect(view.nativeElement.querySelector('form')).toBeNull();
    expect(view.nativeElement.querySelector('input')).toBeNull();
    expect(component.draft.quantity).toBe('');
    component.edit(entry);
    expect(component.editing()).toBe('');
    await component.save();
    expect(updatePortfolio).toHaveBeenCalledOnce();
    valuesHidden.set(false); view.detectChanges(); await view.whenStable();
    expect(view.nativeElement.querySelector('input[name="quantity"]').value).toBe('');
  });
});
