import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { BackendInfo } from '@app/universe/universe.types';

const UPSTREAM_BASE = {
  repository: 'https://github.com/mempool/mempool',
  release: 'v3.3.1',
  commit: '9332d9db97bcc7beed079acc8f79aa21c9b12a3b',
};

const FORK_REPOSITORY = 'https://github.com/bitcoinuniverseio/mempool';

@Component({
  selector: 'app-source-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './source-page.component.html',
  styleUrls: ['./source-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcePageComponent implements OnInit {
  upstream = UPSTREAM_BASE;
  forkRepository = FORK_REPOSITORY;
  backendInfo$: Observable<BackendInfo | null>;

  constructor(
    private universeApiService: UniverseApiService,
    private seo: SeoService,
  ) {
    this.backendInfo$ = this.universeApiService
      .getBackendInfo$()
      .pipe(catchError(() => of(null)));
  }

  ngOnInit(): void {
    this.seo.setTitle('Source and licenses');
  }

  releaseUrl(commit: string): string {
    return `${FORK_REPOSITORY}/tree/${commit}`;
  }
}
