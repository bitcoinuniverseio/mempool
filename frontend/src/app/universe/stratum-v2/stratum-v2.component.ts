import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, distinctUntilChanged, startWith } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { Sv2ConfiguredSource, Sv2Family, Sv2Page } from './stratum-v2.types';
import { appendSv2Page, configuredSv2Profile, validateSv2Page } from './stratum-v2.evidence';
interface Panel { items:any[]; page?:Sv2Page<any>; pending:boolean; error?:string; restartRequired?:boolean; }
interface View { kind:'loading'|'ready'|'error'; configured?:Sv2ConfiguredSource; message?:string; panels:Record<Sv2Family,Panel>; }
const empty=():Record<Sv2Family,Panel>=>({roles:{items:[],pending:false},templates:{items:[],pending:false},declarations:{items:[],pending:false}});
@Component({selector:'app-stratum-v2',templateUrl:'./stratum-v2.component.html',styleUrls:['../product-page.scss'],standalone:true,imports:[RelativeUrlPipe,CommonModule,RouterModule],changeDetection:ChangeDetectionStrategy.OnPush})
export class StratumV2Component implements OnInit,OnDestroy {
 private scope?:Subscription;private reads=new Map<Sv2Family,Subscription>();private revision=0;private destroyed=false;
 private readonly state=new BehaviorSubject<View>({kind:'loading',panels:empty()});readonly vm$:Observable<View>=this.state.asObservable();readonly families:Sv2Family[]=['roles','templates','declarations'];
 constructor(private api:UniverseApiService,private seo:SeoService,private network:StateService){this.seo.setTitle('Stratum V2 Job-Declaration Observatory');}
 ngOnInit():void{this.scope=this.network.networkChanged$.pipe(startWith(this.network.network),distinctUntilChanged()).subscribe(()=>this.reset());}
 private reset():void{this.revision++;this.reads.forEach(s=>s.unsubscribe());this.reads.clear();try{const configured=configuredSv2Profile(this.network.env.SV2_SOURCE_PROFILE);this.state.next({kind:'loading',configured,panels:empty()});for(const family of this.families)this.load(family);}catch(e){this.state.next({kind:'error',message:e instanceof Error?e.message:'No configured SV2 source.',panels:empty()});}}
 load(family:Sv2Family,more=false):void{
  const current=this.state.value,panel=current.panels[family];if(this.destroyed||!current.configured||panel.pending||more&&(!panel.page?.nextCursor||panel.restartRequired))return;
  this.reads.get(family)?.unsubscribe();
  const revision=this.revision,cursor=more?panel.page!.nextCursor!:undefined;
  this.update(family,{...panel,pending:true,error:undefined,restartRequired:false,...(!more?{items:[],page:undefined}:{})});
  const read=this.api.getStratumV2Page$(family,cursor).subscribe({next:value=>{if(this.destroyed||revision!==this.revision)return;try{const page=validateSv2Page(value,current.configured!,family);const items=more?appendSv2Page(panel.page!,page,panel.items,family):page.items;
   if(!more&&(page.nextCursor===null?items.length!==page.total:items.length>=page.total))throw new Error('The retained SV2 count does not close.');
   this.update(family,{items,page,pending:false});}catch(e){this.update(family,{...this.state.value.panels[family],pending:false,error:e instanceof Error?e.message:'Invalid SV2 source page.',restartRequired:true});}},error:error=>{if(this.destroyed||revision!==this.revision)return;this.update(family,{...this.state.value.panels[family],pending:false,error:error?.status===409?'The captured source changed or expired. Restart this panel.':error?.error?.error||error?.message||'SV2 observations unavailable. Retry this panel.',restartRequired:error?.status===409});}});
  this.reads.set(family,read);
 }
 private update(family:Sv2Family,panel:Panel):void{const panels={...this.state.value.panels,[family]:panel};const values=Object.values(panels);const kind=values.some(p=>p.page)?'ready':values.some(p=>p.pending)?'loading':values.some(p=>p.error)?'error':'loading';this.state.next({...this.state.value,panels,kind});}
 ngOnDestroy():void{this.destroyed=true;this.revision++;this.scope?.unsubscribe();this.reads.forEach(s=>s.unsubscribe());this.reads.clear();}
}
