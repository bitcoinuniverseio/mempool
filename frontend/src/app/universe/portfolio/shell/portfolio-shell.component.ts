/**
 * The shared Portfolio Intelligence shell: identity, section navigation,
 * privacy control, refresh, and account scope. It stays visually stable
 * while data refreshes and keeps technical details out of the header.
 */

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';

@Component({
  selector: 'app-portfolio-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell" [class.privacy]="session.valuesHidden()">
      <header class="shell-header">
        <div class="identity">
          <button
            type="button"
            class="selector"
            (click)="selectorOpen.set(!selectorOpen())"
            aria-haspopup="listbox"
            [attr.aria-expanded]="selectorOpen()"
            i18n="@@universe.portfolio.shell.select-portfolio"
          >
            <span class="accent" aria-hidden="true">◆</span>
            <strong>{{ store.activePortfolio()?.name || 'Portfolio' }}</strong>
            <span class="caret" aria-hidden="true">▾</span>
          </button>
          @if (selectorOpen()) {
            <ul class="selector-menu" role="listbox" (focusout)="selectorOpen.set(false)">
              @for (portfolio of store.livePortfolios(); track portfolio.id) {
                <li role="option" [attr.aria-selected]="portfolio.id === store.activePortfolioId()">
                  <a [routerLink]="['/portfolio/p', portfolio.id, 'overview']" (click)="selectorOpen.set(false)">
                    {{ portfolio.name }}
                  </a>
                </li>
              }
              <li><a routerLink="/portfolio/manage" i18n="@@universe.portfolio.shell.manage">Manage portfolios…</a></li>
              <li><a routerLink="/portfolio/new" i18n="@@universe.portfolio.shell.new">New portfolio…</a></li>
            </ul>
          }
        </div>

        <nav class="sections" aria-label="Portfolio sections" i18n-aria-label="@@universe.portfolio.shell.sections-label">
          @for (section of sections; track section.path) {
            <a
              [routerLink]="['/portfolio/p', portfolioId(), section.path]"
              class="section-link"
              [class.active]="session.activeSection() === section.path"
              [attr.aria-current]="session.activeSection() === section.path ? 'page' : null"
            >
              {{ section.label }}
            </a>
          }
        </nav>

        <div class="controls">
          <span class="state-chip">
            @if (store.activePortfolio(); as portfolio) {
              <app-portfolio-data-state [state]="data().aggregation?.state ?? 'pending'" />
            }
          </span>
          <button
            type="button"
            class="control"
            (click)="session.cyclePrivacy()"
            [attr.aria-pressed]="session.valuesHidden()"
            i18n="@@universe.portfolio.shell.privacy"
          >
            {{ session.valuesHidden() ? 'Privacy on' : 'Privacy' }}
          </button>
          <button
            type="button"
            class="control"
            (click)="refresh()"
            [disabled]="data().loading"
            i18n="@@universe.portfolio.shell.refresh"
          >
            {{ data().loading ? 'Refreshing…' : 'Refresh' }}
          </button>
          <button type="button" class="control" (click)="session.lockNow()" i18n="@@universe.portfolio.shell.lock">Lock</button>
        </div>
      </header>

      @if (data().loading && data().aggregation) {
        <div class="refresh-strip" role="status" i18n="@@universe.portfolio.shell.refreshing-hint">
          Refreshing - showing the snapshot from {{ completedAtLabel() }}.
        </div>
      }

      <main class="shell-main">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [
    `
      .shell { display: flex; flex-direction: column; min-height: 60vh; gap: 8px; }
      .shell-header {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        padding: 10px 4px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.08));
        position: relative;
      }
      .identity { position: relative; }
      .selector {
        display: inline-flex; align-items: center; gap: 6px;
        background: transparent; border: none; cursor: pointer; padding: 6px 8px;
        border-radius: 8px; font-size: 15px; min-height: 44px;
      }
      .selector:hover { background: var(--u-surface-raised, rgba(0,0,0,0.04)); }
      .accent { color: var(--u-brand, var(--u-primary, inherit)); }
      .caret { font-size: 10px; opacity: 0.6; }
      .selector-menu {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 30;
        min-width: 220px; background: var(--u-surface, #fff);
        border: 1px solid var(--u-separator, rgba(0,0,0,0.1)); border-radius: 10px;
        padding: 6px; margin: 0; list-style: none; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      }
      .selector-menu a { display: block; padding: 8px 10px; border-radius: 6px; min-height: 44px; display: flex; align-items: center; }
      .selector-menu a:hover { background: var(--u-surface-raised, rgba(0,0,0,0.05)); }
      .sections { display: flex; gap: 2px; flex-wrap: wrap; flex: 1; }
      .section-link {
        padding: 8px 12px; border-radius: 8px; font-size: 13.5px; min-height: 44px;
        display: inline-flex; align-items: center; color: var(--u-fg-soft, inherit);
      }
      .section-link.active {
        background: var(--u-selected-bg, rgba(196, 0, 89, 0.09));
        color: var(--u-brand, var(--u-primary, inherit)); font-weight: 600;
      }
      .controls { display: flex; gap: 6px; align-items: center; }
      .control {
        min-height: 36px; padding: 4px 12px; border-radius: 8px;
        border: 1px solid var(--u-separator, rgba(0,0,0,0.12)); background: transparent;
        font-size: 12.5px; cursor: pointer;
      }
      .control:hover:not(:disabled) { background: var(--u-surface-raised, rgba(0,0,0,0.05)); }
      .control[aria-pressed='true'] { border-color: var(--u-brand, var(--u-primary, inherit)); color: var(--u-brand, var(--u-primary, inherit)); }
      .refresh-strip {
        font-size: 12px; color: var(--u-fg-soft, inherit);
        background: var(--u-partial-bg, rgba(180,120,0,0.06));
        border-radius: 6px; padding: 4px 10px;
      }
      .shell-main { flex: 1; padding-top: 8px; }
      .privacy .control[aria-pressed='true'] { background: rgba(196, 0, 89, 0.08); }
      @media (max-width: 767px) {
        .shell-header { flex-direction: column; align-items: stretch; }
        .sections { overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; }
        .section-link { flex: 0 0 auto; }
      }
    `,
  ],
})
export class PortfolioShellComponent {
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  private readonly dataService = inject(PortfolioDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly portfolioIdSignal = signal<string>('');

  readonly selectorOpen = signal(false);
  readonly portfolioId = this.portfolioIdSignal.asReadonly();
  readonly data = this.dataService.state;
  readonly completedAtLabel = computed(() => {
    const at = this.data().completedAt;
    return at === null ? '-' : new Date(at).toLocaleString();
  });

  readonly sections = [
    { path: 'overview', label: $localize`:@@universe.portfolio.section.overview:Overview` },
    { path: 'holdings', label: $localize`:@@universe.portfolio.section.holdings:Holdings` },
    { path: 'activity', label: $localize`:@@universe.portfolio.section.activity:Activity` },
    { path: 'performance', label: $localize`:@@universe.portfolio.section.performance:Performance` },
    { path: 'utxos', label: $localize`:@@universe.portfolio.section.utxos:UTXOs` },
    { path: 'insights', label: $localize`:@@universe.portfolio.section.insights:Insights` },
  ];

  constructor() {
    this.portfolioIdSignal.set(
      this.route.snapshot.parent?.paramMap.get('portfolioId') ??
        this.route.snapshot.paramMap.get('portfolioId') ??
        '',
    );
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        map(() => {
          const segments = this.router.url.split('?')[0].split('/');
          const index = segments.indexOf('p');
          return index >= 0 && segments.length > index + 2 ? segments[index + 2] : 'overview';
        }),
      )
      .subscribe((section) => this.session.setSection(section));
    const portfolio = this.store.activePortfolio();
    if (portfolio !== null) {
      void this.dataService.loadPortfolio(portfolio);
    }
  }

  refresh(): void {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) return;
    void this.dataService.loadPortfolio(portfolio);
  }
}
