import { Routes } from '@angular/router';

/**
 * The ANIMA Evidence Explorer.
 *
 * The landing page lives in the common protocol shell at
 * /protocols/anima, which reads the registry like every other protocol.
 * These routes are the specialized surfaces the protocol's own evidence
 * needs: the logged transition list, one transition, the organism list,
 * one organism, and one organism's history.
 */
export const ANIMA_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'transitions',
  },
  {
    path: 'transitions',
    loadComponent: () => import('./anima-transitions.component').then(m => m.AnimaTransitionsComponent),
    data: { networks: ['bitcoin'] },
  },
  {
    path: 'events',
    loadComponent: () => import('./anima-transitions.component').then(m => m.AnimaTransitionsComponent),
    data: { networks: ['bitcoin'] },
  },
  {
    path: 'event/:eventId',
    loadComponent: () => import('./anima-transition.component').then(m => m.AnimaTransitionComponent),
    data: { networks: ['bitcoin'] },
  },
  {
    path: 'items',
    loadComponent: () => import('./anima-items.component').then(m => m.AnimaItemsComponent),
    data: { networks: ['bitcoin'] },
  },
  {
    path: 'item/:itemId',
    loadComponent: () => import('./anima-item.component').then(m => m.AnimaItemComponent),
    data: { networks: ['bitcoin'] },
  },
  {
    path: 'item/:itemId/history',
    loadComponent: () => import('./anima-item-history.component').then(m => m.AnimaItemHistoryComponent),
    data: { networks: ['bitcoin'] },
  },
];
