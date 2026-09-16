import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { LiquidProofService, LiquidProofResult } from './liquid-proof.service';
@Component({
 selector:'app-liquid-unblind-workspace',templateUrl:'./liquid-unblind-workspace.component.html',
 styleUrls:['../product-page.scss'],standalone:true,imports:[RelativeUrlPipe,CommonModule,FormsModule,RouterModule],changeDetection:ChangeDetectionStrategy.OnPush,
})
export class LiquidUnblindWorkspaceComponent implements OnDestroy {
 blindingKey=''; outputHex=''; rangeproofHex=''; surjectionproofHex=''; inputGenerators=''; verifying=false; error:string|null=null;
 private generation=0;
 private subscription:Subscription;
 private readonly resultSubject=new BehaviorSubject<LiquidProofResult|null>(null);
 readonly result$=this.resultSubject.asObservable();
 constructor(seo:SeoService,private proof:LiquidProofService,state:StateService,private cdr:ChangeDetectorRef) {
  seo.setTitle('Liquid Client-Only Unblinding Inspector');
  this.subscription=state.networkChanged$.subscribe(()=>{this.clear();this.cdr.markForCheck();});
 }
 edited():void {this.generation++;this.verifying=false;this.error=null;this.resultSubject.next(null);}
 clear():void {this.edited();this.blindingKey='';this.outputHex='';this.rangeproofHex='';this.surjectionproofHex='';this.inputGenerators='';}
 async unblind():Promise<void> {
  if(this.verifying)return;
  this.edited(); const generation=this.generation; this.verifying=true;
  const input={blindingKey:this.blindingKey.trim(),outputHex:this.outputHex.trim(),rangeproofHex:this.rangeproofHex.trim(),surjectionproofHex:this.surjectionproofHex.trim(),inputGenerators:this.inputGenerators.trim().split(/\s+/).filter(Boolean)};
  this.blindingKey='';
  try {const result=await this.proof.inspect(input);if(generation===this.generation)this.resultSubject.next(result);}
  catch(error){if(generation===this.generation)this.error=error instanceof Error?error.message:'Local proof verification failed.';}
  finally {input.blindingKey='';if(generation===this.generation){this.verifying=false;this.cdr.markForCheck();}}
 }
 ngOnDestroy():void {this.subscription.unsubscribe();this.clear();this.resultSubject.complete();}
}
