// @vitest-environment jsdom
import 'zone.js';
import { readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule,platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { afterEach,beforeAll,describe,expect,it } from 'vitest';
import { of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UtxoSetComponent } from './utxo-set.component';
import { UtxoEvidenceService } from './utxo-evidence.service';
import { checkedUtxoEvidence } from './utxo-evidence';
describe('Actual UTXO checkpoint template, controlled observations',()=>{
 beforeAll(()=>TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting()));
 afterEach(()=>TestBed.resetTestingModule());
 it('renders one satoshi, actual reported checkpoint and limited source disclosure',()=>{
  const response={network:'signet',total:1,checkpoints:[{network:'signet',blockHeight:1,blockHash:'cd'.repeat(32),muhashHex:'ab'.repeat(32),totalTxOuts:1,totalAmountSats:'1',bogoSize:'90',verifiedAtTimestamp:1791158400}]};
  const api={watch$:(path:string)=>{if(!path.endsWith('checkpoints'))return of({kind:'unavailable',value:null,message:'Controlled unavailable source.'});const checked=checkedUtxoEvidence(path,response,'signet');return of({kind:'available',value:checked.value,message:checked.disclosure});}};
  TestBed.configureTestingModule({providers:[provideRouter([]),{provide:StateService,useValue:{network:'',env:{ROOT_NETWORK:'signet'}}},{provide:SeoService,useValue:{setTitle(){}}},{provide:UtxoEvidenceService,useValue:api}]});
  TestBed.overrideComponent(UtxoSetComponent,{set:{template:readFileSync('src/app/universe/utxo-set/utxo-set.component.html','utf8'),styles:[],styleUrls:[]}});
  const fixture=TestBed.createComponent(UtxoSetComponent);fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('0.00000001');expect(fixture.nativeElement.textContent).toContain(response.checkpoints[0].blockHash);expect(fixture.nativeElement.textContent).toContain('Reported signet');expect(fixture.nativeElement.textContent).toContain('independent operator source profile has not been attested');fixture.destroy();
 });
});
