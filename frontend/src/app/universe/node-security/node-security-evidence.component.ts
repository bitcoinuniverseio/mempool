import {
  Component,
  Inject,
  ChangeDetectorRef,
  Input,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { combineLatest, Observable, of, Subscription } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import { NodeSecurityApiService } from './node-security.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
export const securityError = (e: any): string =>
  e?.error?.error ||
  e?.message ||
  'Owned node-security evidence is unavailable.';
@Component({
  selector: 'app-node-security-evidence',
  standalone: true,
  imports: [CommonModule, RouterModule, RelativeUrlPipe],
  templateUrl: './node-security-evidence.component.html',
  styles: [
    'nav { display:flex; flex-wrap:wrap; gap:1rem; margin:1rem 0; } pre { white-space:pre-wrap; overflow-wrap:anywhere; } td,dd { overflow-wrap:anywhere; }',
  ],
})
export class NodeSecurityEvidenceComponent implements OnInit, OnDestroy {
  @Input() view = 'overview';
  @Input() title = 'Node security';
  vm: any = { loading: true };
  exposures: any = null;
  private sub = new Subscription();
  links = [
    ['', 'Overview'],
    ['fleet', 'Fleet'],
    ['advisories', 'Advisories'],
    ['releases', 'Releases'],
    ['artifacts', 'Artifact verification'],
    ['upgrade', 'Upgrade planner'],
    ['configuration', 'Configuration example'],
  ];
  constructor(
    @Inject(NodeSecurityApiService) public api: NodeSecurityApiService,
    @Inject(ActivatedRoute) private route: ActivatedRoute,
    @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef
  ) {}
  ngOnInit(): void {
    this.sub.add(
      combineLatest([this.api.network$, this.route.paramMap])
        .pipe(
          switchMap(([, params]) => {
            this.exposures = null;
            const id = params.get(
              this.view === 'node' ? 'nodeId' : 'advisoryId'
            );
            let request: Observable<any>;
            if (this.view === 'node' || this.view === 'advisory')
              request = id
                ? this.view === 'node'
                  ? this.api.getNode$(id)
                  : this.api.getAdvisory$(id)
                : of(null).pipe(
                    map(() => {
                      throw Error('A record identity is required.');
                    })
                  );
            else
              request =
                this.view === 'fleet'
                  ? this.api.getFleet$()
                  : this.view === 'advisories'
                    ? this.api.getAdvisories$()
                    : this.view === 'releases'
                      ? this.api.getReleases$()
                      : this.view === 'artifacts'
                        ? this.api.getArtifacts$()
                        : this.api.getOverview$();
            return request.pipe(
              map((data) => ({ data, loading: false })),
              catchError((e) =>
                of({ error: securityError(e), loading: false })
              ),
              startWith({ loading: true })
            );
          })
        )
        .subscribe((v) => {
          this.vm = v;
          this.cdr.markForCheck();
        })
    );
    if (this.view === 'node')
      this.sub.add(
        combineLatest([this.api.network$, this.route.paramMap])
          .pipe(
            switchMap(([, params]) => {
              const id = params.get('nodeId');
              return (id ? this.api.getNodeExposures$(id) : of(null)).pipe(
                map((data) => ({ data })),
                catchError((e) => of({ error: securityError(e) })),
                startWith(null)
              );
            })
          )
          .subscribe((v) => {
            this.exposures = v;
            this.cdr.markForCheck();
          })
      );
  }
  display(value: unknown): string {
    return value === null || value === undefined
      ? 'Unknown'
      : typeof value === 'object'
        ? JSON.stringify(value, null, 2)
        : String(value);
  }
  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
