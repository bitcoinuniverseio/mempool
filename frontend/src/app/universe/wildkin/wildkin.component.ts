import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, map, of } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { WildkinStatusSummary } from '@app/universe/universe.types';

interface WildkinViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly status?: WildkinStatusSummary;
  readonly message?: string;
}

@Component({
  selector: 'app-wildkin',
  templateUrl: './wildkin.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WildkinComponent implements OnInit {
  private readonly state = new BehaviorSubject<WildkinViewModel>({ kind: 'loading' });
  readonly vm$: Observable<WildkinViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Wildkin Evidence Explorer');
  }

  ngOnInit(): void {
    this.api.getWildkinStatus$().pipe(
      map((status): WildkinViewModel => ({ kind: 'ready', status })),
      catchError((error) => of<WildkinViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
}
