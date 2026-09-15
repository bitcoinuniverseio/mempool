import { ChangeDetectionStrategy, Component, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { ZcashScannerService, ZcashScanResult } from './zcash-scanner.service';
import { ZCASH_SCANNER_SAMPLES } from './zcash-scanner-samples';
@Component({selector:'app-zcash-viewing-key-workspace',templateUrl:'./zcash-viewing-key-workspace.component.html',styleUrls:['../product-page.scss'],standalone:true,imports:[RelativeUrlPipe,CommonModule,FormsModule,RouterModule],changeDetection:ChangeDetectionStrategy.OnPush})
export class ZcashViewingKeyWorkspaceComponent implements OnDestroy {
 viewingKey='';keyType='unified-full';network='mainnet';mode='owned-blocks';startHeight=2500000;blockCount=1;artifactInput='[]';scanning=false;error:string|null=null;
 private resultSubject=new BehaviorSubject<ZcashScanResult|null>(null);readonly result$=this.resultSubject.asObservable();
 private active?:{promise:Promise<ZcashScanResult>;cancel:()=>void};private abort?:AbortController;private generation=0;private networkSubscription:Subscription;
 resume:{hash:string;height:number}|null=null;
 constructor(seo:SeoService,private scanner:ZcashScannerService,private cdr:ChangeDetectorRef,state:StateService){seo.setTitle('Zcash Client-Only Viewing-Key Workspace');this.networkSubscription=state.networkChanged$.subscribe(()=>this.clear());}
 clear(resetResume=true){this.generation++;this.active?.cancel();this.abort?.abort();this.scanning=false;this.error=null;this.resultSubject.next(null);if(resetResume)this.resume=null;this.cdr.markForCheck();}
 clearKey(){this.clear();this.viewingKey='';}
 loadSample(pool:'sapling'|'orchard'){this.clear();const sample=ZCASH_SCANNER_SAMPLES[pool];this.network=sample.network;this.mode=sample.mode;this.keyType=sample.key_type;this.viewingKey=sample.viewing_key;this.artifactInput=JSON.stringify(sample.outputs,null,2);}
 async scan(resuming=false){
  const prior=resuming?this.resume:null;this.clear(false);this.resume=null;
  if(!this.viewingKey.trim()){this.error='A supported viewing key is required.';return;}
  if(resuming&&!prior){this.error='No verified interval checkpoint is available.';return;}
  const generation=this.generation;this.scanning=true;
  const key={viewing_key:this.viewingKey.trim(),key_type:this.keyType,network:this.network};
  try{
   let request:any;
   if(this.mode==='compact-artifact'){
    if(this.artifactInput.length>1000000)throw new Error('Compact artifact exceeds 1 MB.');
    const outputs=JSON.parse(this.artifactInput);if(!Array.isArray(outputs))throw new Error('Compact outputs must be a JSON array.');
    request={...key,mode:'compact-artifact',outputs};
   }else{
    if(!Number.isInteger(this.blockCount)||this.blockCount<1||this.blockCount>10)throw new Error('Choose 1–10 blocks.');
    this.active=this.scanner.run({...key,mode:'compact-artifact',outputs:[]});await this.active.promise;if(generation!==this.generation)return;
    const start=prior?.height??this.startHeight;this.abort=new AbortController();
    const timer=setTimeout(()=>this.abort?.abort(),30000);
    let batch:any;try{batch=await this.scanner.publicBlocks(this.network,start,start+this.blockCount-1,prior?.hash,this.abort.signal);}finally{clearTimeout(timer);}
    if(generation!==this.generation)return;
    request={...batch,...key};this.startHeight=start;
   }
   this.active=this.scanner.run(request);const result=await this.active.promise;
   if(generation!==this.generation)return;
   this.resultSubject.next(result);
   if(result.mode==='owned-blocks'&&result.last_hash&&result.next_height)this.resume={hash:result.last_hash,height:result.next_height};
  }catch(error){if(generation===this.generation){this.error=error instanceof SyntaxError?'Invalid compact artifact JSON.':(error as Error).message;this.resultSubject.next(null);this.resume=null;}}
  finally{key.viewing_key='';if(generation===this.generation){this.scanning=false;this.cdr.markForCheck();}}
 }
 ngOnDestroy(){this.clearKey();this.networkSubscription.unsubscribe();this.resultSubject.complete();}
}
