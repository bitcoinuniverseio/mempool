import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { BlockExtended } from '@interfaces/node-api.interface';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { emptyBlockStats, intervalStats, poolShares } from './mining-analysis';

/**
 * The Bitcoin mining module.
 *
 * Recent blocks, measured. The window is thirty blocks and every statistic
 * names it: intervals against the ten minute target, blocks that found only
 * their subsidy, pool shares with unknowns kept visible as unknown. The
 * numbers are descriptive statistics over a stated sample; they are not
 * claims about any pool's private behaviour, and the page does not dress
 * them up as one.
 */

@Component({
  selector: 'app-universe-bitcoin-mining',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
    templateUrl: './bitcoin-mining.component.html',
    styleUrls: ['./mining-lab.styles.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BitcoinMiningComponent {
  private readonly electrsApi = inject(ElectrsApiService);

  readonly WINDOW = 30;
  readonly TARGET_SECONDS = 600;

  readonly stats$ = this.electrsApi.listBlocks$().pipe(
    catchError(() => of<BlockExtended[]>([])),
    map((blocks) => {
      const samples = blocks.slice(0, this.WINDOW).map((block) => ({
        height: String(block.height),
        time: block.timestamp,
        txCount: block.tx_count,
        sizeBytes: block.size ?? null,
        minerName: block.extras?.pool?.name ?? null,
      }));
      return {
        blocks,
        intervals: intervalStats(samples, this.TARGET_SECONDS),
        empty: emptyBlockStats(samples),
        pools: poolShares(samples),
        window: samples.length,
      };
    }),
  );
}
