import { Component, Inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { LightningResilienceApiService } from './lightning-resilience.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
@Component({selector:'app-lightning-resilience-node-detail',standalone:true,imports:[CommonModule,RouterModule,RelativeUrlPipe],template:`<div class="container-xl py-4"><h1 class="h2">Owned Node Observation</h1><nav class="d-flex flex-wrap gap-3 mb-4" aria-label="Lightning resilience"><a [routerLink]="'/lightning/resilience' | relativeUrl">Overview</a><a [routerLink]="'/lightning/resilience/htlcs' | relativeUrl">HTLC slots</a><a [routerLink]="'/lightning/resilience/onion-messages' | relativeUrl">Onion queues</a><a [routerLink]="'/lightning/resilience/simulate' | relativeUrl">Simulator</a><a [routerLink]="'/lightning/resilience/mitigations' | relativeUrl">Mitigations</a></nav><p *ngIf="loading" role="status">Loading owned evidence…</p><p *ngIf="loadError" role="alert" class="alert alert-warning">{{ loadError }}</p><section *ngIf="node"><p>{{ node.scope }}</p><p class="text-break">Public key: {{ node.node_public_key }}</p><dl><dt>Observed channels touching this node</dt><dd>{{ node.total_channels }}</dd><dt>Resilience assessment</dt><dd>{{ node.resilience_status }}</dd><dt>Circuit breaker</dt><dd>{{ node.active_circuit_breaker === null ? 'Unknown' : node.active_circuit_breaker ? 'Active' : 'Inactive' }}</dd><dt>Onion message support</dt><dd>{{ node.onion_message_support === null ? 'Unknown' : node.onion_message_support ? 'Supported' : 'Unsupported' }}</dd><dt>PTLC readiness</dt><dd>{{ node.ptlc_readiness }}</dd><dt>Observed</dt><dd>{{ node.observed_at_utc }}</dd></dl></section></div>`})
export class LightningResilienceNodeDetailComponent implements OnInit,OnDestroy {
 node:any=null;loadError:string|null=null;loading=false;private subscription?:Subscription;
 constructor(@Inject(ActivatedRoute) private route:ActivatedRoute,@Inject(LightningResilienceApiService) private api:LightningResilienceApiService,@Inject(ChangeDetectorRef) private cdr:ChangeDetectorRef){}
 ngOnInit(){this.subscription=this.route.paramMap.pipe(switchMap(params=>{const id=params.get('publicKey');return id?this.api.watch$(()=>this.api.getNode$(id),null):of({value:null,error:'This address does not name a node.',loading:false});})).subscribe(s=>{this.node=s.value;this.loadError=s.error;this.loading=s.loading;this.cdr.markForCheck();});}
 ngOnDestroy(){this.subscription?.unsubscribe();}
}
