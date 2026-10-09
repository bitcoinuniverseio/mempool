import { Routes } from '@angular/router';
import { ClockComponent } from '@components/clock/clock.component';

/** Existing Clock surface, relative to its Bitcoin network parent. */
export function bitcoinClockRoutes(): Routes {
  return [
    { path: 'clock', pathMatch: 'full', redirectTo: 'clock/mempool/0' },
    { path: 'clock/:mode', pathMatch: 'full', redirectTo: 'clock/:mode/0' },
    { path: 'clock/:mode/:index', component: ClockComponent },
  ];
}
