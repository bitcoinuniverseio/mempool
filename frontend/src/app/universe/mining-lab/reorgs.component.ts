import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { ApiService } from '@app/services/api.service';
import { StaleTip } from '@interfaces/node-api.interface';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { toDisplacementViews, DisplacementView } from '@app/shared/chain-tips-view';

/**
 * The reorg module, over what one node actually saw.
 *
 * A reorg is only ever a fact relative to a witness. This node watched
 * certain tips lose to other tips, and each entry here pairs the stale
 * block with the winning block that displaced it and the moment that
 * happened. What the node did not see is not extrapolated: a quiet list
 * means no displacement was observed, not that reorgs are impossible.
 */
@Component({
  selector: 'app-universe-mining-reorgs',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
    templateUrl: './reorgs.component.html',
    styleUrls: ['./mining-lab.styles.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReorgsComponent {
  private readonly api = inject(ApiService);

  readonly staleTips$: Observable<readonly DisplacementView[] | null> = this.api.getStaleTips$().pipe(
    map((tips) => toDisplacementViews(tips ?? [])),
    catchError(() => of(null)),
  );
}
