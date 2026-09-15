import { Component,ChangeDetectionStrategy,ChangeDetectorRef,OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
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
 <div *ngIf="result" class="alert mt-3" [ngClass]="result.verified ? 'alert-success' : 'alert-danger'" role="status">
 <strong>{{ result.verified ? 'Signature verification passed' : 'Signature verification failed' }}</strong>
 <div *ngFor="let error of result.errors">{{ error }}</div>
 <div *ngIf="result.verified" class="small text-break">{{ result.announcement_id || result.attestation_id }}</div>
 <div *ngIf="result.conflict_state" class="small">Conflict evidence: {{ result.conflict_state }}</div>
 </div>
 </section>`})
export class DlcOracleVerifyComponent implements OnDestroy {
 announcementInput='';attestationInput='';busy=false;result:any=null;
 private generation=0;private request:Subscription|null=null;
 constructor(private api:DlcApiService,private cdr:ChangeDetectorRef){}
 edited():void{this.generation++;this.request?.unsubscribe();this.request=null;this.busy=false;this.result=null;}
 loadSample():void{this.edited();this.announcementInput=JSON.stringify(ORACLE_SAMPLE.announcement,null,2);const {announcement,...attestation}=ORACLE_SAMPLE.attestation;this.attestationInput=JSON.stringify(attestation,null,2);}
 verify(kind:'announcement'|'attestation'):void{
  this.edited();const generation=this.generation;this.busy=true;
  try{
   if(this.announcementInput.length>300000||this.attestationInput.length>150000)throw new Error('Oracle input exceeds the local limit.');
   const announcement=JSON.parse(this.announcementInput);
   let request;
   if(kind==='announcement')request=this.api.verifyAnnouncement$(announcement);
   else {const attestation=JSON.parse(this.attestationInput);if(!attestation||typeof attestation!=='object'||Array.isArray(attestation)||attestation.announcement!==undefined)throw new Error('Enter attestation fields only; the signed announcement is supplied separately above.');request=this.api.verifyAttestation$({...attestation,announcement});}
   this.request=request.subscribe({next:result=>{if(generation===this.generation){this.result=result;this.busy=false;this.cdr.markForCheck();}},error:err=>{if(generation===this.generation){this.result={verified:false,errors:[err.error?.error||'Oracle verification service failed.']};this.busy=false;this.cdr.markForCheck();}}});
  }catch(error){this.result={verified:false,errors:[error instanceof Error?error.message:'Malformed JSON.']};this.busy=false;}
 }
 ngOnDestroy():void{this.edited();}
}
