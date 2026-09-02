import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { NodeOverview } from './node-console.types';
import {
  bytes,
  chainHealth,
  duration,
  HealthLine,
  mempoolFullness,
  PeerBalance,
  peerBalance,
  percent,
  policyLines,
  round,
  sectionsAnswered,
} from './node-view';

/** How often the page reloads while it is open. */
const REFRESH_MS = 15_000;

/**
 * What the node serving this explorer actually is.
 *
 * Every section reports its own state, so a node that answers about its
 * chain but not its peers gives a page with the chain on it and a stated
 * reason where the peers would be. That is the point of the page: an
 * explorer that will not say what it is running is asking to be trusted for
 * no reason.
 *
 * No address appears anywhere here. A peer's location is this node's
 * topology, and the server removes it before the counts are built.
 */
@Component({
  selector: 'app-node-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './node-overview.component.html',
  styleUrls: ['./node-console.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeOverviewComponent implements OnInit, OnDestroy {
  overview: NodeOverview | null = null;
  health: HealthLine | null = null;
  policy: string[] = [];
  balance: PeerBalance | null = null;
  fullness: number | null = null;
  answered = { ready: 0, total: 0 };
  error: string | null = null;
  loading = true;

  private subscription: Subscription | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@node.overview.title:This node`);
    this.subscription = timer(0, REFRESH_MS)
      .pipe(switchMap(() => this.api.getNodeOverview$()))
      .subscribe({
        next: (overview) => {
          this.overview = overview;
          this.health = chainHealth(overview.chain);
          this.policy = policyLines(overview.mempool);
          this.balance = peerBalance(overview.peers);
          this.fullness = mempoolFullness(overview.mempool);
          this.answered = sectionsAnswered(overview);
          this.error = null;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: () => {
          this.loading = false;
          // The overview answers even when every section is silent, so a
          // failure here is the route itself being unreachable.
          this.error = $localize`:@@node.overview.failed:This explorer could not reach its own backend to ask.`;
          this.cd.markForCheck();
        },
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  size(value: number | null): string {
    return bytes(value);
  }

  ago(seconds: number | null): string {
    return duration(seconds);
  }

  ratio(value: number): string {
    return percent(value);
  }

  rate(value: number): string {
    return round(value);
  }

  trackByIndex(index: number): number {
    return index;
  }

  trackByName(_index: number, entry: { name: string }): string {
    return entry.name;
  }

  trackByNetwork(_index: number, entry: { network: string }): string {
    return entry.network;
  }

  trackBySubversion(_index: number, entry: { subversion: string }): string {
    return entry.subversion;
  }
}
