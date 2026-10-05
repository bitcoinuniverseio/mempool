import { Inject,Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { Observable,merge,interval,of,defer } from 'rxjs';
import { startWith,switchMap,map,catchError,timeout } from 'rxjs/operators';
import { checkedUtxoEvidence } from './utxo-evidence';
export interface UtxoEvidence<T=any>{kind:'loading'|'available'|'unavailable';value:T|null;message:string|null;}
@Injectable({providedIn:'root'})
export class UtxoEvidenceService {
 constructor(@Inject(HttpClient) private http:HttpClient,@Inject(StateService) private state:StateService){}
 private get base(){const network=this.state.network??'';const prefix=network&&network!==(this.state.env.ROOT_NETWORK??'mainnet')?'/'+network:'';return (this.state.isBrowser?'':`${this.state.env.NGINX_PROTOCOL}://${this.state.env.NGINX_HOSTNAME}:${this.state.env.NGINX_PORT}`)+prefix;}
 watch$<T=any>(path:string):Observable<UtxoEvidence<T>>{
  const changes=this.state.isBrowser?merge(this.state.networkChanged$,interval(30000)):this.state.networkChanged$;
  return changes.pipe(startWith(null),switchMap(()=>defer(()=>{
   const network=this.state.network||this.state.env.ROOT_NETWORK||'mainnet';
   return this.http.get<unknown>(this.base+path).pipe(timeout({first:15000}),map(value=>{
    if(network!==(this.state.network||this.state.env.ROOT_NETWORK||'mainnet'))throw Error('UTXO context changed.');
    const result=checkedUtxoEvidence(path,value,network);
    return {kind:'available' as const,value:result.value as T,message:result.disclosure};
   }));
  }).pipe(catchError(()=>of({kind:'unavailable' as const,value:null,message:'Required owned evidence is unavailable or malformed for this network.'})),startWith({kind:'loading' as const,value:null,message:null}))));
 }
}
