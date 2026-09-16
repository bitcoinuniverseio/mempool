import { Component,ChangeDetectionStrategy,ChangeDetectorRef,OnDestroy,OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription,distinctUntilChanged,startWith } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { looksLikeSecret } from '../workbench/psbt-inspect';
import { DlcApiService } from './dlc.service';
import { ORACLE_SAMPLE } from './oracle-verification-sample';
@Component({selector:'app-dlc-oracle-verify',standalone:true,imports:[CommonModule,FormsModule],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<section class="card p-4 my-4">
 <h2 class="h5">Verify Public Oracle Signatures</h2>
 <p class="small text-muted">Check a signed announcement and bind every attestation signature to its declared event, oracle, outcome and nonce. Public JSON is sent to the local backend. No private key is required. Registry availability is separate.</p>
 <p class="small text-muted">Declare protocol_revision as dlcspecs-tagged-v0 or rust-dlc-legacy-sha256. The verifier checks only that declared serialization and hash scheme. A valid signature authenticates an oracle statement; it does not establish its real-world truth or absence of conflicting statements.</p>
 <label for="dlc-announcement-json">Signed Announcement JSON</label>
 <textarea id="dlc-announcement-json" class="form-control font-monospace mb-3" rows="8" [(ngModel)]="announcementInput" (ngModelChange)="edited()" spellcheck="false"></textarea>
 <label for="dlc-attestation-json">Attestation JSON (uses the announcement above)</label>
 <textarea id="dlc-attestation-json" class="form-control font-monospace mb-3" rows="6" [(ngModel)]="attestationInput" (ngModelChange)="edited()" spellcheck="false"></textarea>
 <div class="d-flex flex-wrap gap-2"><button class="btn btn-primary" (click)="verify('announcement')" [disabled]="busy">Verify Announcement</button><button class="btn btn-primary" (click)="verify('attestation')" [disabled]="busy">Verify Attestation</button><button class="btn btn-outline-secondary" (click)="loadSample()">Load Signed Sample</button></div>
 <p *ngIf="busy" role="status" class="mt-3">Checking signature and event binding…</p>
 <p *ngIf="error" role="alert" class="alert alert-warning mt-3">{{ error }}</p>
 <div *ngIf="result" class="alert mt-3" [ngClass]="result.verified === true ? 'alert-success' : 'alert-danger'" role="status">
 <strong>{{ result.verified === true ? 'Signature verification passed' : 'Signature verification failed' }}</strong>
 <div *ngFor="let error of result.errors">{{ error }}</div>
 <div *ngIf="result.verified === true" class="small text-break">{{ result.announcement_id || result.attestation_id }}</div>
 <div *ngIf="result.conflict_state" class="small">Conflict evidence: {{ result.conflict_state }}</div>
 </div>
 </section>`})
export class DlcOracleVerifyComponent implements OnInit,OnDestroy {
 announcementInput='';attestationInput='';busy=false;result:any=null;error:string|null=null;
 private networkSubscription?:Subscription;
 private generation=0;private request:Subscription|null=null;
 constructor(private api:DlcApiService,private cdr:ChangeDetectorRef,private network:StateService){}
 ngOnInit():void{this.networkSubscription=this.network.networkChanged$.pipe(startWith(this.network.network),distinctUntilChanged()).subscribe(()=>this.edited());}
 edited():void{this.generation++;this.request?.unsubscribe();this.request=null;this.busy=false;this.result=null;this.error=null;this.cdr.markForCheck();}
 loadSample():void{this.edited();this.announcementInput=JSON.stringify(ORACLE_SAMPLE.announcement,null,2);const {announcement,...attestation}=ORACLE_SAMPLE.attestation;this.attestationInput=JSON.stringify(attestation,null,2);}
 verify(kind:'announcement'|'attestation'):void{
  this.edited();const generation=this.generation;this.busy=true;
  try{
   if(this.announcementInput.length>300000||this.attestationInput.length>150000)throw new Error('Oracle input exceeds the local limit.');
   const secret=looksLikeSecret(this.announcementInput)||looksLikeSecret(this.attestationInput);if(secret){this.announcementInput='';this.attestationInput='';throw new Error(secret);}
   const announcement=JSON.parse(this.announcementInput);
   let request;
   if(kind==='announcement')request=this.api.verifyAnnouncement$(announcement);
   else {const attestation=JSON.parse(this.attestationInput);if(!attestation||typeof attestation!=='object'||Array.isArray(attestation)||attestation.announcement!==undefined)throw new Error('Enter attestation fields only; the signed announcement is supplied separately above.');request=this.api.verifyAttestation$({...attestation,announcement});}
   this.request=request.subscribe({next:result=>{if(generation===this.generation){if(!result||typeof result.verified!=='boolean'||!Array.isArray(result.errors)||!result.errors.every((error:unknown)=>typeof error==='string')||result.verified===true&&result.errors.length){this.error='The oracle verifier returned incomplete evidence.';}else{this.result=result;}this.busy=false;this.cdr.markForCheck();}},error:err=>{if(generation===this.generation){this.error=typeof err.error?.error==='string'?err.error.error:'Oracle verification service unavailable.';this.busy=false;this.cdr.markForCheck();}}});
  }catch(error){this.error=error instanceof Error?error.message:'Malformed JSON.';this.busy=false;}
 }
 ngOnDestroy():void{this.edited();this.networkSubscription?.unsubscribe();}
}
