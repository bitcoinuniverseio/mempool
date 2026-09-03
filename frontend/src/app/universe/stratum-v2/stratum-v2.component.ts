import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  StratumV2JobDeclaration,
  StratumV2RoleStatus,
  StratumV2Template,
} from '@app/universe/universe.types';

interface StratumViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly roles?: StratumV2RoleStatus[];
  readonly templates?: StratumV2Template[];
  readonly declarations?: StratumV2JobDeclaration[];
}

@Component({
  selector: 'app-stratum-v2',
  templateUrl: './stratum-v2.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StratumV2Component implements OnInit {
  private readonly state = new BehaviorSubject<StratumViewModel>({ kind: 'loading' });
  readonly vm$: Observable<StratumViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Stratum V2 Job-Declaration Observatory');
  }

  ngOnInit(): void {
    combineLatest([
      this.api.getStratumV2Network$().pipe(catchError(() => of({ roles: [] }))),
      this.api.getStratumV2Templates$().pipe(catchError(() => of({ templates: [] }))),
      this.api.getStratumV2Declarations$().pipe(catchError(() => of({ declarations: [] }))),
    ]).subscribe(([networkData, tmplData, declData]) => {
      this.state.next({
        kind: 'ready',
        roles: networkData.roles,
        templates: tmplData.templates,
        declarations: declData.declarations,
      });
    });
  }
}
