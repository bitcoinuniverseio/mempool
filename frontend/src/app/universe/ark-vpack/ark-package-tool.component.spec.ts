import { ArkExitComponent } from './ark-exit.component';
import { ArkExitSimulateComponent } from './ark-exit-simulate.component';
import { ArkVpackTranslateComponent } from './ark-vpack-translate.component';
import { provideRouter } from '@angular/router';
// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { StateService } from '@app/services/state.service';
import { Subject, of } from 'rxjs';
import { ArkPackageToolComponent } from './ark-package-tool.component';
describe('Ark package forms', () => {
  beforeAll(() => { Object.defineProperty(ArkPackageToolComponent, 'ctorParameters', { configurable: true, value: () => [{ type: HttpClient }, { type: StateService }, { type: ChangeDetectorRef }] }); TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
  afterEach(() => TestBed.resetTestingModule());
  function render(response: any) {
    const state = { network: 'signet', env: { ROOT_NETWORK: 'signet' }, networkChanged$: new Subject<string>() };
    let posted: any;
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StateService, useValue: state }, { provide: HttpClient, useValue: { post: (url: string, body: any) => { posted = { url, body }; return response; } } }] });
    const view = TestBed.createComponent(ArkPackageToolComponent); view.detectChanges(); return { view, state, posted: () => posted };
  }
  it('submits an actual package scenario and renders incomplete recovery explicitly', () => {
    const { view, posted } = render(of({ vtxo_id: '11'.repeat(32), anchor: { source: { network: 'signet' } }, protocol_verified: null, exit_viable: null, warnings: ['Missing leaf sweep'], verification_scope: 'Actual transaction bytes' }));
    view.componentInstance.operation = 'exit/plan'; view.componentInstance.input = '{"vpack_hex":"56504b"}'; view.componentInstance.run(); view.detectChanges();
    expect(posted().body).toEqual({ vpack_hex: '56504b', network: 'signet', target_feerate_sat_vb: 25 });
    expect(view.nativeElement.textContent).toContain('Missing leaf sweep'); expect(view.nativeElement.textContent).toContain('Exit viability: Not established');
  });
  it('cancels stale evidence on edits and destroy', () => {
    const response = new Subject<any>(); const { view } = render(response); view.componentInstance.input = '{}'; view.componentInstance.run();
    expect(response.observed).toBe(true); view.componentInstance.invalidate(); expect(response.observed).toBe(false);
    view.componentInstance.run(); view.destroy(); expect(response.observed).toBe(false);
  });
  it('binds the recovery destination to the request and rejects a response after it changes', () => {
    const response = new Subject<any>(); const { view, posted } = render(response);
    view.componentInstance.operation = 'exit/plan'; view.componentInstance.input = '{}';
    view.componentInstance.recoveryAddress = 'tb1qexample'; view.componentInstance.run();
    expect(posted().body.recovery_address).toBe('tb1qexample');
    view.componentInstance.recoveryAddress = 'tb1qchanged';
    response.next({ vtxo_id: '11'.repeat(32), anchor: { source: { network: 'signet' } }, protocol_verified: null, exit_viable: null });
    expect(view.componentInstance.result).toBeNull();
  });
  it('renders live package forms in planner, simulator and translator surfaces', () => {
    render(of({}));
    for (const component of [ArkExitComponent, ArkExitSimulateComponent, ArkVpackTranslateComponent]) {
      const view = TestBed.createComponent(component); view.detectChanges();
      expect(view.nativeElement.querySelector('app-ark-package-tool')).not.toBeNull();
      expect(view.nativeElement.textContent).not.toContain('512 Blocks (CSV)');
      expect(view.nativeElement.textContent).not.toContain('Round Anchor Spend');
      view.destroy();
    }
  });
});
