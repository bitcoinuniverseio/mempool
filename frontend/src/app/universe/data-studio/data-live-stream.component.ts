import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { DataStudioApiService } from './data-studio-api.service';
@Component({
  selector: 'app-data-live-stream',
  templateUrl: './data-live-stream.component.html',
  styleUrls: ['../product-page.scss', './data-studio.component.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataLiveStreamComponent implements OnInit, OnDestroy {
  private state = new BehaviorSubject<any>({ kind: 'loading', events: [], connection: 'disconnected' });
  readonly vm$ = this.state.asObservable();
  private read?: Subscription;
  private stream?: Subscription;
  constructor(
    @Inject(DataStudioApiService) private api: DataStudioApiService,
    @Inject(SeoService) private seo: SeoService
  ) {
    seo.setTitle('Owned Data Snapshot Stream Inspector');
  }
  ngOnInit() {
    this.read = this.api.watchCatalog$().subscribe((catalog) => {
      this.disconnect();
      this.state.next({ ...catalog, events: [], connection: 'disconnected' });
    });
  }
  connect() {
    this.disconnect();
    this.state.next({ ...this.state.value, connection: 'connecting', streamError: null });
    this.stream = this.api.stream$().subscribe({
      next: (row) => {
        const current = this.state.value;
        if (row.kind === 'event') {
          const events = [...current.events.filter((e) => e.id !== row.event.id), row.event].slice(-20);
          this.state.next({ ...current, events, connection: 'connected' });
        } else this.state.next({ ...current, connection: row.kind, streamError: row.message ?? null });
      },
      error: (e) =>
        this.state.next({
          ...this.state.value,
          connection: 'disconnected',
          streamError: e.message ?? 'Owned event source unavailable.',
        }),
    });
  }
  disconnect() {
    this.stream?.unsubscribe();
    this.stream = undefined;
    this.state.next({ ...this.state.value, connection: 'disconnected' });
  }
  ngOnDestroy() {
    this.disconnect();
    this.read?.unsubscribe();
  }
}
