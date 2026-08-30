import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { SeoService } from '@app/services/seo.service';
import {
  CHART_CONFIGS,
  CHART_ROUTE_CHILDREN,
} from '@app/universe/chain-graphs/chain-chart-config';
import {
  ChainProfile,
  chainProfile,
} from '@app/universe/multichain-explorer/multichain-view';
import { CHAIN_GRAPH_CHILDREN } from '@app/universe/universe-chart-registry';
import { ExplorerChain } from '@app/universe/universe.types';

interface GraphNavLink {
  readonly path: string[];
  readonly label: string;
}

interface GraphNavGroup {
  readonly id: string;
  readonly label: string;
  readonly links: readonly GraphNavLink[];
}

/**
 * The graphs section shell: the heading, the chart navigation, and an outlet
 * the chart pages render into. The navigation is built from the chart
 * registry, so a chart the registry stops promising for this chain drops out
 * of the navigation without anyone editing this component.
 */
@Component({
  selector: 'app-chain-graphs',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './chain-graphs.component.html',
  styleUrls: ['./chain-graphs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainGraphsComponent implements OnInit {
  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly profile: ChainProfile;
  readonly navGroups: readonly GraphNavGroup[];

  constructor(
    router: Router,
    private readonly seo: SeoService
  ) {
    this.chain =
      router.url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] === 'dogecoin'
        ? 'dogecoin'
        : 'zcash';
    this.profile = chainProfile(this.chain);
    this.navGroups = this.buildNav();
  }

  ngOnInit(): void {
    this.seo.setTitle(
      $localize`:@@universe.graphs.title:${this.profile.name}:CHAIN: charts`
    );
    this.seo.setDescription(
      $localize`:@@universe.graphs.meta:${this.profile.name}:CHAIN: mempool and mining history charts, from Bitcoin Universe's own collector.`
    );
  }

  private buildNav(): readonly GraphNavGroup[] {
    const mempool: GraphNavLink[] = [];
    const mining: GraphNavLink[] = [];
    for (const child of CHAIN_GRAPH_CHILDREN[this.chain]) {
      const mounted = CHART_ROUTE_CHILDREN.find((entry) => entry.path === child);
      if (!mounted) {
        continue;
      }
      const label = mounted.chart
        ? CHART_CONFIGS[mounted.chart].title
        : $localize`:@@universe.graphs.nav-pools:Mining pools`;
      const link: GraphNavLink = {
        path: ['/', this.chain, 'graphs', ...child.split('/')],
        label,
      };
      (child.startsWith('mining/') ? mining : mempool).push(link);
    }
    return [
      {
        id: 'mempool',
        label: $localize`:@@universe.graphs.group-mempool:Mempool`,
        links: mempool,
      },
      {
        id: 'mining',
        label: $localize`:@@universe.graphs.group-mining:Mining`,
        links: mining,
      },
    ];
  }

  trackByGroup(_index: number, group: GraphNavGroup): string {
    return group.id;
  }

  trackByLink(_index: number, link: GraphNavLink): string {
    return link.path.join('/');
  }
}
