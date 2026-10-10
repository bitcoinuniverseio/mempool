// @vitest-environment jsdom
import 'zone.js';
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, ɵresolveComponentResources } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ActivatedRoute, Router, RouterModule, provideRouter } from '@angular/router';
import { BehaviorSubject, NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RbfTree } from '@interfaces/node-api.interface';
import { RbfHistoryState, RBF_READ_TIMEOUT_MS } from '@app/services/rbf-history-state';
import { RbfList } from './rbf-list.component';
let history: RbfHistoryState;
const fragment = new BehaviorSubject('');
const networkChanges = new Subject<string>();
let network = 'signet';
const api = { getRbfList$: vi.fn<() => Observable<RbfTree[]>>() };
@Component({ standalone: true, imports: [CommonModule, RouterModule], schemas: [CUSTOM_ELEMENTS_SCHEMA], template: readFileSync('src/app/components/rbf-list/rbf-list.component.html', 'utf8') })
class RenderedRbfList extends RbfList {
  constructor() {
    super({ fragment } as ActivatedRoute, inject(Router), api as never,
      { get network() { return network; }, networkChanged$: networkChanges, rbfHistoryState: history, rbfHistoryAvailability$: history.availability$, rbfLatest$: new Subject<RbfTree[]>() } as never,
      { startTrackRbf: () => undefined, stopTrackRbf: () => undefined } as never, { setTitle: () => undefined, setDescription: () => undefined } as never, {} as never);
  }
}
describe('actual RBF list template/controller failure and recovery', () => {
  beforeAll(async () => { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); await ɵresolveComponentResources(url => Promise.resolve(url.endsWith('.html') ? readFileSync('src/app/components/rbf-list/rbf-list.component.html', 'utf8') : '')); });
  afterEach(() => { TestBed.resetTestingModule(); history.destroy(); vi.useRealTimers(); api.getRbfList$.mockReset(); fragment.next(''); network = 'signet'; });
  function render(response: Observable<RbfTree[]>): ComponentFixture<RenderedRbfList> { history = new RbfHistoryState(); api.getRbfList$.mockReturnValue(response); TestBed.configureTestingModule({ providers: [provideRouter([])] }); const fixture = TestBed.createComponent(RenderedRbfList); fixture.detectChanges(); return fixture; }
  it('renders typed503 unavailable with usable Retry, then renders real empty success', () => {
    const fixture = render(throwError(() => ({ status: 503, error: { error: 'rbf_history_unavailable' } })));
    expect(fixture.nativeElement.textContent).toContain('Replacement history is unavailable'); expect(fixture.nativeElement.textContent).not.toContain('No replacements are available'); expect(fixture.nativeElement.querySelector('.spinner-border')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mode-toggle button').getAttribute('aria-pressed')).toBe('true');
    api.getRbfList$.mockReturnValue(of([])); fixture.nativeElement.querySelector('[role=alert] button').click(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('No replacements are available'); expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull(); expect(api.getRbfList$).toHaveBeenCalledTimes(2);
  });
  it('bounds NEVER loading and hides the empty-success claim until a response', () => {
    vi.useFakeTimers(); const fixture = render(NEVER); expect(fixture.nativeElement.querySelector('.spinner-border')).not.toBeNull(); expect(fixture.nativeElement.textContent).not.toContain('No replacements are available'); vi.advanceTimersByTime(RBF_READ_TIMEOUT_MS); fixture.detectChanges(); expect(fixture.nativeElement.querySelector('.spinner-border')).toBeNull(); expect(fixture.nativeElement.textContent).toContain('Replacement history is unavailable');
  });
  it('clears rendered old rows on scope switch and performs one request across duplicate mode emissions', () => {
    const tree = { tx: { txid: 'a'.repeat(64), fee: 1, vsize: 100 }, time: 1, fullRbf: true, replaces: [] } as RbfTree;
    const fixture = render(of([tree])); expect(fixture.nativeElement.querySelectorAll('.tree')).toHaveLength(1); fragment.next(''); expect(api.getRbfList$).toHaveBeenCalledTimes(1); api.getRbfList$.mockReturnValue(NEVER); network = ''; history.reset(); networkChanges.next(''); fixture.detectChanges(); expect(fixture.nativeElement.querySelectorAll('.tree')).toHaveLength(0); expect(fixture.nativeElement.querySelector('.spinner-border')).not.toBeNull(); expect(api.getRbfList$).toHaveBeenCalledTimes(2);
  });
});
