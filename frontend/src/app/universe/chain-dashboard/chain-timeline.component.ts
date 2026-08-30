import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { ThemeService } from '@app/services/theme.service';
import {
  CandidateCubeReading,
  cubeGradient,
} from '@app/universe/multichain-explorer/candidate-buckets';
import {
  ChainTimelineReading,
  TimelineConfirmedCube,
  TimelineFutureSlot,
} from '@app/universe/chain-dashboard/chain-timeline';
import { ExplorerChain } from '@app/universe/universe.types';

/**
 * The horizontal block strip: upcoming target slots on one side of the
 * divider, recent confirmed blocks on the other, one cube per block or
 * slot, its height above it. The time-direction toggle flips the whole
 * strip, reusing the same preference stream the Bitcoin strip honors so
 * the direction cannot differ between chains.
 */
@Component({
  selector: 'app-chain-timeline',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './chain-timeline.component.html',
  styleUrls: ['./chain-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainTimelineComponent {
  @Input() chain: Exclude<ExplorerChain, 'bitcoin'>;
  @Input() reading: ChainTimelineReading | null = null;
  @Input() loading = false;
  /** The ticker the confirmed cubes' fee totals are stated in. */
  @Input() ticker = '';

  readonly timeLtr$: BehaviorSubject<boolean>;

  constructor(
    private readonly stateService: StateService,
    private readonly theme: ThemeService
  ) {
    this.timeLtr$ = this.stateService.timeLtr;
  }

  toggleDirection(): void {
    this.stateService.timeLtr.next(!this.stateService.timeLtr.value);
  }

  /**
   * Future slots in visual order for the default right-to-left time flow:
   * the furthest slot at the outer edge, the next slot beside the divider.
   */
  get futureDisplay(): readonly TimelineFutureSlot[] {
    return this.reading ? [...this.reading.future].reverse() : [];
  }

  cubeBackground(cube: CandidateCubeReading): string {
    return cubeGradient(cube, this.theme.mempoolFeeColors);
  }

  confirmedBackground(cube: TimelineConfirmedCube): string {
    const fill = cube.fillPercent;
    return `linear-gradient(to top, var(--u-block-confirmed-from) 0%, var(--u-block-confirmed-from) ${fill}%, var(--u-block-confirmed-empty) ${fill}%, var(--u-block-confirmed-to) 100%)`;
  }

  trackBySlot(_index: number, slot: TimelineFutureSlot): string {
    return slot.height?.exact ?? String(_index);
  }

  trackByBlock(_index: number, cube: TimelineConfirmedCube): string {
    return cube.hash;
  }
}
