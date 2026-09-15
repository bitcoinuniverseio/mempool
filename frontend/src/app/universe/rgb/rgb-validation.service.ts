import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription, forkJoin } from 'rxjs';
import { StateService } from '@app/services/state.service';
export interface RgbResult { status: 'valid' | 'invalid' | 'unresolved' | 'malformed' | 'warnings'; reason?: string; engine?: string; contract_id?: string; schema_id?: string; anchor_txids?: string[]; transition_bundles?: number; source?: any; validation?: any; }
@Injectable({providedIn:'root'})
export class RgbValidationService {
 constructor(private http:HttpClient, private state:StateService) {}
 validate(consignment:string):Observable<RgbResult> {
  return new Observable(observer=>{
   const network=this.state.network || this.state.env.ROOT_NETWORK;
   let worker:Worker; let request:Subscription|undefined; let phase=0; let source:any;
   const fail=(reason:string)=>{observer.next({status:'unresolved',reason});observer.complete();};
   if(typeof Worker==='undefined'){fail('This browser cannot run the isolated RGB engine.');return;}
   try {worker=new Worker(new URL('resources/rgb-engine/rgb.worker.js',document.baseURI));}catch{fail('The isolated RGB worker could not start.');return;}
   const timer=setTimeout(()=>fail('RGB validation exceeded the local time limit.'),30000);
   worker.onerror=()=>fail('The local RGB engine failed to load or execute.');
   worker.onmessage=event=>{
    const result=event.data as RgbResult;
    if(!result || !['valid','invalid','unresolved','malformed','warnings'].includes(result.status)){fail('RGB engine returned malformed evidence.');return;}
    if(phase===0 && result.status==='unresolved' && Array.isArray(result.anchor_txids) && result.anchor_txids.length){
     const ids=[...new Set(result.anchor_txids)];
     if(ids.length>256 || ids.some(id=>! /^[0-9a-f]{64}$/.test(id))){fail('RGB public anchor references exceed supported bounds.');return;}
     phase=1; const prefix=network===this.state.env.ROOT_NETWORK?'':'/'+network;
     const batches=[];for(let i=0;i<ids.length;i+=16)batches.push(this.http.post<any>(prefix+'/api/v1/intelligence/rgb/anchors',{txids:ids.slice(i,i+16)}));
     request=forkJoin(batches).subscribe({next:responses=>{
      const witnesses:any={};let checkpoint:string|undefined;
      for(const response of responses){
       if(response?.source?.network!==network || typeof response.source.block_hash!=='string' || !/^[0-9a-f]{64}$/.test(response.source.block_hash) || !response.witnesses || !Array.isArray(response.unresolved) || (checkpoint && checkpoint!==response.source.block_hash)){fail('Public anchor evidence has inconsistent network or checkpoints.');return;}
       checkpoint=response.source.block_hash;source=response.source;
       if(Object.keys(response.witnesses).some(id=>!ids.includes(id))){fail('Public resolver returned an unrelated transaction.');return;}
       Object.assign(witnesses,response.witnesses);
      }
      worker.postMessage({consignment,network,witnesses});
     },error:err=>fail(err?.error?.error || 'The owned public anchor source is unavailable.')});
    }else{observer.next({...result,source});observer.complete();}
   };
   worker.postMessage({consignment,network,witnesses:{}});
   return ()=>{clearTimeout(timer);worker.terminate();request?.unsubscribe();};
  });
 }
}
