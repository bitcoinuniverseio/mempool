import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, startWith } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  ExplorerAssetAction,
  ExplorerAssetRef,
  ExplorerOutpointPosition,
  ExplorerProtocolDefinition,
  ExplorerTransactionAssetFlow,
} from '@app/universe/universe.types';

type FlowStateKind = 'loading' | 'flow' | 'unconfigured' | 'error';

export interface FlowViewState {
  kind: FlowStateKind;
  flow?: ExplorerTransactionAssetFlow;
}

@Component({
  selector: 'app-universe-asset-flow',
  templateUrl: './asset-flow.component.html',
  styleUrls: ['./asset-flow.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AssetFlowComponent implements OnChanges {
  @Input() txid: string;

  state$: Observable<FlowViewState>;

  private badgeCache = new Map<string, ExplorerProtocolDefinition>();

  constructor(private universeApiService: UniverseApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.txid || !this.txid) {
      return;
    }
    this.state$ = this.universeApiService.getTransactionFlow$(this.txid).pipe(
      map((flow): FlowViewState => ({ kind: 'flow', flow })),
      catchError((error: HttpErrorResponse) => {
        const body = error?.error;
        const code = body && typeof body === 'object' ? body.error : null;
        if (error?.status === 503 || code === 'bitcoin-authority-unconfigured') {
          return of<FlowViewState>({ kind: 'unconfigured' });
        }
        return of<FlowViewState>({ kind: 'error' });
      }),
      startWith<FlowViewState>({ kind: 'loading' }),
    );
  }

  /** Truthful evidence chip for the whole section. */
  evidenceLabel(flow: ExplorerTransactionAssetFlow): string {
    if (flow.status === 'mempool-candidate') {
      return $localize`:@@universe.flow.pending:Awaiting confirmation for complete protocol analysis`;
    }
    if (flow.complete) {
      return $localize`:@@universe.flow.complete:Complete evidence`;
    }
    if (flow.unknownAttachmentCount > 0) {
      return $localize`:@@universe.flow.incomplete-count:Evidence incomplete: ${flow.unknownAttachmentCount}:count: outpoints unresolved`;
    }
    return $localize`:@@universe.flow.incomplete:Protocol evidence incomplete`;
  }

  evidenceKind(flow: ExplorerTransactionAssetFlow): string {
    if (flow.status === 'mempool-candidate') {
      return 'pending';
    }
    return flow.complete ? 'complete' : 'incomplete';
  }

  /** Empty state copy: a proven negative reads differently from missing evidence. */
  emptyLabel(flow: ExplorerTransactionAssetFlow): string {
    return flow.complete
      ? $localize`:@@universe.flow.empty-proven:No supported assets detected on this transaction`
      : $localize`:@@universe.flow.empty-incomplete:Protocol evidence incomplete`;
  }

  /** Explains an empty inputs column without asserting more than is proven. */
  inputsNote(flow: ExplorerTransactionAssetFlow): string {
    if (flow.coinbase) {
      return $localize`:@@universe.flow.coinbase:Coinbase transaction: no inputs to spend`;
    }
    if (flow.complete) {
      return $localize`:@@universe.flow.inputs-clean:No supported assets on the inputs`;
    }
    return $localize`:@@universe.flow.inputs-unproven:Input evidence incomplete: the authority cannot prove what these inputs carried`;
  }

  isEmpty(flow: ExplorerTransactionAssetFlow): boolean {
    return !flow.inputs?.length && !flow.outputs?.length;
  }

  /**
   * Minimal badge descriptor. Protocol display names come from the registry
   * elsewhere; here the id is the truthful label without inventing metadata.
   */
  badgeFor(protocolId: string): ExplorerProtocolDefinition {
    if (!this.badgeCache.has(protocolId)) {
      this.badgeCache.set(protocolId, {
        id: protocolId,
        shortName: protocolId,
        displayName: protocolId,
        visualToken: protocolId,
      } as ExplorerProtocolDefinition);
    }
    return this.badgeCache.get(protocolId);
  }

  assetLabel(asset: ExplorerAssetRef | undefined): string {
    if (!asset) {
      return '';
    }
    if (asset.displayName) {
      return asset.displayName;
    }
    if (asset.ticker) {
      return asset.ticker;
    }
    const id = asset.canonicalAssetId ?? '';
    if (asset.assetKind === 'inscription' && id.length > 20) {
      return id.slice(0, 8) + '…' + id.slice(-3);
    }
    return id.length > 24 ? id.slice(0, 12) + '…' + id.slice(-6) : id;
  }

  shortAddress(address: string | undefined): string {
    if (!address) {
      return '';
    }
    return address.length > 20
      ? address.slice(0, 8) + '…' + address.slice(-6)
      : address;
  }

  evidenceTitle(position: ExplorerOutpointPosition): string {
    const authority = position.evidence?.authorityId ?? 'unknown';
    const coverage = position.evidence?.coverage ?? 'unknown';
    return $localize`:@@universe.flow.evidence-title:Authority ${authority}:authority:, coverage ${coverage}:coverage:`;
  }

  /** Positions whose authority cannot prove absence are visually marked. */
  isPartialEvidence(position: ExplorerOutpointPosition): boolean {
    return position.evidence?.coverage !== 'complete';
  }

  /** Assets present on both sides share an accent so the movement is readable. */
  isTransferred(position: ExplorerOutpointPosition, flow: ExplorerTransactionAssetFlow): boolean {
    return (flow.actions ?? []).some(
      (action) =>
        action.actionType === 'transfer' &&
        action.asset?.canonicalAssetId === position.asset?.canonicalAssetId,
    );
  }

  accentClass(position: ExplorerOutpointPosition, flow: ExplorerTransactionAssetFlow): string {
    return this.isTransferred(position, flow) ? 'transferred' : '';
  }

  actionLabel(action: ExplorerAssetAction): string {
    switch (action.actionType) {
      case 'transfer': return $localize`:@@universe.action.transfer:Transfer`;
      case 'mint': return $localize`:@@universe.action.mint:Mint`;
      case 'etch': return $localize`:@@universe.action.etch:Etch`;
      case 'deploy': return $localize`:@@universe.action.deploy:Deploy`;
      case 'inscribe': return $localize`:@@universe.action.inscribe:Inscribe`;
      case 'burn': return $localize`:@@universe.action.burn:Burn`;
      case 'register': return $localize`:@@universe.action.register:Register`;
      case 'update': return $localize`:@@universe.action.update:Update`;
      default: return action.actionType;
    }
  }

  stateLabel(position: ExplorerOutpointPosition): string {
    switch (position.state) {
      case 'spent': return $localize`:@@universe.state.spent:Spent`;
      case 'pending': return $localize`:@@universe.state.pending:Pending`;
      case 'burned': return $localize`:@@universe.state.burned:Burned`;
      case 'invalidated': return $localize`:@@universe.state.invalidated:Invalidated`;
      case 'unknown': return $localize`:@@universe.state.unknown:Unknown`;
      default: return '';
    }
  }

  trackPosition(index: number, position: ExplorerOutpointPosition): string {
    return position.outpoint + ':' + (position.asset?.canonicalAssetId ?? index);
  }

  trackAction(index: number, action: ExplorerAssetAction): string {
    return action.eventId ?? String(index);
  }
}
