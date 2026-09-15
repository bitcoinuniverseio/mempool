import { Inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, merge, interval } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
export interface LightningResilienceOverview {
 total_channels_monitored:number|null;healthy_channels_count:number|null;congested_channels_count:number|null;active_incidents_count:number|null;
 average_slot_utilization_pct:number|null;average_held_duration_p95_seconds:number|null;onion_queue:any;recent_incidents:any[];top_congested_channels:any[];scope:string;source:any;
}
@Injectable({providedIn:'root'})
export class LightningResilienceApiService {
 constructor(@Inject(HttpClient) private http:HttpClient,@Inject(StateService) private state:StateService){}
 get networkChanged$(){return this.state.networkChanged$;}
 private get baseUrl(){const network=this.state.network??'';const prefix=network&&network!==(this.state.env.ROOT_NETWORK??'mainnet')?'/'+network:'';const origin=this.state.isBrowser?'':`${this.state.env.NGINX_PROTOCOL}://${this.state.env.NGINX_HOSTNAME}:${this.state.env.NGINX_PORT}`;return origin+prefix+'/api/v1/intelligence/lightning/resilience';}
 /** Clear on network/refresh and keep subsequent network changes alive after an error. */
 watch$<T>(load:()=>Observable<T>,empty:T):Observable<{value:T;error:string|null;loading:boolean}>{
  const changes=this.state.isBrowser?merge(this.networkChanged$,interval(15000)):this.networkChanged$;
  return changes.pipe(startWith(null),switchMap(()=>load().pipe(map(value=>({value,error:null as string|null,loading:false})),catchError(()=>of({value:empty,error:'Lightning evidence is unavailable for this network.',loading:false})),startWith({value:empty,error:null,loading:true}))));
 }
 getOverview$():Observable<LightningResilienceOverview|null>{return this.http.get<LightningResilienceOverview>(this.baseUrl+'/overview');}
 getChannels$():Observable<any[]>{return this.http.get<{channels:any[]}>(this.baseUrl+'/channels').pipe(map(r=>r.channels));}
 getChannel$(id:string):Observable<any>{return this.http.get(this.baseUrl+'/channels/'+encodeURIComponent(id));}
 getNode$(id:string):Observable<any>{return this.http.get(this.baseUrl+'/nodes/'+encodeURIComponent(id));}
 getIncidents$():Observable<any[]>{return this.http.get<{incidents:any[]}>(this.baseUrl+'/incidents').pipe(map(r=>r.incidents));}
 getMitigations$():Observable<any[]>{return this.http.get<{mitigations:any[]}>(this.baseUrl+'/mitigations').pipe(map(r=>r.mitigations));}
 simulate$(payload:any):Observable<any>{return this.http.post(this.baseUrl+'/simulate',payload);}
}
