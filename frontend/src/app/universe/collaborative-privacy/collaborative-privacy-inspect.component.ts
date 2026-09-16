import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { CollaborativePrivacyApiService } from './collaborative-privacy.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
@Component({selector:'app-collaborative-privacy-inspect',standalone:true,imports:[CommonModule,FormsModule,RouterModule,RelativeUrlPipe],template:`
<div class="container-xl py-4">
<h1>Inspect Collaborative Transaction</h1>
<a [routerLink]="'/privacy/collaborative' | relativeUrl">Back to Overview</a>
<p>Transaction entropy and ownership analysis require an analysis engine that is not connected. A public protocol package is a separate verification input; no anonymity or linkability result is inferred from a transaction identifier.</p>
<label>Transaction ID or Hex<input class="form-control" [(ngModel)]="txid" (ngModelChange)="clear()"></label>
<button class="btn btn-secondary" (click)="inspect()">Inspect Privacy Metrics</button>
<hr><h2>Verify public protocol package</h2>
<p>Supply public artifacts only. Never include wallet secrets, private keys or private credentials.</p>
<label>Public package JSON<textarea class="form-control" [(ngModel)]="packageText" (ngModelChange)="clear()" rows="8"></textarea></label>
<button class="btn btn-primary" (click)="verifyPackage()" [disabled]="inspecting">{{inspecting?'Checking package…':'Verify Public Package'}}</button>
<div class="alert alert-warning mt-3" role="alert" *ngIf="loadError">{{loadError}}</div>
</div>`})
export class CollaborativePrivacyInspectComponent implements OnInit, OnDestroy {
 txid=''; packageText=''; inspecting=false; analysisResult:any=null; loadError:string|null=null;
 private request?:Subscription; private networkSub?:Subscription;
 constructor(private api:CollaborativePrivacyApiService) {}
 ngOnInit():void {this.networkSub=this.api.networkChanged$.subscribe(()=>this.clear());}
 ngOnDestroy():void {this.networkSub?.unsubscribe();this.clear();this.packageText='';}
 clear():void {this.request?.unsubscribe();this.inspecting=false;this.analysisResult=null;this.loadError=null;}
 inspect():void {this.clear();this.loadError='Transaction entropy and ownership analysis are unavailable; no privacy metrics were computed.';}
 verifyPackage():void {
  this.clear(); let payload:any;
  try {if(this.packageText.length>262144) throw new Error();payload=JSON.parse(this.packageText);
   if(!payload || typeof payload!=='object' || Array.isArray(payload) || typeof payload.protocol!=='string' || !payload.protocol.trim() || payload.protocol.length>128) throw new Error();
  } catch {this.loadError='Enter a bounded public package JSON object with a protocol identifier.';return;}
  this.inspecting=true;
  this.request=this.api.verifyPublicPackage$(payload).subscribe({next:()=>{this.inspecting=false;this.loadError='No supported authenticated verification receipt was established.';},error:err=>{
   this.inspecting=false; this.loadError=err?.status===503?'Public package verifier unavailable; no conservation, anonymity or linkability claim was verified.':err?.status===400?'Public package input was rejected.':'Public package verification request failed; no verdict is available.';
  }});
 }
}
