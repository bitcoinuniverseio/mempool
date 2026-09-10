import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { StreamManifest } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface LiveStreamViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly message?: string;
  readonly streams?: StreamManifest[];
}

@Component({
  selector: 'app-data-live-stream',
  templateUrl: './data-live-stream.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataLiveStreamComponent implements OnInit {
  private readonly state = new BehaviorSubject<LiveStreamViewModel>({ kind: 'loading' });
  readonly vm$: Observable<LiveStreamViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Universe Live Streams Inspector');
  }

  ngOnInit(): void {
    this.api.getDataCatalog$().subscribe({
      next: (catalog) => {
        this.state.next({ kind: 'ready', streams: catalog.streams });
      },
      // A failed read is an error, not an empty stream registry.
      error: (err) => {
        this.state.next({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(err)) });
      },
    });
  }
}
