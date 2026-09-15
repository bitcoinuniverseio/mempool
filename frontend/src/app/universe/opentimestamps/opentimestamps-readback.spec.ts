// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject, of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { OpenTimestampsApiService } from './opentimestamps.service';
import { OpenTimestampsBatchesComponent } from './opentimestamps-batches.component';
import { OpenTimestampsOverviewComponent } from './opentimestamps-overview.component';
describe('timestamp readback rendering and lifecycle',()=>{
 beforeAll(()=>{for(const c of [OpenTimestampsBatchesComponent,OpenTimestampsOverviewComponent]) Object.defineProperty(c,'ctorParameters',{configurable:true,value:()=>[{type:OpenTimestampsApiService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});
 afterEach(()=>TestBed.resetTestingModule());
 it('renders incomplete anchor coverage and the actual header field label',()=>{
  const value={anchors:[{calendar_id:'calendar',block_height:1,block_hash:'ab'.repeat(32),merkle_root:'cd'.repeat(32),leaf_count:1,anchored_at:'2026-01-01'}],coverage:{record_limit:500,records_examined:500,complete:false}};
  TestBed.configureTestingModule({providers:[provideRouter([]),{provide:OpenTimestampsApiService,useValue:{getAnchorPage$:()=>of(value),watch:(request:()=>any)=>of({value,loading:false,error:null})}}]});
  const view=TestBed.createComponent(OpenTimestampsBatchesComponent);view.detectChanges();const text=view.nativeElement.textContent;
  expect(text).toContain('Partial coverage; counts are lower bounds.');expect(text).toContain('Bitcoin header Merkle root');
 });
 it('renders unknown current count separately from historical stored anchors',()=>{
  const value={bitcoin_confirmed_proofs:null,stored_anchored_proofs:501,active_chain_coverage:{record_limit:500,records_examined:500,complete:false},active_calendars:[],recent_anchors:[],network:'mainnet',calendars_configured:true};
  TestBed.configureTestingModule({providers:[provideRouter([]),{provide:OpenTimestampsApiService,useValue:{getOverview$:()=>of(value),watch:()=>of({value,loading:false,error:null})}}]});
  const view=TestBed.createComponent(OpenTimestampsOverviewComponent);view.detectChanges();expect(view.nativeElement.textContent).toContain('Unknown');expect(view.nativeElement.textContent).toContain('Historical stored anchors: 501');
 });
 it('clears the old result immediately on network switch and cancels on destroy',()=>{
  const networkChanged$=new Subject<string>();const state={network:'',networkChanged$,env:{ROOT_NETWORK:'mainnet'}};
  const responses:Subject<any>[]=[];
  const api=new OpenTimestampsApiService({get:()=>{const response=new Subject<any>();responses.push(response);return response;}} as unknown as HttpClient,state as unknown as StateService);
  const page=new OpenTimestampsBatchesComponent(api);page.ngOnInit();responses[0].next({anchors:[{block_height:1}],coverage:{complete:true}});expect(page.anchors).toHaveLength(1);
  state.network='signet';networkChanged$.next('signet');expect(page.anchors).toEqual([]);expect(page.loading).toBe(true);
  page.ngOnDestroy();responses[1].next({anchors:[{block_height:2}]});expect(page.anchors).toEqual([]);expect(responses[1].observed).toBe(false);
 });
});
