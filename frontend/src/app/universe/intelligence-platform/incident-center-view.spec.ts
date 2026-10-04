// @vitest-environment jsdom
import 'zone.js';
import { createHash } from 'node:crypto';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { IntelligenceApiService } from './intelligence-api.service';
import { IncidentCenterComponent } from './incident-center.component';
function response():any {
  const at='2026-10-04T12:00:00.000Z';
  const profile={schema:'universe-incident-profile-v1',network:'signet',stale_after_seconds:30,sources:[{source_id:'controlled-core',independence_id:'controlled-host',implementation:'bitcoin-core',source_revision:null,
    binary_sha256:'1'.repeat(64),configuration_sha256:'2'.repeat(64),genesis_hash:'3'.repeat(64),block_one_hash:'4'.repeat(64),signet_challenge:'51'}]};
  profile.sources.push({...profile.sources[0],source_id:'controlled-two',independence_id:'controlled-two-host'});
  return {schema:'universe-incident-observations-v1',network:'signet',profile,profile_sha256:createHash('sha256').update(JSON.stringify(profile)).digest('hex'),observed_at_utc:at,
    incidents:[{incident_id:'b'.repeat(64),incident_type:'node_tip_divergence',title:'Controlled node-tip fixture',block_height:2,block_hash:'a'.repeat(64),detected_at_utc:at,resolved_at_utc:null,duration_seconds:null,
      reorg_depth:null,displaced_tx_count:null,double_spend_attempts_count:null,status:'investigating',summary:'Controlled fixture only',technical_postmortem:'',source_ids:['controlled-core','controlled-two'],
      evidence:{before:[{height:2,hash:'c'.repeat(64),parent:'4'.repeat(64),timestamp:1}],after:[{height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1}],common_ancestor:null},timeline:[{observed_at_utc:at,stage:'detected',source_ids:['controlled-core']}]}],count:1,
    sources:[{source_id:'controlled-core',status:'observed',checkpoint:{height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1},observed_at_utc:at},{source_id:'controlled-two',status:'observed',checkpoint:{height:2,hash:'c'.repeat(64),parent:'4'.repeat(64),timestamp:1},observed_at_utc:at}],
    coverage:{started_at_utc:at,last_observed_at_utc:at,retained_header_limit:128,retained_incident_limit:256,observation_count:1,gaps:[{at_utc:at,reason:'restart'}],complete_monitoring:false,global_consensus_verified:false,
      invalid_block_validation:'unavailable',consensus_validation:'unavailable',displaced_transactions:'unmeasured',double_spend_attempts:'unmeasured'}};
}
describe('Incident Center actual template with controlled observations',()=>{
  beforeAll(()=>{Object.defineProperty(IncidentCenterComponent,'ctorParameters',{configurable:true,value:()=>[{type:IntelligenceApiService},{type:ChangeDetectorRef},{type:StateService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});
  afterEach(()=>TestBed.resetTestingModule());
  function render(failure=false){const state:any={network:'',env:{ROOT_NETWORK:'signet'},networkChanged$:new Subject<string>()};
    const getIncidents$=vi.fn(()=>failure?throwError(()=>({status:503})):of(response()));
    TestBed.configureTestingModule({providers:[{provide:IntelligenceApiService,useValue:{getIncidents$}},{provide:StateService,useValue:state}]});
    const fixture=TestBed.createComponent(IncidentCenterComponent);fixture.detectChanges();return {fixture,state,getIncidents$};}
  it('renders source identities, checkpoint and restart gap without claiming consensus validation',()=>{
    const {fixture}=render();const text=fixture.nativeElement.textContent;
    expect(text).toContain('Reported source profile');expect(text).toContain('Profile SHA256');expect(text).toContain('Checkpoint 2');expect(text).toContain('restart');
    expect(text).toContain('node_tip_divergence');expect(text).toContain('not a consensus-validation verdict');expect(text).toContain('Unresolved / not measured');expect(text).toContain('Unmeasured');
    expect(text).not.toContain('Consensus Rules Aligned');expect(text).not.toContain('Source identity and monitoring coverage are not reported');
  });
  it('renders unavailable source with an actionable retry without projecting empty records',()=>{
    const {fixture,getIncidents$}=render(true);const element=fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toBeTruthy();expect(element.textContent).not.toContain('No incident records returned');
    element.querySelector('button')!.click();fixture.detectChanges();expect(getIncidents$).toHaveBeenCalledTimes(2);
  });
});
