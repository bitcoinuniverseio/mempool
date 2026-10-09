// @vitest-environment jsdom
import 'zone.js';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ɵresolveComponentResources } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { BehaviorSubject, of } from 'rxjs';
import { readFileSync } from 'node:fs';
import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { InscriptionComponent } from './inscription.component';
const native=JSON.parse(readFileSync('src/app/universe/inscription/names-explorer-asset.paired-fixture.json','utf8'));
const names=new BehaviorSubject<any>({schemaVersion:'universe-names-explorer-asset-v1',chain:'bitcoin',network:'mainnet',authorityId:'index-names',status:'unconfigured',value:null});
@Component({standalone:true,imports:[CommonModule,RouterModule],schemas:[CUSTOM_ELEMENTS_SCHEMA],template:readFileSync('src/app/universe/inscription/inscription.component.html','utf8')})
class ActualInscriptionTemplate extends InscriptionComponent {
 constructor(){super({paramMap:of(convertToParamMap({reference:native.assetId})),queryParamMap:of(convertToParamMap({protocol:'names'}))} as any,{network:'mainnet',selectedNetwork$:()=>of('mainnet'),getInscription$:()=>of({status:'unconfigured',value:null}),getNamesObject$:()=>names} as any,{recordVisit:()=>undefined} as any,{setTitle:()=>undefined} as any);}
}
describe('actual existing inscription template Names section',()=>{
 beforeAll(async()=>{TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());await ɵresolveComponentResources(url=>Promise.resolve(url.endsWith('.html')?readFileSync('src/app/universe/inscription/inscription.component.html','utf8'):''));});
 afterEach(()=>{TestBed.resetTestingModule();vi.useRealTimers();});
 it('unconfigured Names has no borrowed owner; qualified namespace reads render independent dated proof and no privileges',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(native.observedAt));TestBed.configureTestingModule({imports:[ActualInscriptionTemplate]});const fixture=TestBed.createComponent(ActualInscriptionTemplate);fixture.detectChanges();let text=fixture.nativeElement.textContent;
 expect(text).toContain('Names details are not configured');expect(text).not.toContain(native.ownership.owner);
 names.next({schemaVersion:'universe-names-explorer-asset-v1',chain:'bitcoin',network:'mainnet',authorityId:'index-names',status:'served',value:native});fixture.detectChanges();text=fixture.nativeElement.textContent;
 expect(text).toContain(native.ownership.owner);expect(text).toContain('sats');expect(text).toContain('no special permission');expect(text).toContain('Complete SNS membership has not been verified');
 vi.advanceTimersByTime(30001);fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Names observation is stale');expect(fixture.nativeElement.textContent).not.toContain(native.ownership.owner);
 fixture.destroy();
 });
});
