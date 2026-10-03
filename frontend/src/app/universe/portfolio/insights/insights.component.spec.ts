// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { InsightsComponent } from './insights.component';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfoliosStore } from '../stores/portfolios.store';

describe('offered insight dismissal and restoration', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());

  it('keeps dismissed state visible with a reachable restore control in the actual template', () => {
    const aggregation = { holdings: [], byAccount: [], quoteCurrency: 'USD', pricedTotal: null, unpricedCount: 0,
      state: 'partial', unknownValueBucket: 'present', duplicateAddresses: ['test-owned-duplicate'], internalTransfers: [],
      externalInflowAtomic: null, externalOutflowAtomic: null };
    TestBed.configureTestingModule({ imports: [InsightsComponent], providers: [
      { provide: PortfolioDataService, useValue: { state: signal({ aggregation }) } },
      { provide: PortfoliosStore, useValue: {} },
    ] });
    const fixture = TestBed.createComponent(InsightsComponent);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('li') as HTMLLIElement;
    expect(row).not.toBeNull();
    const title = row.querySelector('h2')?.textContent;
    expect(row.querySelector('button')?.textContent).toContain('Dismiss');
    row.querySelector('button')?.click();
    fixture.detectChanges();
    expect(row.classList.contains('dismissed')).toBe(true);
    expect(row.textContent).toContain('Dismissed on this page');
    expect(row.querySelector('h2')?.textContent).toBe(title);
    expect(row.querySelector('button')?.textContent).toContain('Restore');
    row.querySelector('button')?.click();
    fixture.detectChanges();
    expect(row.classList.contains('dismissed')).toBe(false);
    expect(row.textContent).not.toContain('Dismissed on this page');
    expect(row.querySelector('button')?.textContent).toContain('Dismiss');
    expect(fixture.componentInstance.dismissed()).toEqual([]);
  });
  it('uses the actual completed observation and source contexts without fabricating backup absence', () => {
    const aggregation = {holdings:[],byAccount:[],quoteCurrency:'USD',pricedTotal:null,unpricedCount:0,state:'partial',unknownValueBucket:'present',duplicateAddresses:[],internalTransfers:[],externalInflowAtomic:null,externalOutflowAtomic:null};
    TestBed.configureTestingModule({imports:[InsightsComponent], providers:[
      {provide:PortfolioDataService,useValue:{state:signal({aggregation,loading:false,completedAt:'2026-10-04T00:00:00Z'}),sourceStates:signal([{authorityId:'owned-index',context:'bitcoin:signet',state:'unavailable'}])}},
      {provide:PortfoliosStore,useValue:{}},
    ]});
    const fixture=TestBed.createComponent(InsightsComponent); fixture.detectChanges();
    const insights=fixture.componentInstance.insights();
    expect(insights).toHaveLength(1); expect(insights[0]).toMatchObject({ruleId:'sources.degraded',createdAt:'2026-10-04T00:00:00Z',evidenceRefs:['authority:bitcoin:signet:owned-index']});
    expect(fixture.nativeElement.textContent).not.toContain('No encrypted backup exists');
    expect(fixture.nativeElement.textContent).toContain('backup history');
  });
});
