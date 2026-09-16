import { Component, Inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { LightningResilienceApiService } from './lightning-resilience.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
@Component({selector:'app-lightning-resilience-mitigations',standalone:true,imports:[CommonModule,RouterModule,RelativeUrlPipe],template:`<div class="container-xl py-4"><h1 class="h2">Lightning Mitigation References</h1><nav class="d-flex flex-wrap gap-3 mb-4" aria-label="Lightning resilience"><a [routerLink]="'/lightning/resilience' | relativeUrl">Overview</a><a [routerLink]="'/lightning/resilience/htlcs' | relativeUrl">HTLC slots</a><a [routerLink]="'/lightning/resilience/onion-messages' | relativeUrl">Onion queues</a><a [routerLink]="'/lightning/resilience/simulate' | relativeUrl">Simulator</a><a [routerLink]="'/lightning/resilience/mitigations' | relativeUrl">Mitigations</a></nav><p *ngIf="loading" role="status">Loading owned evidence…</p><p *ngIf="loadError" role="alert" class="alert alert-warning">{{ loadError }}</p><p>Reference concepts only. Deployment, implementation support, reputation policies and defensive effectiveness are not observed.</p><div class="table-responsive"><table class="table"><thead><tr><th>Capability</th><th>Category</th><th>Observed deployment</th><th>Reference</th></tr></thead><tbody><tr *ngFor="let m of mitigations"><td>{{ m.name }}</td><td>{{ m.category }}</td><td>{{ m.status }}</td><td><a [href]="m.specification_url" target="_blank" rel="noopener noreferrer">Specification / project</a></td></tr></tbody></table></div><p>Reputation and fast-lane guarantees remain unverified. The simulator can apply an explicit immediate slot quota as a counterfactual; it does not establish deployed protection.</p></div>`})
export class LightningResilienceMitigationsComponent implements OnInit,OnDestroy {
 mitigations:any=[];loadError:string|null=null;loading=false;private subscription?:Subscription;
 constructor(@Inject(LightningResilienceApiService) private api:LightningResilienceApiService,@Inject(ChangeDetectorRef) private cdr:ChangeDetectorRef){}
 ngOnInit(){this.subscription=this.api.watch$(()=>this.api.getMitigations$(),[]).subscribe(s=>{this.mitigations=s.value;this.loadError=s.error;this.loading=s.loading;this.cdr.markForCheck();});}
 ngOnDestroy(){this.subscription?.unsubscribe();}
}
