import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subject, catchError, combineLatest, map, of, startWith, switchMap, takeUntil } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Cat20Holder, Cat20Page, Cat20Token, Cat20TokenDetail } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { fractalFailure, mergeCatPage, correlateCatHolders } from './fractal-evidence';

interface Cat20ViewModel {
  readonly kind: 'loading' | 'ready' | 'detail' | 'error';
  readonly tokens?: readonly Cat20Token[];
  readonly selected?: Cat20TokenDetail;
  readonly holders?: readonly Cat20Holder[];
  readonly page?: Cat20Page<Cat20Token | Cat20Holder>;
  readonly message?: string;
  readonly holderFailure?: string;
  readonly pageFailure?: string;
  readonly pending?: boolean;
  readonly restartRequired?: boolean;
}
@Component({selector:'app-cat20-center',templateUrl:'./cat20-center.component.html',styleUrls:['../product-page.scss'],standalone:true,imports:[RelativeUrlPipe,CommonModule,RouterModule],changeDetection:ChangeDetectionStrategy.OnPush})
export class Cat20CenterComponent implements OnInit, OnDestroy {
  private readonly state = new BehaviorSubject<Cat20ViewModel>({kind:'loading'});
  readonly vm$ = this.state.asObservable();
  private readonly destroyed = new Subject<void>();
  private readonly scopeReset = new Subject<void>();
  private readonly refresh = new Subject<void>();
  constructor(private api: UniverseApiService, private route: ActivatedRoute, private seo: SeoService) {this.seo.setTitle('Fractal CAT-20 Center');}
  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.api.selectedNetwork$(), this.refresh.pipe(startWith(undefined))]).pipe(
      switchMap(([params]) => {
        this.scopeReset.next();this.state.next({kind:'loading'});
        const id=params.get('tokenId');
        if (!id) return this.api.getCat20Tokens$({limit:50}).pipe(map(page => {const accepted=mergeCatPage(undefined,page);return {kind:'ready',tokens:accepted.items,page:accepted} as Cat20ViewModel;}),catchError(error=>of<Cat20ViewModel>({kind:'error',message:fractalFailure(error)})));
        return this.api.getCat20Token$(id).pipe(switchMap(selected => this.api.getCat20Holders$(selected.tokenId,{limit:50}).pipe(
          map(page => {correlateCatHolders(selected,page);const accepted=mergeCatPage(undefined,page);return {kind:'detail',selected,holders:accepted.items,page:accepted} as Cat20ViewModel;}),
          catchError(error => of<Cat20ViewModel>({kind:'detail',selected,holderFailure:fractalFailure(error)})),
        )),catchError(error=>of<Cat20ViewModel>({kind:'error',message:fractalFailure(error)})));
      }),
      // Keep the context stream alive after a failed source read so Retry works.
      // Each source branch catches below through a deferred per-scope wrapper.
      takeUntil(this.destroyed),
    ).subscribe({next:vm=>this.state.next(vm),error:error=>this.state.next({kind:'error',message:fractalFailure(error)})});
  }
  more(): void {
    const current=this.state.value;
    if (current.pending || current.restartRequired || !['ready','detail'].includes(current.kind) || (current.page && !current.page.nextCursor)) return;
    const request={limit:50,cursor:current.page?.nextCursor || undefined};
    const read: Observable<Cat20Page<Cat20Token | Cat20Holder>>=current.selected ? this.api.getCat20Holders$(current.selected.tokenId,request) : this.api.getCat20Tokens$(request);
    this.state.next({...current,pending:true,pageFailure:undefined,holderFailure:undefined});
    read.pipe(map(page=>{if(current.selected) correlateCatHolders(current.selected,page);return mergeCatPage(current.page,page);}),takeUntil(this.scopeReset),takeUntil(this.destroyed)).subscribe({
      next:page=>this.state.next({...current,page,pending:false,pageFailure:undefined,holderFailure:undefined,...(current.selected ? {holders:page.items as readonly Cat20Holder[]} : {tokens:page.items as readonly Cat20Token[]})}),
      error:error=>this.state.next({...current,pending:false,pageFailure:fractalFailure(error),restartRequired:(error as {status?:number})?.status===409}),
    });
  }
  restart(): void {if(this.state.value.kind!=='loading' && !this.state.value.pending)this.refresh.next();}
  ngOnDestroy(): void {this.scopeReset.next();this.destroyed.next();this.destroyed.complete();}
}
