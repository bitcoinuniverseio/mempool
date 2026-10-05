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
describe('Actual UTXO checkpoint template, controlled observations',()=>{
 beforeAll(()=>TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting()));
 afterEach(()=>TestBed.resetTestingModule());
 it('renders one satoshi exactly and retains the unbound source disclosure',()=>{
  const api={watch$:(path:string)=>of(path.endsWith('checkpoints')?{kind:'available',value:{checkpoints:[{blockHeight:1,muhashHex:'ab'.repeat(32),totalTxOuts:1,totalAmountSats:'1',bogoSize:'90'}]},message:'This response has no selected-network source binding.'}:{kind:'unavailable',value:null,message:'Controlled unavailable source.'})};
  TestBed.configureTestingModule({providers:[provideRouter([]),{provide:StateService,useValue:{network:'',env:{ROOT_NETWORK:'signet'}}},{provide:SeoService,useValue:{setTitle(){}}},{provide:UtxoEvidenceService,useValue:api}]});
  TestBed.overrideComponent(UtxoSetComponent,{set:{template:readFileSync('src/app/universe/utxo-set/utxo-set.component.html','utf8'),styles:[],styleUrls:[]}});
  const fixture=TestBed.createComponent(UtxoSetComponent);fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('0.00000001');expect(fixture.nativeElement.textContent).toContain('no selected-network source binding');fixture.destroy();
 });
});
