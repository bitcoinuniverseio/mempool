// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { BlockspaceApiService } from './blockspace.service';
import { BlockspaceOverviewComponent } from './blockspace-overview.component';
import { BlockspaceCompositionComponent } from './blockspace-composition.component';
import { BlockspaceTaxonomyComponent } from './blockspace-taxonomy.component';
const taxonomy = [{ class_id: 'class-simple-payment', name: 'Simple Payments', category: 'monetary', description: 'Observed shape', weight_share_percentage: null, fee_share_percentage: null, tx_count_24h: 1 }];
const composition = [{ block_height: 100, timestamp_utc: '2026-09-15T00:00:00Z', total_weight: null, total_fee_sats: null, monetary_weight: null, arbitrary_data_weight: null, consolidation_weight: null, layer2_weight: null }];
describe('rendered blockspace unknown evidence', () => {
 beforeAll(() => { for (const component of [BlockspaceOverviewComponent, BlockspaceCompositionComponent, BlockspaceTaxonomyComponent]) Object.defineProperty(component, 'ctorParameters', { configurable: true, value: () => [{ type: BlockspaceApiService }, { type: ChangeDetectorRef }] }); TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
 afterEach(() => TestBed.resetTestingModule());
 it.each([
  [BlockspaceOverviewComponent, { network: 'signet', current_regime: null, median_feerate_24h: null, taxonomy_classes: taxonomy, composition_timeseries: composition, window: { blocks: 1, from_height: 100, to_height: 100, covers_24h: null }, last_updated: '2026-09-15T00:00:00Z' }],
  [BlockspaceCompositionComponent, composition],
  [BlockspaceTaxonomyComponent, taxonomy],
 ] as const)('renders missing numeric fields as Unknown in %s', (component, data) => {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BlockspaceApiService, useValue: { watch: () => of({ kind: 'ready', data }), getOverview: () => of(data), getComposition: () => of(data), getTaxonomy: () => of(data) } }] });
  const view = TestBed.createComponent(component as any); view.detectChanges(); const text = view.nativeElement.textContent;
  expect(text).toContain('Unknown'); expect(text).not.toContain('NaN'); expect(text).not.toContain('Infinity'); expect(text).not.toContain('0.00000000 BTC');
  if(component === BlockspaceOverviewComponent) { expect(text).toContain('Median of Observed Block Medians'); expect(text).toContain('coverage is unknown'); }
 });
});
