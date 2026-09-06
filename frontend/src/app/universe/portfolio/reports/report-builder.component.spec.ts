// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { PortfolioDataService, PortfolioDataState } from '../data/portfolio-data.service';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioShareService } from '../share/portfolio-share.service';
import { AggregationResult } from '../shared/aggregation';
import { ReportBuilderComponent, reportPercentage } from './report-builder.component';
import { PortfoliosStore } from '../stores/portfolios.store';
import { emptyPortfolio } from '../stores/portfolio-model';

describe('exact portfolio report percentages', () => {
  it.each([
    ['0.10', '1', '10%'], ['1', '10.00', '10%'], ['1.25', '2.5', '50%'],
    ['9007199254740993', '18014398509481986', '50%'], ['1', '3', '33.33%'],
    ['0', '1', '0%'], ['1', '0.00', 'Unavailable'], [null, '1', 'Unpriced'],
    ['1', null, 'Unpriced'], ['NaN', '1', 'Unpriced'],
  ])('derives %s / %s as %s without floating point', (part, total, expected) => {
    expect(reportPercentage(part, total)).toBe(expected);
  });
});

describe('portfolio report sharing controls', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); TestBed.resetTestingModule(); });

  function fixture() {
    const completedAt = '2026-09-05T12:00:00.000Z';
    const aggregation = {
      pricedTotal: '1', holdings: [{ assetKey: 'bitcoin:mainnet:BTC', displayName: 'BTC', pricedValue: '0.10', locations: [{ address: 'private-address-one' }] }],
    } as unknown as AggregationResult;
    const data = signal<PortfolioDataState>({ loading: false, accounts: [], completedAt, aggregation });
    const routeParams = new BehaviorSubject(convertToParamMap({ portfolioId: 'owner-one' }));
    const portfolios = signal([emptyPortfolio('owner-one', 'Local report', '2026-09-06')]);
    const valuesHidden = signal(false);
    const shares = {
      unlocked: vi.fn(() => true), list: vi.fn(async () => []), create: vi.fn(async () => 'share-id'),
      link: vi.fn(async () => 'https://example.test/portfolio/share/share-id#key=fragment-secret'),
      retry: vi.fn(async () => undefined), revoke: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: ActivatedRoute, useValue: { pathFromRoot: [{ paramMap: routeParams }] } },
      { provide: PortfolioDataService, useValue: { state: data } },
      { provide: PortfolioSessionService, useValue: { valuesHidden } },
      { provide: PortfolioShareService, useValue: shares },
      { provide: PortfoliosStore, useValue: { portfolios } },
    ] });
    const view = TestBed.createComponent(ReportBuilderComponent);
    view.detectChanges();
    return { view, component: view.componentInstance, data, shares, completedAt, routeParams, portfolios, valuesHidden };
  }

  it('renders the export value in preview and shares only asset and percentage', async () => {
    const { view, component, shares, completedAt } = fixture();
    component.addressMode.set('included');
    view.detectChanges();
    expect(view.nativeElement.querySelector('tbody').textContent).toContain('0.1');
    expect(view.nativeElement.querySelector('tbody').textContent).toContain('10%');
    await component.createShare();
    expect(shares.create).toHaveBeenCalledWith('owner-one', [{ asset: 'BTC', share: '10%' }], completedAt, 86400);
    expect(component.shareLink()).toContain('#key=fragment-secret');
  });

  it('renders persisted manual positions without claiming address evidence or combining currencies', () => {
    const { view, data, portfolios } = fixture();
    data.update(state => ({ ...state, aggregation: null }));
    portfolios.update(all => [{ ...all[0], manualEntries: [{
      id: 'local-entry', name: 'Explicit local position', kind: 'asset', quantity: '9007199254740993.12345678',
      unitPrice: '0.00000003', quoteCurrency: 'USD', effectiveAt: '2026-09-06T00:00:00.000Z',
      authority: 'user', includedInCombined: false, tags: [],
    }] }]);
    view.detectChanges();
    const preview = view.nativeElement.querySelector('[aria-label="Manual report preview"]');
    expect(preview).not.toBeNull();
    expect(preview.textContent).toContain('User-entered');
    expect(preview.textContent).toContain('270\u202f215\u202f977.6422297937037034');
    expect(preview.textContent).toContain('separate');
    const download = [...view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>]
      .find(button => button.textContent?.trim() === 'Download CSV')!;
    expect(download.disabled).toBe(false);
    const share = [...view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>]
      .find(button => button.textContent?.trim() === 'Create encrypted link')!;
    expect(share.disabled).toBe(true);
  });

  it('keeps an uncertain upload retryable and refreshes saved shares', async () => {
    const { component, shares } = fixture();
    shares.create.mockRejectedValueOnce(new Error('offline'));
    await component.createShare();
    expect(component.shareMessage()).toContain('Pending uploads remain saved');
    expect(component.shareLink()).toBe('');
    await component.retryShare('pending-share');
    expect(shares.retry).toHaveBeenCalledWith('pending-share', 'owner-one');
    expect(shares.list).toHaveBeenCalledWith('owner-one');
    expect(component.shareLink()).toContain('#key=fragment-secret');
  });

  it('downloads exact separate manual rows, escaping user labels and preserving unpriced entries', async () => {
    const { view, data, portfolios } = fixture();
    data.update(state => ({ ...state, aggregation: null }));
    portfolios.update(all => [{ ...all[0], manualEntries: [
      { id: 'large', name: 'My "exact", lot', kind: 'asset', quantity: '9007199254740993.12345678', unitPrice: '0.00000003', quoteCurrency: 'USD', effectiveAt: '2026-09-06T00:00:00.000Z', authority: 'user', includedInCombined: false, tags: [] },
      { id: 'debt', name: 'Separate debt', kind: 'liability', quantity: '2.50', unitPrice: '4', quoteCurrency: 'EUR', effectiveAt: '2026-09-06T00:00:00.000Z', authority: 'user', includedInCombined: false, tags: [] },
      { id: 'unpriced', name: 'Unpriced lot', kind: 'asset', quantity: '0.00000001', effectiveAt: '2026-09-06T00:00:00.000Z', authority: 'user', includedInCombined: false, tags: [] },
    ] }]);
    view.detectChanges();
    let csv = '';
    vi.stubGlobal('Blob', class { constructor(parts: string[]) { csv = parts.join(''); } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:local-test'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const download = [...view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>].find(button => button.textContent?.trim() === 'Download CSV')!;
    download.click();
    expect(click).toHaveBeenCalledOnce();
    expect(csv).toContain('"My ""exact"", lot","","Not combined","270215977.6422297937037034","User-entered","asset","9007199254740993.12345678","0.00000003","USD","2026-09-06"');
    expect(csv).toContain('"Separate debt","","Not combined","10","User-entered","liability","2.50","4","EUR","2026-09-06"');
    expect(csv).toContain('"Unpriced lot","","Not combined","Unpriced","User-entered","asset","0.00000001","Not supplied","","2026-09-06"');
    expect(csv).not.toContain('Address-derived');
  });

  it.each(['privacy', 'percentages'])('redacts manual amounts for %s without inventing an allocation', mode => {
    const { view, component, portfolios, valuesHidden } = fixture();
    portfolios.update(all => [{ ...all[0], manualEntries: [{
      id: 'local', name: 'Explicit local lot', kind: 'asset', quantity: '7654321.01234', unitPrice: '8.12345', quoteCurrency: 'USD',
      effectiveAt: '2026-09-06T00:00:00.000Z', authority: 'user', includedInCombined: false, tags: [],
    }] }]);
    if (mode === 'privacy') { valuesHidden.set(true); } else { component.valueMode.set('percentages'); }
    view.detectChanges();
    expect(component.manualRows()[0]).toMatchObject({ quantity: 'Hidden', unitPrice: 'Hidden', value: 'Hidden', displayValue: 'Hidden' });
    const preview = view.nativeElement.querySelector('[aria-label="Manual report preview"]').textContent;
    expect(preview).not.toContain('7654321'); expect(preview).not.toContain('8.12345');
    expect(preview).not.toContain('%');
  });

  it.each(['=1+1', '+1+1', '-1+1', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1'])('exports manual label %j as spreadsheet text without changing its displayed name or exact quantity', name => {
    const { view, component, portfolios } = fixture();
    portfolios.update(all => [{ ...all[0], manualEntries: [{
      id: 'local', name, kind: 'asset', quantity: '9007199254740993.12345678', effectiveAt: '2026-09-06', authority: 'user', includedInCombined: false, tags: [],
    }] }]);
    view.detectChanges();
    let csv = '';
    vi.stubGlobal('Blob', class { constructor(parts: string[]) { csv = parts.join(''); } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:local-test'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    [...view.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>].find(button => button.textContent?.trim() === 'Download CSV')!.click();
    expect(csv).toContain('"\'' + name + '"');
    expect(csv).toContain('"9007199254740993.12345678"');
    expect(component.manualRows()[0].name).toBe(name);
  });

  it('does not retain manual rows after route reuse or vault projection clearing', () => {
    const { component, portfolios, routeParams } = fixture();
    portfolios.update(all => [{ ...all[0], manualEntries: [{
      id: 'local', name: 'First portfolio only', kind: 'asset', quantity: '1', effectiveAt: '2026-09-06', authority: 'user', includedInCombined: false, tags: [],
    }] }]);
    expect(component.manualRows()).toHaveLength(1);
    routeParams.next(convertToParamMap({ portfolioId: 'owner-two' }));
    expect(component.manualRows()).toEqual([]);
    routeParams.next(convertToParamMap({ portfolioId: 'owner-one' }));
    portfolios.set([]);
    expect(component.manualRows()).toEqual([]);
  });

  it('does not create from a loading snapshot and clears recipient links after revocation', async () => {
    const { component, data, shares } = fixture();
    data.update((state) => ({ ...state, loading: true }));
    await component.createShare();
    expect(shares.create).not.toHaveBeenCalled();
    component.shareLink.set('https://example.test/#key=secret');
    await component.revokeShare('share-id');
    expect(shares.revoke).toHaveBeenCalledWith('share-id', 'owner-one');
    expect(component.shareLink()).toBe('');
    expect(component.shareMessage()).toContain('Share revoked');
  });

  it('clears saved owner state when the vault is locked', async () => {
    const { component, shares } = fixture();
    component.shareLink.set('https://example.test/#key=secret');
    shares.unlocked.mockReturnValue(false);
    await component.refreshShares();
    expect(component.shareLink()).toBe('');
    expect(component.savedShares()).toEqual([]);
    expect(component.shareMessage()).toContain('Unlock');
  });

  it('clears a previous portfolio link and ignores its late response after route reuse', async () => {
    const { view, component, shares, routeParams } = fixture();
    let finish!: (link: string) => void;
    shares.link.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const pending = component.showShareLink('old-share');
    routeParams.next(convertToParamMap({ portfolioId: 'owner-two' }));
    view.detectChanges();
    finish('https://example.test/#key=old-owner-secret');
    await pending;
    expect(component.portfolioId()).toBe('owner-two');
    expect(component.shareLink()).toBe('');
    expect(shares.list).toHaveBeenCalledWith('owner-two');
  });
});
