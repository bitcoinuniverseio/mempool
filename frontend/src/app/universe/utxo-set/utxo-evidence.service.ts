import { Inject,Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { Observable,merge,interval,of } from 'rxjs';
import { startWith,switchMap,map,catchError } from 'rxjs/operators';
export interface UtxoEvidence<T=any>{kind:'loading'|'available'|'unavailable';value:T|null;message:string|null;}
@Injectable({providedIn:'root'})
export class UtxoEvidenceService {
 constructor(@Inject(HttpClient) private http:HttpClient,@Inject(StateService) private state:StateService){}
 private get base(){const network=this.state.network??'';const prefix=network&&network!==(this.state.env.ROOT_NETWORK??'mainnet')?'/'+network:'';return (this.state.isBrowser?'':`${this.state.env.NGINX_PROTOCOL}://${this.state.env.NGINX_HOSTNAME}:${this.state.env.NGINX_PORT}`)+prefix;}
 watch$<T=any>(path:string):Observable<UtxoEvidence<T>>{const changes=this.state.isBrowser?merge(this.state.networkChanged$,interval(30000)):this.state.networkChanged$;return changes.pipe(startWith(null),switchMap(()=>this.http.get<T>(this.base+path).pipe(map(value=>({kind:'available' as const,value,message:null})),catchError(()=>of({kind:'unavailable' as const,value:null,message:'Required owned evidence is unavailable for this network.'})),startWith({kind:'loading' as const,value:null,message:null}))));}
}
