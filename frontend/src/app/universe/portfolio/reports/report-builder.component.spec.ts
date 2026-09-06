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
  afterEach(() => TestBed.resetTestingModule());

  function fixture() {
    const completedAt = '2026-09-05T12:00:00.000Z';
    const aggregation = {
      pricedTotal: '1', holdings: [{ assetKey: 'bitcoin:mainnet:BTC', displayName: 'BTC', pricedValue: '0.10', locations: [{ address: 'private-address-one' }] }],
    } as unknown as AggregationResult;
    const data = signal<PortfolioDataState>({ loading: false, accounts: [], completedAt, aggregation });
    const routeParams = new BehaviorSubject(convertToParamMap({ portfolioId: 'owner-one' }));
    const shares = {
      unlocked: vi.fn(() => true), list: vi.fn(async () => []), create: vi.fn(async () => 'share-id'),
      link: vi.fn(async () => 'https://example.test/portfolio/share/share-id#key=fragment-secret'),
      retry: vi.fn(async () => undefined), revoke: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: ActivatedRoute, useValue: { pathFromRoot: [{ paramMap: routeParams }] } },
      { provide: PortfolioDataService, useValue: { state: data } },
      { provide: PortfolioSessionService, useValue: { valuesHidden: signal(false) } },
      { provide: PortfolioShareService, useValue: shares },
    ] });
    const view = TestBed.createComponent(ReportBuilderComponent);
    view.detectChanges();
    return { view, component: view.componentInstance, data, shares, completedAt, routeParams };
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
