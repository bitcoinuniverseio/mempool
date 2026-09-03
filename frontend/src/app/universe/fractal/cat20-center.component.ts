import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Cat20Holder, Cat20Token } from '@app/universe/universe.types';

interface Cat20ViewModel {
  readonly kind: 'loading' | 'ready' | 'detail' | 'error';
  readonly tokens?: Cat20Token[];
  readonly selected?: Cat20Token;
  readonly holders?: Cat20Holder[];
}

@Component({
  selector: 'app-cat20-center',
  templateUrl: './cat20-center.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Cat20CenterComponent implements OnInit {
  private readonly state = new BehaviorSubject<Cat20ViewModel>({ kind: 'loading' });
  readonly vm$: Observable<Cat20ViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private route: ActivatedRoute,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Fractal CAT-20 Center');
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap((params) => {
        const tokenId = params.get('tokenId');
        if (tokenId) {
          return this.api.getCat20Token$(tokenId).pipe(
            switchMap((token) => {
              return this.api.getCat20Holders$(token.tokenId).pipe(
                switchMap((h) => of<Cat20ViewModel>({ kind: 'detail', selected: token, holders: h.holders })),
                catchError(() => of<Cat20ViewModel>({ kind: 'detail', selected: token, holders: [] }))
              );
            }),
            catchError(() => of<Cat20ViewModel>({ kind: 'error' }))
          );
        }
        return this.api.getCat20Tokens$().pipe(
          switchMap((data) => of<Cat20ViewModel>({ kind: 'ready', tokens: data.tokens })),
          catchError(() => of<Cat20ViewModel>({ kind: 'error' }))
        );
      })
    ).subscribe((vm) => this.state.next(vm));
  }
}
