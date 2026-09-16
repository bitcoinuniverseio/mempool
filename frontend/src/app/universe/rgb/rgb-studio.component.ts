import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { RgbResult, RgbValidationService } from './rgb-validation.service';
@Component({selector:'app-rgb-studio',templateUrl:'./rgb-studio.component.html',styleUrls:['../product-page.scss'],standalone:true,imports:[RelativeUrlPipe,CommonModule,FormsModule,RouterModule],changeDetection:ChangeDetectionStrategy.OnPush})
export class RgbStudioComponent implements OnDestroy {
 consignmentHex=''; result:RgbResult|null=null; loading=false; private attempt=0;private request?:Subscription;private networkSub:Subscription;
 constructor(private seo:SeoService,private validator:RgbValidationService,private state:StateService,private cdr:ChangeDetectorRef){seo.setTitle('RGB Client-Side Validation Studio');this.networkSub=state.networkChanged$.subscribe(()=>this.invalidate());}
 invalidate():void{this.attempt++;this.request?.unsubscribe();this.result=null;this.loading=false;this.cdr.markForCheck();}
 async importFile(event:Event):Promise<void>{this.invalidate();this.consignmentHex='';const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;const attempt=this.attempt;if(file.size>2_000_000){this.result={status:'malformed',reason:'Consignment exceeds the 2 MB import limit.'};this.cdr.markForCheck();return;}try{const bytes=new Uint8Array(await file.arrayBuffer());if(attempt!==this.attempt)return;const text=new TextDecoder().decode(bytes);this.consignmentHex=text.startsWith('-----BEGIN RGB CONSIGNMENT-----')?text:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');this.cdr.markForCheck();}catch{if(attempt===this.attempt){this.result={status:'malformed',reason:'The local file could not be read.'};this.cdr.markForCheck();}}}
 validate():void{this.invalidate();const input=this.consignmentHex.trim();if(!input)return;if(input.length>4_000_000){this.result={status:'malformed',reason:'Consignment exceeds the 2 MB import limit.'};return;}const attempt=this.attempt,network=this.state.network;this.loading=true;this.request=this.validator.validate(input).subscribe({next:result=>{if(attempt!==this.attempt||input!==this.consignmentHex.trim()||network!==this.state.network)return;this.result=result;this.loading=false;this.cdr.markForCheck();},error:()=>{if(attempt===this.attempt){this.result={status:'unresolved',reason:'Local validation could not complete.'};this.loading=false;this.cdr.markForCheck();}}});}
 ngOnDestroy():void{this.invalidate();this.networkSub.unsubscribe();}
}
