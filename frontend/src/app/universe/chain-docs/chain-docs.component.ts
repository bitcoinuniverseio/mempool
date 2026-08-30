import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
} from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Observable, map, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import {
  ChainProfile,
  chainProfile,
} from '@app/universe/multichain-explorer/multichain-view';
import {
  DocsSection,
  docsSectionsFor,
} from '@app/universe/chain-docs/chain-docs-content';
import { ExplorerChain } from '@app/universe/universe.types';

/**
 * The chain docs page: every section rendered on one page so deep links and
 * find-in-page both work, with a sidebar that names the sections and a route
 * segment that scrolls to one.
 */
@Component({
  selector: 'app-chain-docs',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './chain-docs.component.html',
  styleUrls: ['./chain-docs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainDocsComponent implements OnInit {
  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly profile: ChainProfile;
  readonly sections: readonly DocsSection[];

  /** The section the URL names, or null on the plain /docs route. */
  activeSection$: Observable<string | null>;

  navOpen = false;

  constructor(
    router: Router,
    private readonly route: ActivatedRoute,
    private readonly seo: SeoService
  ) {
    this.chain =
      router.url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] === 'dogecoin'
        ? 'dogecoin'
        : 'zcash';
    this.profile = chainProfile(this.chain);
    this.sections = docsSectionsFor(this.chain);
  }

  ngOnInit(): void {
    this.seo.setTitle(
      $localize`:@@universe.docs.title:${this.profile.name}:CHAIN: explorer docs`
    );
    this.seo.setDescription(
      $localize`:@@universe.docs.meta:What the ${this.profile.name}:CHAIN: explorer shows, where each reading comes from, and how to use its API.`
    );
    this.activeSection$ = this.route.paramMap.pipe(
      map((params) => {
        const section = params.get('section');
        return section && this.sections.some((entry) => entry.id === section)
          ? section
          : null;
      }),
      tap((section) => {
        if (section) {
          this.scrollTo(section);
        }
      })
    );
  }

  toggleNav(): void {
    this.navOpen = !this.navOpen;
  }

  closeNav(): void {
    this.navOpen = false;
  }

  trackById(_index: number, section: DocsSection): string {
    return section.id;
  }

  /**
   * Scroll to the section the route names. Deferred a tick so the first
   * render has painted the anchors, and skipped entirely outside a browser.
   */
  private scrollTo(id: string): void {
    if (typeof document === 'undefined') {
      return;
    }
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    });
  }
}
