import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, startWith } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  ExplorerAssetAction,
  ExplorerAssetRef,
  ExplorerNotableSat,
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
    if (!flow.complete) {
      if (flow.unknownAttachmentCount > 0) {
        return $localize`:@@universe.flow.incomplete-count:Evidence incomplete: ${flow.unknownAttachmentCount}:count: outpoints unresolved`;
      }
      // Say which side is proven when the only gap is discarded inventory.
      if (this.limitedByCoverage(flow)) {
        return $localize`:@@universe.flow.outputs-proven:Outputs proven, inputs no longer retained by the authority`;
      }
      return $localize`:@@universe.flow.incomplete:Protocol evidence incomplete`;
    }
    return $localize`:@@universe.flow.complete:Complete evidence`;
  }

  evidenceKind(flow: ExplorerTransactionAssetFlow): string {
    if (flow.status === 'mempool-candidate') {
      return 'pending';
    }
    if (!flow.complete) {
      return this.limitedByCoverage(flow) ? 'partial' : 'incomplete';
    }
    return 'complete';
  }

  /** True when the authority answered but keeps no inventory for some outpoint. */
  hasCoverageBoundary(flow: ExplorerTransactionAssetFlow): boolean {
    return (flow.outOfCoverageCount ?? 0) > 0;
  }

  /**
   * True when discarded inventory is the *only* thing left unproven. A real
   * lookup failure alongside it is the more serious fact and must win, so the
   * section never explains an outage as a coverage boundary.
   */
  limitedByCoverage(flow: ExplorerTransactionAssetFlow): boolean {
    return this.hasCoverageBoundary(flow) && flow.unknownAttachmentCount === 0;
  }

  /** Empty state copy: a proven negative reads differently from missing evidence. */
  emptyLabel(flow: ExplorerTransactionAssetFlow): string {
    if (!flow.complete) {
      if (this.limitedByCoverage(flow)) {
        return $localize`:@@universe.flow.empty-outputs-proven:No supported assets on the outputs of this transaction`;
      }
      return $localize`:@@universe.flow.empty-incomplete:Protocol evidence incomplete`;
    }
    return $localize`:@@universe.flow.empty-proven:No supported assets detected on this transaction`;
  }

  /** Explains an empty inputs column without asserting more than is proven. */
  inputsNote(flow: ExplorerTransactionAssetFlow): string {
    if (flow.coinbase) {
      return $localize`:@@universe.flow.coinbase:Coinbase transaction: no inputs to spend`;
    }
    if (this.limitedByCoverage(flow)) {
      return $localize`:@@universe.flow.inputs-out-of-coverage:The asset authority keeps no inventory for outputs that have already been spent, so what these inputs carried is not proven here`;
    }
    if (flow.complete) {
      return $localize`:@@universe.flow.inputs-clean:No supported assets on the inputs`;
    }
    return $localize`:@@universe.flow.inputs-unproven:Input evidence incomplete: the authority no longer retains what these inputs carried`;
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

  /**
   * One or two sentences that a reader with no protocol knowledge can act on.
   *
   * The rule the whole product rests on applies here more than anywhere: this
   * never says "sold", "bought", or "traded", because the authority proves what
   * moved, not why. It describes actions the authority reported and counts
   * positions it proved, and nothing else.
   */
  plainSummary(flow: ExplorerTransactionAssetFlow): string {
    if (flow.coinbase) {
      return $localize`:@@universe.flow.summary-coinbase:This is the coinbase transaction that pays the miner. It has no inputs to spend.`;
    }

    const actionCounts = new Map<string, number>();
    for (const action of flow.actions ?? []) {
      if (!action?.actionType) {continue;}
      actionCounts.set(action.actionType, (actionCounts.get(action.actionType) ?? 0) + 1);
    }

    const outputs = flow.outputs?.length ?? 0;
    const inputs = flow.inputs?.length ?? 0;

    let core: string;
    if (actionCounts.size > 0) {
      const phrases = [...actionCounts.entries()].map(
        ([type, count]) => `${count} ${this.actionLabel({ actionType: type } as ExplorerAssetAction).toLowerCase()}`,
      );
      core = $localize`:@@universe.flow.summary-actions:The asset authority reports ${phrases.join(', ')}:actions: in this transaction.`;
    } else if (outputs > 0) {
      core = $localize`:@@universe.flow.summary-positions:This transaction places assets on ${outputs}:outputs: of its outputs. The authority reported no named protocol action for them.`;
    } else if (inputs > 0) {
      core = $localize`:@@universe.flow.summary-inputs-only:This transaction spends outputs that carried assets. The authority reported nothing attached to its outputs.`;
    } else if (flow.complete) {
      core = $localize`:@@universe.flow.summary-none:No supported protocol asset is involved in this transaction.`;
    } else {
      core = $localize`:@@universe.flow.summary-unproven:What this transaction does with protocol assets is not proven here.`;
    }

    if (flow.status === 'mempool-candidate') {
      return core + ' ' + $localize`:@@universe.flow.summary-pending:It is still waiting in the mempool, so this can change if it is replaced.`;
    }
    if (flow.status === 'replaced') {
      return core + ' ' + $localize`:@@universe.flow.summary-replaced:It was replaced by another transaction and will not confirm as it stands.`;
    }
    if (flow.status === 'orphaned') {
      return core + ' ' + $localize`:@@universe.flow.summary-orphaned:The block that contained it is no longer part of the chain.`;
    }
    return core;
  }

  /** Route to the dedicated page for the output a position sits on. */
  outpointRoute(position: ExplorerOutpointPosition): string[] | null {
    const outpoint = position?.outpoint;
    if (typeof outpoint !== 'string') {return null;}
    const separator = outpoint.lastIndexOf(':');
    if (separator !== 64) {return null;}
    return ['/outpoint', outpoint.slice(0, 64), outpoint.slice(65)];
  }

  /** Notable sats are the substance of a rare_sats position, not decoration. */
  notableSats(position: ExplorerOutpointPosition): ExplorerNotableSat[] {
    return position.notableSats ?? [];
  }

  rarityLabel(sat: ExplorerNotableSat): string {
    switch (sat.rarity) {
      case 'mythic': return $localize`:@@universe.rarity.mythic:Mythic`;
      case 'legendary': return $localize`:@@universe.rarity.legendary:Legendary`;
      case 'epic': return $localize`:@@universe.rarity.epic:Epic`;
      case 'rare': return $localize`:@@universe.rarity.rare:Rare`;
      case 'uncommon': return $localize`:@@universe.rarity.uncommon:Uncommon`;
      default: return sat.rarity;
    }
  }

  /** Why this sat is notable, stated as the rule that makes it so. */
  rarityReason(sat: ExplorerNotableSat): string {
    switch (sat.rarity) {
      case 'mythic':
        return $localize`:@@universe.rarity.reason-mythic:The first satoshi of the genesis block`;
      case 'legendary':
        return $localize`:@@universe.rarity.reason-legendary:The first satoshi of a cycle, at block ${sat.heightAtomic}:height:`;
      case 'epic':
        return $localize`:@@universe.rarity.reason-epic:The first satoshi of a halving epoch, at block ${sat.heightAtomic}:height:`;
      case 'rare':
        return $localize`:@@universe.rarity.reason-rare:The first satoshi of a difficulty period, at block ${sat.heightAtomic}:height:`;
      case 'uncommon':
        return $localize`:@@universe.rarity.reason-uncommon:The first satoshi of block ${sat.heightAtomic}:height:`;
      default:
        return '';
    }
  }

  trackNotableSat(index: number, sat: ExplorerNotableSat): string {
    return sat.satAtomic;
  }

  assetLabel(asset: ExplorerAssetRef | undefined): string {
    if (!asset) {
      return '';
    }
    if (asset.protocolId === 'rare_sats') {
      return $localize`:@@universe.flow.rare-sats:Rare sats`;
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
