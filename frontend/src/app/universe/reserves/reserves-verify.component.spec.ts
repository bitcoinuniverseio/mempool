import { ChangeDetectorRef,provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { describe,it,expect,vi } from 'vitest';
import { StateService } from '@app/services/state.service';
import { ReservesVerifyComponent } from './reserves-verify.component';
import { ReservesApiService } from './reserves.service';
describe('reserves verifier evidence ownership',()=>{
 it('submits committed values unchanged and discards stale edit/network responses',()=>{
  const pending=new Subject<any>(),network=new Subject<string>();const api={verifyProof:vi.fn(()=>pending)};const c=new ReservesVerifyComponent(api as any,{markForCheck:vi.fn()} as unknown as ChangeDetectorRef,{networkChanged$:network} as any);c.ngOnInit();c.setProofType('merkle');c.verify();expect(api.verifyProof.mock.calls[0][0].merkle_proof.leaf.liability_sats).toBe(1000);expect(api.verifyProof.mock.calls[0][0].merkle_proof).not.toHaveProperty('expected_liability_sats');c.editProof('{}');pending.next({verified:true});expect(c.result).toBeNull();c.loadSample();c.verify();network.next('signet');pending.next({verified:true});expect(c.result).toBeNull();expect(c.verifying).toBe(false);c.ngOnDestroy();
 });
 it('routes requests to the selected network without a hardcoded local backend',()=>{
  const network=new Subject<string>();const http={post:vi.fn()};const api=new ReservesApiService(http as any,{isBrowser:true,network:'signet',env:{ROOT_NETWORK:'mainnet'},networkChanged$:network} as any);
  api.verifyProof({proof_type:'merkle_inclusion'});expect(http.post.mock.calls[0][0]).toBe('/signet/api/v1/intelligence/reserves/verify');network.next('mainnet');api.verifyProof({proof_type:'merkle_inclusion'});expect(http.post.mock.calls[1][0]).toBe('/api/v1/intelligence/reserves/verify');
 });
 it('renders mathematical inclusion without implying provider authentication or solvency',async()=>{
  const html=await renderApplication(async context=>{const app=await bootstrapApplication(ReservesVerifyComponent,{providers:[provideZonelessChangeDetection(),provideRouter([]),{provide:ReservesApiService,useValue:{}},{provide:StateService,useValue:{networkChanged$:new Subject<string>(),network:'',env:{ROOT_NETWORK:'mainnet',BASE_MODULE:'mempool'}}}]},context);const c=app.components[0].instance as ReservesVerifyComponent;c.result={proof_type:'merkle_inclusion',verified:false,inclusion_verified:true,authenticated_root:false,solvency_verified:false,total_verified_sats:0,verified_items_count:0,included_liability_sats:1000,errors:[],warnings:['Root is not pinned'],scope:'Inclusion only',attestation_digest:'abc',evaluated_at:''};app.components[0].changeDetectorRef.detectChanges();return app;},{document:'<html><body><app-reserves-verify></app-reserves-verify></body></html>',url:'http://localhost/',allowedHosts:['localhost']});expect(html).toContain('provider root not authenticated');expect(html).toContain('Not established');expect(html).toContain('Root is not pinned');expect(html).not.toContain('All signatures');
 });
});
