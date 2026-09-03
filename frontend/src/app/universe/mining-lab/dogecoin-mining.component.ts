import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { emptyBlockStats, intervalStats } from './mining-analysis';
import { AuxPowResult, ParsedAuxPow, parseAuxPowBlock } from './auxpow-parser';

/**
 * The Dogecoin module, with the AuxPoW proof viewer.
 *
 * The viewer runs entirely in this browser on raw block hexadecimal the
 * visitor supplies. It parses the Dogecoin header, the parent chain's
 * coinbase, the merkle branch, the chain index, and the parent header; it
 * derives both block hashes the way the chains do; and it checks the merge
 * mining commitment, where the coinbase's two pushed hashes must XOR to the
 * Dogecoin header hash. Pool attribution stops at the readable text in the
 * coinbase, shown as text and claimed as nothing.
 */
@Component({
  selector: 'app-universe-dogecoin-mining',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
    templateUrl: './dogecoin-mining.component.html',
    styleUrls: ['./mining-lab.styles.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DogecoinMiningComponent {
  private readonly universeApi = inject(UniverseApiService);

  readonly TARGET_SECONDS = 60;
  readonly rawHex = signal('');
  readonly result = signal<AuxPowResult | null>(null);

  readonly stats$ = this.universeApi.getChainRecentBlocks$('dogecoin', 60).pipe(
    catchError(() => of(null)),
    map((view) => {
      const blocks = (view?.blocks ?? []).map((block) => ({
        height: block.heightAtomic,
        time: Math.floor(Date.parse(block.time) / 1000),
        txCount: Number(block.txCountAtomic),
        sizeBytes: block.sizeBytesAtomic === null ? null : Number(block.sizeBytesAtomic),
        minerName: block.miner?.name ?? null,
      })).filter((block) => Number.isFinite(block.time));
      return {
        intervals: intervalStats(blocks, this.TARGET_SECONDS),
        empty: emptyBlockStats(blocks),
        window: blocks.length,
      };
    }),
  );

  onHexInput(value: string): void {
    this.rawHex.set(value);
  }

  isError(result: AuxPowResult): result is { state: 'error'; message: string } {
    return result.state === 'error';
  }

  isParsed(result: AuxPowResult): result is ParsedAuxPow {
    return result.state === 'parsed';
  }

  parse(): void {
    this.result.set(parseAuxPowBlock(this.rawHex()));
  }
}
