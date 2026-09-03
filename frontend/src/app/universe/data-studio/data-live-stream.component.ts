import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { StreamManifest } from '@app/universe/universe.types';

interface LiveStreamViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly streams?: StreamManifest[];
}

@Component({
  selector: 'app-data-live-stream',
  templateUrl: './data-live-stream.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
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
    this.api.getDataCatalog$()
      .pipe(catchError(() => of(null)))
      .subscribe((catalog) => {
        if (!catalog) {
          this.state.next({ kind: 'error' });
          return;
        }
        this.state.next({ kind: 'ready', streams: catalog.streams });
      });
  }
}
