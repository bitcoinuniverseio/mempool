import { ChangeDetectionStrategy,Component,Inject,OnInit,OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject,Observable,combineLatest,Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { UtxoEvidenceService } from './utxo-evidence.service';
interface UtxoViewModel {kind:'loading'|'ready'|'error';checkpoints?:any[];valueCohorts?:any[];scriptTypes?:any[];protocolUtxos?:any;utreexo?:any;message?:string;unavailable?:string[];}
@Component({selector:'app-utxo-set',templateUrl:'./utxo-set.component.html',styleUrls:['../product-page.scss'],standalone:true,imports:[CommonModule,RouterModule,RelativeUrlPipe],changeDetection:ChangeDetectionStrategy.OnPush})
export class UtxoSetComponent implements OnInit,OnDestroy {
 protected readonly Number=Number;private state=new BehaviorSubject<UtxoViewModel>({kind:'loading'});readonly vm$:Observable<UtxoViewModel>=this.state.asObservable();private subscription?:Subscription;
 constructor(@Inject(UtxoEvidenceService) private api:UtxoEvidenceService,@Inject(SeoService) private seo:SeoService){this.seo.setTitle('UTXO-Set, Supply & Utreexo Observatory');}
 ngOnInit(){this.subscription=combineLatest([this.api.watch$('/api/v1/utxo-set/checkpoints'),this.api.watch$('/api/v1/utxo-set/distribution'),this.api.watch$('/api/v1/utxo-set/protocols'),this.api.watch$('/api/v1/utreexo/roots')]).subscribe(([checkpoints,distribution,protocol,utreexo])=>{
  const parts=[checkpoints,distribution,protocol,utreexo],labels=['Core checkpoints','Complete cohort projection','Protocol-bearing indexes','Utreexo accumulator'];const unavailable=parts.flatMap((p,i)=>p.kind==='unavailable'?[labels[i]+': '+p.message]:[]);
  if(parts.every(p=>p.kind==='unavailable')){this.state.next({kind:'error',message:unavailable.join(' '),unavailable});return;}
  if(parts.every(p=>p.kind==='loading')){this.state.next({kind:'loading'});return;}
  this.state.next({kind:'ready',checkpoints:checkpoints.value?.checkpoints,valueCohorts:distribution.value?.valueCohorts,scriptTypes:distribution.value?.scriptTypes,protocolUtxos:protocol.value??undefined,utreexo:utreexo.value??undefined,unavailable});
 });}
 ngOnDestroy(){this.subscription?.unsubscribe();}
}
