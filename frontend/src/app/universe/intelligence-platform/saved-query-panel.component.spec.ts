// @vitest-environment jsdom
import 'zone.js';
import { describe,it,expect,vi,beforeAll,afterEach } from 'vitest';
import { Subject,BehaviorSubject,of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule,platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { IntelligenceApiService } from './intelligence-api.service';
import { OwnerKeyService } from './owner-key.service';
import { StateService } from '@app/services/state.service';
import { SavedQueryPanelComponent } from './saved-query-panel.component';
const row=(n:number)=>({query_id:'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0'),title:'Saved'+n,sql:'SELECT '+n});
function setup(){const answers:Subject<any>[]=[];const api:any={getSavedQueryPage$:vi.fn(()=>{const s=new Subject<any>();answers.push(s);return s;}),saveQuery$:vi.fn(()=>{const s=new Subject<any>();answers.push(s);return s;})};const state:any={networkChanged$:new Subject<string>()},owner:any={key:'test-owner',key$:new BehaviorSubject('test-owner')};const panel=new SavedQueryPanelComponent(api,state,owner,{markForCheck:()=>{}} as ChangeDetectorRef);panel.ngOnInit();return {panel,api,state,owner,answers};}
describe('saved query ownership and pagination',()=>{
 it('uses the returned cursor and appends the next page without executing SQL',()=>{const {panel,api,answers}=setup();panel.read();answers[0].next({saved_queries:[row(2)],next_cursor:row(2).query_id,complete:false});panel.read(true);expect(api.getSavedQueryPage$).toHaveBeenLastCalledWith(row(2).query_id);answers[1].next({saved_queries:[row(1)],next_cursor:null,complete:true});expect(panel.rows).toEqual([row(2),row(1)]);expect(panel.complete).toBe(true);});
 it('clears rows and cancels old context responses on owner/network change and destroy',()=>{const {panel,owner,state,answers}=setup();panel.read();answers[0].next({saved_queries:[row(1)],next_cursor:null,complete:true});owner.key$.next('other');expect(panel.rows).toEqual([]);expect(answers[0].observed).toBe(false);panel.read();state.networkChanged$.next('signet');expect(answers[1].observed).toBe(false);panel.read();panel.ngOnDestroy();expect(answers[2].observed).toBe(false);});
 it('binds successful storage to exact SQL and title, and rejects substituted results',()=>{const {panel,answers}=setup();panel.sql='SELECT 1';panel.title='One';panel.save();answers[0].next({...row(1),title:'One',sql:'SELECT 2'});expect(panel.error).toContain('does not match');expect(panel.notice).toBeNull();panel.save();panel.sql='SELECT 3';panel.ngOnChanges();expect(answers[1].observed).toBe(false);});
});
describe('saved-query page controls',()=>{
 beforeAll(()=>{Object.defineProperty(SavedQueryPanelComponent,'ctorParameters',{configurable:true,value:()=>[{type:IntelligenceApiService},{type:StateService},{type:OwnerKeyService},{type:ChangeDetectorRef}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});afterEach(()=>TestBed.resetTestingModule());
 it('renders pagination and storage disclosure',()=>{TestBed.configureTestingModule({providers:[{provide:IntelligenceApiService,useValue:{}},{provide:StateService,useValue:{}},{provide:OwnerKeyService,useValue:{key:'test',key$:of('test')}}]});const view=TestBed.createComponent(SavedQueryPanelComponent);view.detectChanges();view.componentInstance.cursor=row(1).query_id;view.detectChanges();expect(view.nativeElement.textContent).toContain('Load more saved queries');expect(view.nativeElement.textContent).toContain('Saving and loading do not execute SQL');});
});
import { QueryStudioComponent } from './query-studio.component';
describe('query execution lifecycle',()=>{
 it('clears prior results on edits, owner changes and failures without executing a sample',()=>{
  const calls:Subject<any>[]=[];const api:any={getQuerySchema$:()=>of({tables:[]}),executeDevQuery$:vi.fn(()=>{const s=new Subject<any>();calls.push(s);return s;})};const owner:any={key$:new BehaviorSubject('first')},state:any={networkChanged$:new Subject<string>()};
  const page=new QueryStudioComponent(api,{markForCheck:()=>{}} as ChangeDetectorRef,state,owner);page.ngOnInit();page.loadSampleQuery();expect(api.executeDevQuery$).not.toHaveBeenCalled();page.executeQuery();calls[0].next({rows:[{value:1}]});expect(page.queryResult).not.toBeNull();page.invalidate();expect(page.queryResult).toBeNull();page.executeQuery();owner.key$.next('second');expect(calls[1].observed).toBe(false);expect(page.queryResult).toBeNull();page.executeQuery();calls[2].error(new Error('unavailable'));expect(page.queryResult).toBeNull();expect(page.queryError).toBeTruthy();page.ngOnDestroy();
 });
});
