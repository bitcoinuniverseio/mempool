import { Component, Inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { LightningResilienceApiService } from './lightning-resilience.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
@Component({selector:'app-lightning-resilience-htlcs',standalone:true,imports:[CommonModule,RouterModule,RelativeUrlPipe],template:`<div class="container-xl py-4"><h1 class="h2">HTLC Slot Pressure</h1><nav class="d-flex flex-wrap gap-3 mb-4" aria-label="Lightning resilience"><a [routerLink]="'/lightning/resilience' | relativeUrl">Overview</a><a [routerLink]="'/lightning/resilience/htlcs' | relativeUrl">HTLC slots</a><a [routerLink]="'/lightning/resilience/onion-messages' | relativeUrl">Onion queues</a><a [routerLink]="'/lightning/resilience/simulate' | relativeUrl">Simulator</a><a [routerLink]="'/lightning/resilience/mitigations' | relativeUrl">Mitigations</a></nav><p *ngIf="loading" role="status">Loading owned evidence…</p><p *ngIf="loadError" role="alert" class="alert alert-warning">{{ loadError }}</p><p>Current owned channel snapshots. Incoming and outgoing limits are distinct. Occupancy does not establish jamming or payment failure.</p><div class="table-responsive"><table class="table"><thead><tr><th>Channel</th><th>Capacity (sats)</th><th>Slots used / capacity</th><th>Slot utilization</th><th>Assessment</th></tr></thead><tbody><tr *ngFor="let c of channels"><td><a [routerLink]="['/lightning/resilience/channel' | relativeUrl,c.short_channel_id]">{{ c.short_channel_id }}</a></td><td>{{ c.capacity_sats | number }}</td><td>{{ c.htlc_slots_in_use }} / {{ c.htlc_slot_capacity ?? 'Unknown' }}</td><td>{{ c.htlc_slot_utilization_pct === null ? 'Unknown' : (c.htlc_slot_utilization_pct | number:'1.0-2') + '%' }}</td><td>{{ c.resilience_band }}</td></tr></tbody></table></div><p *ngIf="!loading && !loadError && !channels.length">The current owned observation contains no channels.</p></div>`})
export class LightningResilienceHtlcsComponent implements OnInit,OnDestroy {
 channels:any=[];loadError:string|null=null;loading=false;private subscription?:Subscription;
 constructor(@Inject(LightningResilienceApiService) private api:LightningResilienceApiService,@Inject(ChangeDetectorRef) private cdr:ChangeDetectorRef){}
 ngOnInit(){this.subscription=this.api.watch$(()=>this.api.getChannels$(),[]).subscribe(s=>{this.channels=s.value;this.loadError=s.error;this.loading=s.loading;this.cdr.markForCheck();});}
 ngOnDestroy(){this.subscription?.unsubscribe();}
}
