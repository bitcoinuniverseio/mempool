// @vitest-environment jsdom
import 'zone.js';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { IntelligenceApiService } from './intelligence-api.service';
import { KnowledgeRegistryComponent } from './knowledge-registry.component';
const at='2026-10-04T12:00:00.000Z';
function response(reference='https://example.test/disclosure'):any {
  return {schema:'universe-knowledge-labels-v1',network:'signet',count:1,labels:[{label_id:'controlled',entity_type:'entity',entity_id:'controlled-entity',name:'Controlled provisional label',category:'custodian',confidence_level:1,confidence_score:0.5,status:'provisional',source:'submitted',created_at:at,updated_at:at,evidence:[{evidence_type:'public_disclosure',reference_uri:reference,description:'Unverified controlled reference',verified_at_utc:null}]}]};
}
describe('Knowledge Registry actual template, controlled evidence only',()=>{
  beforeAll(()=>{Object.defineProperty(KnowledgeRegistryComponent,'ctorParameters',{configurable:true,value:()=>[{type:IntelligenceApiService},{type:ChangeDetectorRef},{type:StateService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});
  afterEach(()=>TestBed.resetTestingModule());
  function render(reference?:string,failure=false){
    const state:any={network:'',env:{ROOT_NETWORK:'signet'},networkChanged$:new Subject<string>()};
    TestBed.configureTestingModule({providers:[{provide:IntelligenceApiService,useValue:{getKnowledgeLabels$:()=>of(response(reference)),getKnowledgeAuditLog$:()=>failure?throwError(()=>new Error('controlled source failure')):of({schema:'universe-knowledge-audit-v1',network:'signet',count:0,audit_events:[]})}},{provide:StateService,useValue:state}]});
    const fixture=TestBed.createComponent(KnowledgeRegistryComponent);fixture.detectChanges();return fixture;
  }
  it('opens actual reference_uri citation and preserves provisional/ownership disclosure',()=>{
    const fixture=render();const element=fixture.nativeElement as HTMLElement;
    const evidenceButton=Array.from(element.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Evidence');expect(evidenceButton).toBeTruthy();evidenceButton!.click();fixture.detectChanges();
    const link=element.querySelector('a[href="https://example.test/disclosure"]');expect(link?.getAttribute('rel')).toContain('noopener');
    expect(element.textContent).toContain('PROVISIONAL');expect(element.textContent).toContain('does not establish address ownership');
    expect(element.textContent).toContain('No audit entries returned for this network.');
  });
  it('renders non-web references as inert text',()=>{
    const fixture=render('urn:controlled:proof');
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(b=>b.textContent?.trim()==='Evidence')!.click();fixture.detectChanges();
    const element=fixture.nativeElement as HTMLElement;expect(element.textContent).toContain('urn:controlled:proof');expect(element.querySelector('a[href^="urn:"]')).toBeNull();
  });
  it('exposes audit failure and retry while retaining successful labels',()=>{
    const fixture=render(undefined,true);const element=fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('audit trail is unavailable');expect(element.textContent).toContain('Controlled provisional label');
    expect(Array.from(element.querySelectorAll('button')).some(b=>b.textContent?.includes('Retry knowledge reads'))).toBe(true);
    expect(element.textContent).not.toContain('No audit entries returned for this network.');
  });
});
