// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Subject } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { IntelligenceApiService } from './intelligence-api.service';
import { TransactionGraphComponent } from './transaction-graph.component';
import { checkedGraph, checkedPath } from './graph-evidence';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
const edge={source_id:a,target_id:b,value_sats:900,vout:0,edge_type:'output'};
const graph=()=>({root_entity:a,network:'signet',hops:2,direction:'both',nodes:[{id:a,type:'transaction',value_sats:null,status:'unknown',depth:0},{id:b,type:'transaction',value_sats:900,status:'confirmed',depth:1}],edges:[edge],total_nodes_count:2,truncated:true,truncation_reason:'address_page'});
const path=()=>({from_entity:a,to_entity:b,network:'signet',path_found:true,total_hops:1,total_value_transferred_sats:null,value_upper_bound_sats:900,transfer_scope:'Observed bottleneck upper bound; no traced or achievable transfer amount.',node_sequence:[a,b],edge_sequence:[edge],search_exhausted:false});
describe('graph evidence shape and identity',()=>{
 it('retains unknown node value/status and bounded address-page evidence',()=>{const result=checkedGraph(graph(),a,'signet',2,'both');expect(result.nodes[0].value_sats).toBeNull();expect(result.truncation_reason).toBe('address_page');});
 it.each([{network:'mainnet'},{root_entity:b},{total_nodes_count:0},{edges:[{...edge,target_id:c}]},{nodes:[{id:a,type:'transaction',value_sats:NaN,status:'confirmed',depth:0}]}])('rejects unbound graph %j',patch=>expect(()=>checkedGraph({...graph(),...patch},a,'signet',2,'both')).toThrow());
 it('validates continuity and upperbound while keeping exact transfer unknown',()=>{expect(checkedPath(path(),a,b,'signet').total_value_transferred_sats).toBeNull();});
 it.each([{value_upper_bound_sats:901},{total_value_transferred_sats:900},{node_sequence:[a,c,b]},{from_entity:b},{network:'mainnet'},{path_found:'true'},{edge_sequence:[{...edge,target_id:c}]}])('rejects unbound path %j',patch=>expect(()=>checkedPath({...path(),...patch},a,b,'signet')).toThrow());
 it('keeps budget-exhausted empty search distinct from a found path',()=>{const result=checkedPath({...path(),path_found:false,total_hops:0,value_upper_bound_sats:null,node_sequence:[],edge_sequence:[],search_exhausted:true},a,b,'signet');expect(result.path_found).toBe(false);expect(result.search_exhausted).toBe(true);});
});
function fixture(){const network={network:'signet',networkChanged$:new Subject<string>()},queries:Subject<any>[]=[],paths:Subject<any>[]=[];const api:any={queryGraph$:vi.fn(()=>{const read=new Subject();queries.push(read);return read;}),findShortestPath$:vi.fn(()=>{const read=new Subject();paths.push(read);return read;})};const page=new TransactionGraphComponent(api,{markForCheck:vi.fn()} as any,network as any);page.ngOnInit();page.rootEntity=a;page.pathFrom=a;page.pathTo=b;return{page,network,queries,paths,api};}
describe('graph query and path lifecycle',()=>{
 it('clears old query on edit/invalid input/newrequest and never restores it after source failure',()=>{const f=fixture();f.page.runQuery();f.queries[0].next(graph());expect(f.page.activeResult).toBeTruthy();f.page.edited();expect(f.page.activeResult).toBeNull();expect(f.queries[0].observed).toBe(false);f.page.runQuery();f.queries[1].error({status:503,error:{error:'Index unavailable'}});expect(f.page.queryError).toBe('Index unavailable');expect(f.page.activeResult).toBeNull();f.page.ngOnDestroy();});
 it('network and destroy cancel both operation requests',()=>{const f=fixture();f.page.runQuery();f.page.findPath();f.network.networkChanged$.next('regtest');expect(f.queries[0].observed).toBe(false);expect(f.paths[0].observed).toBe(false);f.page.runQuery();f.page.findPath();f.page.ngOnDestroy();expect(f.queries[1].observed).toBe(false);expect(f.paths[1].observed).toBe(false);expect(f.network.networkChanged$.observed).toBe(false);});
 it('validates path IDs before HTTP and clears success when either endpoint changes',()=>{const f=fixture();f.page.pathFrom='bad';f.page.findPath();expect(f.api.findShortestPath$).not.toHaveBeenCalled();f.page.pathFrom=a;f.page.findPath();f.paths[0].next(path());expect(f.page.pathResult).toBeTruthy();f.page.pathEdited();expect(f.page.pathResult).toBeNull();f.page.ngOnDestroy();});
});
describe('rendered graph evidence',()=>{
 beforeAll(()=>{Object.defineProperty(TransactionGraphComponent,'ctorParameters',{configurable:true,value:()=>[{type:IntelligenceApiService},{type:ChangeDetectorRef},{type:StateService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});afterEach(()=>TestBed.resetTestingModule());
 it('renders unknown node values, truncation and upperbound scope without value-transfer claim',()=>{const f=fixture();TestBed.configureTestingModule({providers:[{provide:IntelligenceApiService,useValue:f.api},{provide:StateService,useValue:f.network}]});const view=TestBed.createComponent(TransactionGraphComponent);view.detectChanges();view.componentInstance.rootEntity=a;view.componentInstance.runQuery();f.queries[0].next(graph());view.componentInstance.pathFrom=a;view.componentInstance.pathTo=b;view.componentInstance.findPath();f.paths[0].next(path());view.detectChanges();const text=view.nativeElement.textContent;expect(text).toContain('Unknown');expect(text).toContain('Completeness is not established');expect(text).toContain('Path value upper bound: 900 sats');expect(text).toContain('Exact funds transferred: Unknown');expect(text).not.toContain('Value Transferred');f.page.ngOnDestroy();});
});
