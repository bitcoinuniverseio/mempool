import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, map, of, startWith, switchMap, Subject, takeUntil } from 'rxjs';
import { LiquidNodeView } from './liquid-node-view';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { exactLiquidAmount, liquidPageFence, requireLiquid } from './liquid-evidence';
import { LiquidAssetPage, LiquidAssetRecord, LiquidFederationEpoch, LiquidNetwork, LiquidObservatoryCoverage, LiquidObservatorySummary, LiquidPegPage, LiquidPegRecord, LiquidPegOutRecord } from './liquid-observatory.types';

export interface LiquidViewModel {
 kind: 'loading'|'ready'|'error';
 summary?: LiquidObservatorySummary; federation?: LiquidFederationEpoch; projection?: LiquidObservatoryCoverage;
 assets?: LiquidAssetRecord[]; assetPage?: LiquidAssetPage; assetDetail?: LiquidAssetRecord;
 pegs?: LiquidPegRecord[]; pegOuts?: LiquidPegOutRecord[]; pegPage?: LiquidPegPage; pegOutPage?: LiquidPegPage;
 errors: Record<string,string>; pending: Record<string,boolean>; notice?: string;
}
@Component({selector:'app-liquid-observatory',templateUrl:'./liquid-observatory.component.html',styleUrls:['../product-page.scss','./liquid-observatory.component.scss'],standalone:true,imports:[RelativeUrlPipe,CommonModule,RouterModule,FormsModule],changeDetection:ChangeDetectionStrategy.OnPush})
export class LiquidObservatoryComponent implements OnInit,OnDestroy {
 network: LiquidNetwork='liquidv1';
 private readonly destroyed$=new Subject<void>();
 private readonly nodeNetwork=new BehaviorSubject<LiquidNetwork>('liquidv1');
 readonly node$=this.nodeNetwork.pipe(switchMap(network=>this.api.getLiquidNode$(network).pipe(
  map(node=>({node,error:null as string|null,loading:false})),
  catchError(error=>of({node:null as LiquidNodeView|null,error:this.failure(error),loading:false})),
  startWith({node:null as LiquidNodeView|null,error:null as string|null,loading:true}),
 )),takeUntil(this.destroyed$));
 private reads=new Subscription(); private destroyed=false;
 private vm: LiquidViewModel={kind:'loading',errors:{},pending:{}};
 private readonly state=new BehaviorSubject<LiquidViewModel>(this.vm);
 readonly vm$=this.state.asObservable();
 readonly amount=exactLiquidAmount;
 constructor(private api:UniverseApiService,private seo:SeoService){this.seo.setTitle('Liquid Confidential-Asset, Peg, and Federation Observatory');}
 ngOnInit():void {this.refresh();}
 ngOnDestroy():void{this.destroyed=true;this.destroyed$.next();this.destroyed$.complete();this.reads.unsubscribe();this.nodeNetwork.complete();this.state.complete();}
 private failure(error:any):string{return error?.error?.error || error?.message || 'The selected Liquid observation is unavailable.';}
 private publish():void{if(this.destroyed)return;this.vm.kind=this.vm.summary||this.vm.federation||this.vm.projection||this.vm.assetPage||this.vm.pegPage?'ready':Object.values(this.vm.pending).some(Boolean)?'loading':'error';this.state.next({...this.vm,errors:{...this.vm.errors},pending:{...this.vm.pending}});}
 private read<T>(key:string,source:()=>Observable<T>,accept:(data:T)=>void,failed?:(error:any)=>void):void{
  if(this.destroyed||this.vm.pending[key])return;this.vm.pending[key]=true;delete this.vm.errors[key];this.publish();
  this.reads.add(source().subscribe({next:data=>{try{accept(data);}catch(error){this.vm.errors[key]=this.failure(error);}this.vm.pending[key]=false;this.publish();},error:error=>{this.vm.pending[key]=false;this.vm.errors[key]=this.failure(error);this.publish();failed?.(error);},complete:()=>{this.vm.pending[key]=false;this.publish();}}));
 }
 refreshNode():void{this.nodeNetwork.next(this.network);this.refresh();}
 refresh():void{
  if(this.destroyed)return;this.reads.unsubscribe();this.reads=new Subscription();this.vm={kind:'loading',errors:{},pending:{}};
  this.read('summary',()=>this.api.getLiquidObservatorySummary$(this.network),v=>{this.vm.summary=v;});
  this.read('federation',()=>this.api.getLiquidFederation$(this.network),v=>{this.vm.federation=v;});
  this.refreshProjection();this.loadAssets();this.loadPegs('pegs');this.loadPegs('pegOuts');
 }
 refreshProjection():void{this.read('projection',()=>this.api.getLiquidProjection$(this.network),v=>{this.vm.projection=v;});}
 advance():void{
  const previous=this.vm.projection;if(!previous||previous.status!=='PARTIAL'||this.vm.pending.advance||this.vm.pending.projection)return;
  this.read('advance',()=>this.api.advanceLiquidProjection$(this.network,previous.cursor),v=>{
   requireLiquid(v.source.profileSha256===previous.source.profileSha256 && v.progress.processedBlocks>=previous.progress.processedBlocks && v.progress.processedBlocks<=previous.progress.processedBlocks+16,'The manual projection receipt does not match the previous bounded cursor.');
   this.vm.projection=v;this.vm.notice='Shared projection receipt updated. Refresh observations to read tables at this cursor.';
  },error=>{if(error?.status===409){this.vm.notice='The shared cursor or source changed. Reading its current receipt; Continue requires another explicit action.';this.refreshProjection();}});
 }
 cancel():void{this.reads.unsubscribe();this.reads=new Subscription();this.vm.pending={};this.vm.notice='Local observatory requests cancelled. The shared durable projection is retained; an interrupted response does not prove whether another reader committed progress.';this.publish();}
 loadAssets(more=false):void{
  const prior=this.vm.assetPage,offset=more?prior?.nextOffset:0;if(offset===null||offset===undefined)return;
  this.read('assets',()=>this.api.getLiquidAssets$(this.network,offset),v=>{
   if(more&&prior){requireLiquid(liquidPageFence(v.coverage)===liquidPageFence(prior.coverage)&&v.total===prior.total&&v.publication.sha256===prior.publication.sha256&&v.publication.revision===prior.publication.revision,'Catalog source, projection, total or publication changed. Refresh observations before continuing.');requireLiquid(!v.assets.some(a=>this.vm.assets?.some(old=>old.assetId===a.assetId)),'The catalog continuation repeated a previously accepted asset.');}
   this.vm.assets=more?[...(this.vm.assets??[]),...v.assets]:v.assets;this.vm.assetPage=v;
  });
 }
 loadPegs(kind:'pegs'|'pegOuts',more=false):void{
  const prior=kind==='pegs'?this.vm.pegPage:this.vm.pegOutPage,offset=more?(kind==='pegs'?prior?.nextOffset:prior?.pegOuts.nextOffset):0;if(offset===null||offset===undefined)return;
  this.read(kind,()=>this.api.getLiquidPegs$(this.network,offset),v=>{
   if(more&&prior)requireLiquid(liquidPageFence(v.coverage)===liquidPageFence(prior.coverage)&&(kind==='pegs'?v.total===prior.total:v.pegOuts.total===prior.pegOuts.total),'Peg source, projection or total changed. Refresh observations before continuing.');
   if(kind==='pegs'){requireLiquid(!more||!v.pegs.some(a=>this.vm.pegs?.some(old=>old.id===a.id)),'The peg continuation repeated a previously accepted claim.');this.vm.pegs=more?[...(this.vm.pegs??[]),...v.pegs]:v.pegs;this.vm.pegPage=v;}
   else{requireLiquid(!more||!v.pegOuts.requests.some(a=>this.vm.pegOuts?.some(old=>old.id===a.id)),'The peg-out continuation repeated a previously accepted request.');this.vm.pegOuts=more?[...(this.vm.pegOuts??[]),...v.pegOuts.requests]:v.pegOuts.requests;this.vm.pegOutPage=v;}
  });
 }
 detail(assetId:string):void{if(this.vm.pending.detail)return;this.vm.assetDetail=undefined;this.read('detail',()=>this.api.getLiquidAsset$(assetId,this.network),v=>{const page=this.vm.assetPage;requireLiquid(!page||liquidPageFence(page.coverage)===liquidPageFence(v.coverage)&&page.publication.sha256===v.publication.sha256,'Asset detail belongs to a different projection or publication. Refresh observations.');this.vm.assetDetail=v;});}
}
