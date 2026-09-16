import { Component, OnInit, OnDestroy, Inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { ReservesApiService, VerificationResult } from './reserves.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
@Component({selector:'app-reserves-verify',standalone:true,imports:[CommonModule,FormsModule,RouterModule,RelativeUrlPipe],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<section class="container-xl py-4"><h1>Verify reserves and liability evidence</h1>
 <nav class="nav gap-3 mb-4"><a [routerLink]="'/intelligence/reserves' | relativeUrl">Overview</a><a [routerLink]="'/intelligence/reserves/providers' | relativeUrl">Providers directory</a></nav>
 <p>Verification runs on this backend. Liability inclusion, provider root authentication and reserve ownership are separate checks. None proves complete liabilities or solvency.</p>
 <label for="proof-type">Proof type</label><select id="proof-type" class="form-select mb-3" [ngModel]="proofType" (ngModelChange)="setProofType($event)"><option value="bip127">BIP127 signed transaction</option><option value="merkle">Committed liability inclusion</option></select>
 <p *ngIf="proofType === 'bip127'">Supply expected_message and a finalized transaction_hex. Current support: native P2WPKH inputs with SIGHASH_ALL, checked against confirmed unspent outputs on the owned node. No transaction is broadcast.</p>
 <p *ngIf="proofType === 'merkle'">Scheme: universe-liability-sha256-v1. Supply leaf account_id, hex nonce and liability_sats, root, sibling path and index. Optional signed attestation is checked against operator-pinned Ed25519 keys. This scheme is not a Merkle-sum tree.</p>
 <label for="proof-json">Proof JSON</label><textarea id="proof-json" rows="14" class="form-control font-monospace mb-3" [ngModel]="proofJson" (ngModelChange)="editProof($event)"></textarea>
 <button class="btn btn-primary me-2" [disabled]="verifying" (click)="verify()">{{ verifying ? 'Verifying…' : 'Verify evidence' }}</button><button class="btn btn-outline-secondary" (click)="loadSample()">{{ proofType === 'merkle' ? 'Load unsigned inclusion example' : 'Load transaction template' }}</button>
 <p *ngIf="error" role="alert" class="text-danger mt-3">{{ error }}</p>
 <article *ngIf="result" class="card p-3 mt-4"><h2 class="h5">{{ result.verified ? 'Scoped evidence verified' : result.inclusion_verified ? 'Inclusion matches; provider root not authenticated' : 'Evidence not verified' }}</h2>
 <p>{{ result.scope }}</p><dl><dt>Authenticated amount within stated scope</dt><dd>{{ result.total_verified_sats }} sats</dd><dt>Verified items</dt><dd>{{ result.verified_items_count }}</dd>
 <ng-container *ngIf="result.proof_type === 'merkle_inclusion'"><dt>Mathematical inclusion</dt><dd>{{ result.inclusion_verified ? 'Valid' : 'Invalid' }}</dd><dt>Amount committed by included leaf</dt><dd>{{ result.included_liability_sats ?? 0 }} sats (root trust checked separately)</dd><dt>Authenticated provider root</dt><dd>{{ result.authenticated_root ? 'Authenticated with pinned provider key' : 'Not authenticated' }}</dd></ng-container><dt>Solvency</dt><dd>Not established</dd></dl>
 <p *ngFor="let message of result.errors" class="text-danger">{{ message }}</p><p *ngFor="let warning of result.warnings" class="text-warning">{{ warning }}</p><code class="text-break">{{ result.attestation_digest }}</code></article></section>`})
export class ReservesVerifyComponent implements OnInit,OnDestroy {
 proofType:'bip127'|'merkle'='bip127'; proofJson=''; verifying=false; result:VerificationResult|null=null; error:string|null=null;
 private revision=0; private pending?:Subscription; private network?:Subscription;
 constructor(@Inject(ReservesApiService) private api:ReservesApiService,@Inject(ChangeDetectorRef) private cd:ChangeDetectorRef,@Inject(StateService) private state:StateService){}
 ngOnInit():void{this.network=this.state.networkChanged$.subscribe(()=>this.clear());this.loadSample();}
 ngOnDestroy():void{this.clear();this.network?.unsubscribe();}
 clear():void{this.revision++;this.pending?.unsubscribe();this.result=null;this.error=null;this.verifying=false;this.cd.markForCheck();}
 editProof(value:string):void{this.clear();this.proofJson=value;}
 setProofType(type:'bip127'|'merkle'):void{this.clear();this.proofType=type;this.loadSample();}
 loadSample():void{this.clear();this.proofJson=JSON.stringify(this.proofType==='bip127'?{expected_message:'Your provider and attestation date',transaction_hex:''}:{scheme:'universe-liability-sha256-v1',leaf:{account_id:'example-account',nonce:'00'.repeat(16),liability_sats:1000},merkle_root:'4722cfd8a94ac803d74c18b00d4e9903269db7ec3234ab859bdf49ca0a948faf',path:[],index:0},null,2);}
 verify():void{this.clear();let proof:any;try{proof=JSON.parse(this.proofJson);}catch{this.error='Proof must be valid JSON.';return;}const revision=this.revision;this.verifying=true;
 this.pending=this.api.verifyProof(this.proofType==='bip127'?{proof_type:'bip127',bip127_proof:proof}:{proof_type:'merkle_inclusion',merkle_proof:proof}).subscribe({next:value=>{if(revision!==this.revision)return;this.result=value;this.verifying=false;this.cd.markForCheck();},error:error=>{if(revision!==this.revision)return;this.error=error?.error?.error||'Verification request failed.';this.verifying=false;this.cd.markForCheck();}});}
}
