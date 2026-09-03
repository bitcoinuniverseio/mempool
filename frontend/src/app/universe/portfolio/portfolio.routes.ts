/**
 * Portfolio Intelligence routes.
 *
 * Static routes are declared BEFORE the legacy dynamic address route so
 * Angular never reads `new`, `manage`, `settings`, `p`, `share`, or
 * `workspace` as a chain identifier. The legacy
 * `/portfolio/:chain/:network/:address` route renders through the same
 * shared components in ephemeral single-address mode.
 */

import type { Routes } from '@angular/router';

export const PORTFOLIO_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./home/portfolio-home.component').then((m) => m.PortfolioHomeComponent), data: { universe: true } },
  { path: 'new', loadComponent: () => import('./onboarding/onboarding.component').then((m) => m.OnboardingComponent) },
  { path: 'manage', loadComponent: () => import('./accounts/manage-portfolios.component').then((m) => m.ManagePortfoliosComponent) },
  { path: 'settings', loadComponent: () => import('./settings/portfolio-settings.component').then((m) => m.PortfolioSettingsComponent) },
  { path: 'workspace', loadComponent: () => import('./home/workspace-redirect.component').then((m) => m.WorkspaceRedirectComponent) },
  {
    path: 'p/:portfolioId',
    loadComponent: () => import('./shell/portfolio-shell.component').then((m) => m.PortfolioShellComponent),
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', loadComponent: () => import('./home/overview.component').then((m) => m.OverviewComponent) },
      { path: 'holdings', loadComponent: () => import('./holdings/holdings.component').then((m) => m.HoldingsComponent) },
      { path: 'activity', loadComponent: () => import('./activity/activity.component').then((m) => m.ActivityComponent) },
      { path: 'performance', loadComponent: () => import('./performance/performance.component').then((m) => m.PerformanceComponent) },
      { path: 'time-machine', loadComponent: () => import('./time-machine/time-machine.component').then((m) => m.TimeMachineComponent) },
      { path: 'utxos', loadComponent: () => import('./utxos/utxo-center.component').then((m) => m.UtxoCenterComponent) },
      { path: 'insights', loadComponent: () => import('./insights/insights.component').then((m) => m.InsightsComponent) },
      { path: 'sources', loadComponent: () => import('./sources/sources.component').then((m) => m.SourcesComponent) },
      { path: 'reports', loadComponent: () => import('./reports/report-builder.component').then((m) => m.ReportBuilderComponent) },
    ],
  },
  { path: 'share/:shareId', loadComponent: () => import('./share/share-view.component').then((m) => m.ShareViewComponent) },
  {
    // Legacy public single-address route: ephemeral portfolio mode.
    path: ':chain/:network/:address',
    loadComponent: () => import('./home/ephemeral-portfolio.component').then((m) => m.EphemeralPortfolioComponent),
    data: { networks: ['bitcoin'] },
  },
];
