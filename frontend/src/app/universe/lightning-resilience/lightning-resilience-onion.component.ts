import { Component, Inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { LightningResilienceApiService } from './lightning-resilience.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
@Component({selector:'app-lightning-resilience-onion',standalone:true,imports:[CommonModule,RouterModule,RelativeUrlPipe],template:`<div class="container-xl py-4"><h1 class="h2">Onion Message Queues</h1><nav class="d-flex flex-wrap gap-3 mb-4" aria-label="Lightning resilience"><a [routerLink]="'/lightning/resilience' | relativeUrl">Overview</a><a [routerLink]="'/lightning/resilience/htlcs' | relativeUrl">HTLC slots</a><a [routerLink]="'/lightning/resilience/onion-messages' | relativeUrl">Onion queues</a><a [routerLink]="'/lightning/resilience/simulate' | relativeUrl">Simulator</a><a [routerLink]="'/lightning/resilience/mitigations' | relativeUrl">Mitigations</a></nav><p *ngIf="loading" role="status">Loading owned evidence…</p><p *ngIf="loadError" role="alert" class="alert alert-warning">{{ loadError }}</p><p class="alert alert-info">Queue telemetry and onion-storm simulation remain unavailable. Owned LND channel snapshots do not measure onion message queues.</p><section *ngIf="overview"><dl><dt>Queue depth</dt><dd>{{ overview.onion_queue.total_queue_depth ?? 'Unknown' }}</dd><dt>Queue utilization</dt><dd>{{ overview.onion_queue.queue_utilization_pct ?? 'Unknown' }}</dd><dt>Processing rate</dt><dd>{{ overview.onion_queue.processing_rate_msgs_per_sec ?? 'Unknown' }}</dd><dt>Dropped message rate</dt><dd>{{ overview.onion_queue.dropped_msgs_rate_pct ?? 'Unknown' }}</dd><dt>Rate limiting</dt><dd>{{ overview.onion_queue.rate_limit_active === null ? 'Unknown' : overview.onion_queue.rate_limit_active ? 'Active' : 'Inactive' }}</dd></dl></section><p>Acceptance still requires actual queue instrumentation, observed limiter settings, and a calibrated storm model.</p></div>`})
export class LightningResilienceOnionComponent implements OnInit,OnDestroy {
 overview:any=null;loadError:string|null=null;loading=false;private subscription?:Subscription;
 constructor(@Inject(LightningResilienceApiService) private api:LightningResilienceApiService,@Inject(ChangeDetectorRef) private cdr:ChangeDetectorRef){}
 ngOnInit(){this.subscription=this.api.watch$(()=>this.api.getOverview$(),null).subscribe(s=>{this.overview=s.value;this.loadError=s.error;this.loading=s.loading;this.cdr.markForCheck();});}
 ngOnDestroy(){this.subscription?.unsubscribe();}
}
