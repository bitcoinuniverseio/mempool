import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, startWith } from 'rxjs';
import { Utxo } from '@interfaces/electrs.interface';
import {
  UniverseApiService,
  UNIVERSE_OUTPOINT_BATCH_LIMIT,
} from '@app/universe/universe-api.service';
import {
  ExplorerOutpointPosition,
  OutpointEnrichment,
} from '@app/universe/universe.types';
import {
  formatAtomicAmount,
  shortenIdentifier,
} from '@app/universe/universe-evidence';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * Outputs resolved per address view. Two batches is enough to cover almost
 * every address a person actually reads, and it keeps one page view to two
 * authority requests rather than an unbounded sweep.
 */
const MAXIMUM_RESOLVED_OUTPUTS = UNIVERSE_OUTPOINT_BATCH_LIMIT * 2;

interface ProtocolHolding {
  readonly protocolId: string;
  readonly assetKey: string;
  readonly displayName: string;
  /** Sum across outputs, kept exact as a decimal string. */
  readonly quantityAtomic: string | null;
  readonly outpoints: readonly string[];
}

interface AddressAssetsState {
  readonly kind:
    'loading' | 'ready' | 'unavailable' | 'skipped' | 'source-unavailable';
  readonly reason?: string;
  readonly holdings?: readonly ProtocolHolding[];
  /** Outputs the authority answered for. The denominator for everything shown. */
  readonly resolved?: number;
  /** Outputs this address holds that were not asked about. */
  readonly notResolved?: number;
  /** True when at least one answered output could not be fully accounted for. */
  readonly partial?: boolean;
  readonly checkpointHeight?: string | null;
}

/**
 * The protocol assets an address currently holds.
 *
 * Built from the address's own unspent outputs, resolved through the asset
 * authority one bounded batch at a time. The panel always states how many
 * outputs it covered, because a portfolio that hides its own coverage is
 * indistinguishable from a wrong one.
 */
@Component({
  selector: 'app-universe-address-assets',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  templateUrl: './address-assets.component.html',
  styleUrls: ['./address-assets.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddressAssetsComponent implements OnChanges {
  @Input() utxos: Utxo[] | null = null;
  @Input() sourceState:
    'idle' | 'loading' | 'complete' | 'limit' | 'unavailable' = 'idle';

  state$: Observable<AddressAssetsState>;
  readonly shorten = shortenIdentifier;
  readonly amount = formatAtomicAmount;

  constructor(private api: UniverseApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.utxos && !changes.sourceState) {
      return;
    }
    if (this.sourceState === 'limit' || this.sourceState === 'unavailable') {
      this.state$ = of({
        kind: 'source-unavailable',
        reason:
          this.sourceState === 'limit'
            ? 'The index limits unspent-output lookups to 500 and did not supply a complete list. Protocol holdings are unknown.'
            : 'The unspent-output lookup failed. Protocol holdings are unknown.',
      });
      return;
    }
    if (this.sourceState === 'loading') {
      this.state$ = of({ kind: 'loading' });
      return;
    }
    const utxos = this.utxos;
    if (!Array.isArray(utxos) || utxos.length === 0) {
      this.state$ = of<AddressAssetsState>({ kind: 'skipped' });
      return;
    }

    const references = utxos
      .filter(
        (utxo) =>
          utxo && typeof utxo.txid === 'string' && Number.isInteger(utxo.vout)
      )
      .map((utxo) => `${utxo.txid}:${utxo.vout}`);
    const covered = references.slice(0, MAXIMUM_RESOLVED_OUTPUTS);
    const notResolved = references.length - covered.length;

    const batches: string[][] = [];
    for (
      let index = 0;
      index < covered.length;
      index += UNIVERSE_OUTPOINT_BATCH_LIMIT
    ) {
      batches.push(covered.slice(index, index + UNIVERSE_OUTPOINT_BATCH_LIMIT));
    }

    this.state$ = forkJoin(
      batches.map((batch) => this.api.getOutpoints$(batch))
    ).pipe(
      map((responses): AddressAssetsState => {
        const results = responses.flatMap(
          (response) => response?.results ?? []
        );
        if (results.some((result) => !covered.includes(result?.outpoint)))
          throw Error('Unrelated output evidence.');
        const summary = summarise(results);
        return {
          ...summary,
          partial: summary.partial || summary.resolved !== covered.length,
          notResolved: notResolved + covered.length - summary.resolved,
          kind: 'ready',
        };
      }),
      catchError(() => of<AddressAssetsState>({ kind: 'unavailable' })),
      startWith<AddressAssetsState>({ kind: 'loading' })
    );
  }

  trackByHolding(index: number, holding: ProtocolHolding): string {
    return holding.assetKey;
  }

  outpointRoute(outpoint: string): string[] | null {
    const separator = outpoint.lastIndexOf(':');
    if (separator !== 64) {
      return null;
    }
    return ['/outpoint', outpoint.slice(0, 64), outpoint.slice(65)];
  }
}

/**
 * Folds per-output positions into per-asset holdings.
 *
 * Quantities are summed with BigInt, never with JavaScript numbers: token
 * supplies routinely exceed the safe integer range and a silently rounded
 * balance would be worse than none.
 */
export function summarise(
  results: readonly OutpointEnrichment[]
): Omit<AddressAssetsState, 'kind' | 'notResolved'> {
  const holdings = new Map<
    string,
    {
      protocolId: string;
      displayName: string;
      quantity: bigint | null;
      outpoints: string[];
    }
  >();
  let resolved = 0;
  let partial = false;
  let checkpointHeight: string | null = null;
  let checkpointKey: string | undefined;
  let mixedCheckpoints = false;
  const seen = new Set<string>();

  for (const result of results) {
    if (!result || seen.has(result.outpoint)) {
      partial = true;
      continue;
    }
    seen.add(result.outpoint);
    if (result?.status !== 'ok') {
      partial = true;
      continue;
    }
    resolved += 1;
    if (result.unknownAttachments) {
      partial = true;
    }
    const key = result.checkpoint
      ? JSON.stringify([
          result.checkpoint.chain,
          result.checkpoint.network,
          result.checkpoint.heightAtomic,
          result.checkpoint.blockHash,
          result.checkpoint.reorgEpoch,
        ])
      : 'missing';
    if (checkpointKey !== undefined && checkpointKey !== key) {
      mixedCheckpoints = true;
      partial = true;
    }
    checkpointKey = key;
    if (result.checkpoint?.heightAtomic) {
      checkpointHeight = result.checkpoint.heightAtomic;
    }
    for (const position of result.positions ?? []) {
      if (position.outpoint !== result.outpoint) {
        partial = true;
        continue;
      }
      if (!addPosition(holdings, position)) partial = true;
    }
  }

  const list: ProtocolHolding[] = [...holdings.entries()].map(
    ([assetKey, entry]) => ({
      assetKey,
      protocolId: entry.protocolId,
      displayName: entry.displayName,
      quantityAtomic:
        entry.quantity === null ? null : entry.quantity.toString(),
      outpoints: entry.outpoints,
    })
  );

  list.sort(
    (a, b) =>
      a.protocolId.localeCompare(b.protocolId) ||
      b.outpoints.length - a.outpoints.length ||
      a.displayName.localeCompare(b.displayName)
  );

  return {
    holdings: list,
    resolved,
    partial,
    checkpointHeight: mixedCheckpoints ? null : checkpointHeight,
  };
}

function addPosition(
  holdings: Map<
    string,
    {
      protocolId: string;
      displayName: string;
      quantity: bigint | null;
      outpoints: string[];
    }
  >,
  position: ExplorerOutpointPosition
): boolean {
  const asset = position?.asset;
  if (!asset?.protocolId) {
    return false;
  }
  const assetKey = `${asset.protocolId}:${asset.assetId ?? ''}`;
  if (!holdings.has(assetKey)) {
    holdings.set(assetKey, {
      protocolId: asset.protocolId,
      displayName:
        asset.displayName || asset.ticker || asset.assetId || asset.protocolId,
      quantity: 0n,
      outpoints: [],
    });
  }
  const entry = holdings.get(assetKey);
  if (entry.outpoints.includes(position.outpoint)) {
    entry.quantity = null;
    return false;
  }
  entry.outpoints.push(position.outpoint);
  if (
    position.quantityAtomic &&
    /^(0|[1-9][0-9]{0,999})$/.test(position.quantityAtomic)
  ) {
    if (entry.quantity !== null)
      entry.quantity += BigInt(position.quantityAtomic);
  } else {
    entry.quantity = null;
  }
  return true;
}
