import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, map, of, Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { WildkinBraidCeremony } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface BloodlinesViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly braids?: WildkinBraidCeremony[];
  readonly message?: string;
}

@Component({
  selector: 'app-wildkin-bloodlines',
  templateUrl: './wildkin-bloodlines.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WildkinBloodlinesComponent implements OnInit, OnDestroy {
  private request?: Subscription;
  private readonly state = new BehaviorSubject<BloodlinesViewModel>({ kind: 'loading' });
  readonly vm$: Observable<BloodlinesViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Wildkin Bloodlines and Braids');
  }

  braidVerdict(valid: unknown): string {
    return valid === true ? 'Source Reports Valid' : valid === false ? 'Source Reports Invalid' : 'Validity Not Reported';
  }

  ngOnInit(): void {
    // A braid history the source could not answer is an error with its
    // reason, not an empty history.
    this.request = this.api.getWildkinBraids$().pipe(
      map((data): BloodlinesViewModel => ({ kind: 'ready', braids: data.braids })),
      catchError((error) => of<BloodlinesViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); this.state.complete(); }
}
