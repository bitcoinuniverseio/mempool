import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AssetFlowComponent, FlowViewState } from '@app/universe/asset-flow/asset-flow.component';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  ExplorerNotableSat,
  ExplorerOutpointPosition,
  ExplorerTransactionAssetFlow,
} from '@app/universe/universe.types';

const CHECKPOINT = {
  chain: 'bitcoin',
  network: 'mainnet',
  heightAtomic: '964103',
  blockHash: 'a'.repeat(64),
  reorgEpoch: '0',
};

function evidence(coverage = 'complete'): ExplorerOutpointPosition['evidence'] {
  return { authorityId: 'ord', coverage, checkpoint: CHECKPOINT };
}

function flow(overrides: Partial<ExplorerTransactionAssetFlow> = {}): ExplorerTransactionAssetFlow {
  return {
    schemaVersion: 'universe-transaction-asset-flow-v1',
    chain: 'bitcoin',
    network: 'mainnet',
    txid: 'b'.repeat(64),
    status: 'confirmed',
    checkpoint: CHECKPOINT,
    coinbase: false,
    inputs: [],
    outputs: [],
    actions: [],
    sourceEvidence: [],
    complete: true,
    unknownAttachmentCount: 0,
    outOfCoverageCount: 0,
    ...overrides,
  };
}

function position(overrides: Partial<ExplorerOutpointPosition> = {}): ExplorerOutpointPosition {
  return {
    outpoint: 'c'.repeat(64) + ':0',
    vout: 0,
    valueSatsAtomic: '10000',
    asset: { protocolId: 'ordinals', assetId: 'i0', assetKind: 'inscription' },
    state: 'active',
    evidence: evidence(),
    ...overrides,
  };
}

function component(api: Partial<UniverseApiService> = {}): AssetFlowComponent {
  return new AssetFlowComponent(api as UniverseApiService);
}

describe('AssetFlowComponent evidence vocabulary', () => {
  it('reports complete evidence only when nothing is unresolved or uncovered', () => {
    const subject = component();
    expect(subject.evidenceLabel(flow())).toBe('Complete evidence');
    expect(subject.evidenceKind(flow())).toBe('complete');
  });

  it('separates a coverage boundary from a failed read', () => {
    const subject = component();
    // Discarded inventory leaves the flow unproven, but nothing failed.
    const boundary = flow({ complete: false, outOfCoverageCount: 2 });
    expect(subject.evidenceKind(boundary)).toBe('partial');
    expect(subject.evidenceLabel(boundary)).toBe(
      'Outputs proven, inputs no longer retained by the authority',
    );
  });

  it('lets a real failure outrank a coverage boundary', () => {
    const subject = component();
    const both = flow({ complete: false, unknownAttachmentCount: 1, outOfCoverageCount: 2 });
    expect(subject.limitedByCoverage(both)).toBe(false);
    expect(subject.evidenceKind(both)).toBe('incomplete');
    expect(subject.evidenceLabel(both)).toBe('Evidence incomplete: 1 outpoints unresolved');
    expect(subject.inputsNote(both)).toContain('Input evidence incomplete');
  });

  it('counts unresolved outpoints when the authority actually failed', () => {
    const subject = component();
    const failed = flow({ complete: false, unknownAttachmentCount: 3 });
    expect(subject.evidenceKind(failed)).toBe('incomplete');
    expect(subject.evidenceLabel(failed)).toBe('Evidence incomplete: 3 outpoints unresolved');
  });

  it('does not claim completeness for an unconfirmed transaction', () => {
    const subject = component();
    const pending = flow({ status: 'mempool-candidate' });
    expect(subject.evidenceKind(pending)).toBe('pending');
    expect(subject.evidenceLabel(pending)).toBe(
      'Awaiting confirmation for complete protocol analysis',
    );
  });

  it('tolerates an overlay that predates the coverage counter', () => {
    const subject = component();
    const legacy = flow({ complete: false });
    delete (legacy as Partial<ExplorerTransactionAssetFlow>).outOfCoverageCount;
    expect(subject.hasCoverageBoundary(legacy)).toBe(false);
    expect(subject.limitedByCoverage(legacy)).toBe(false);
    expect(subject.evidenceKind(legacy)).toBe('incomplete');
  });
});

describe('AssetFlowComponent empty and input notes', () => {
  it('states a proven negative differently from a missing one', () => {
    const subject = component();
    expect(subject.emptyLabel(flow())).toBe(
      'No supported assets detected on this transaction',
    );
    expect(subject.emptyLabel(flow({ complete: false }))).toBe(
      'Protocol evidence incomplete',
    );
  });

  it('scopes the proven negative to the outputs when inputs are uncovered', () => {
    const subject = component();
    expect(subject.emptyLabel(flow({ complete: false, outOfCoverageCount: 1 }))).toBe(
      'No supported assets on the outputs of this transaction',
    );
  });

  it('explains a coinbase before anything else', () => {
    const subject = component();
    expect(
      subject.inputsNote(flow({ coinbase: true, complete: false, outOfCoverageCount: 1 })),
    ).toBe(
      'Coinbase transaction: no inputs to spend',
    );
  });

  it('explains an uncovered input as a coverage boundary, not a failure', () => {
    const subject = component();
    expect(subject.inputsNote(flow({ complete: false, outOfCoverageCount: 2 }))).toContain(
      'keeps no inventory for outputs that have already been spent',
    );
  });

  it('reports an authority failure on the inputs as incomplete', () => {
    const subject = component();
    expect(subject.inputsNote(flow({ complete: false, unknownAttachmentCount: 1 }))).toContain(
      'Input evidence incomplete',
    );
  });

  it('is empty only when neither side has a position', () => {
    const subject = component();
    expect(subject.isEmpty(flow())).toBe(true);
    expect(subject.isEmpty(flow({ outputs: [position()] }))).toBe(false);
    expect(subject.isEmpty(flow({ inputs: [position()] }))).toBe(false);
  });
});

describe('AssetFlowComponent rare sats', () => {
  const notable: ExplorerNotableSat[] = [
    { satAtomic: '1050000000000000', rarity: 'epic', heightAtomic: '210000' },
    { satAtomic: '4000000000000', rarity: 'uncommon', heightAtomic: '800' },
  ];

  it('reads notable sats off a position and copes with their absence', () => {
    const subject = component();
    expect(subject.notableSats(position({ notableSats: notable }))).toHaveLength(2);
    expect(subject.notableSats(position())).toEqual([]);
  });

  it('names every rarity in the Rodarmor index', () => {
    const subject = component();
    const named = (rarity: ExplorerNotableSat['rarity']): string =>
      subject.rarityLabel({ satAtomic: '1', rarity, heightAtomic: '1' });
    expect(named('mythic')).toBe('Mythic');
    expect(named('legendary')).toBe('Legendary');
    expect(named('epic')).toBe('Epic');
    expect(named('rare')).toBe('Rare');
    expect(named('uncommon')).toBe('Uncommon');
  });

  it('states the rule that makes each sat notable', () => {
    const subject = component();
    expect(subject.rarityReason(notable[0])).toBe(
      'The first satoshi of a halving epoch, at block 210000',
    );
    expect(subject.rarityReason(notable[1])).toBe('The first satoshi of block 800');
    expect(
      subject.rarityReason({ satAtomic: '0', rarity: 'mythic', heightAtomic: '0' }),
    ).toBe('The first satoshi of the genesis block');
  });

  it('labels a rare sats position by protocol rather than by asset id', () => {
    const subject = component();
    expect(
      subject.assetLabel({
        protocolId: 'rare_sats',
        assetId: '1050000000000000',
        displayName: 'epic',
        assetKind: 'sat',
      }),
    ).toBe('Rare sats');
  });

  it('tracks notable sats by their ordinal number', () => {
    const subject = component();
    expect(subject.trackNotableSat(0, notable[0])).toBe('1050000000000000');
  });
});

describe('AssetFlowComponent labels', () => {
  it('shortens an inscription id but keeps a ticker whole', () => {
    const subject = component();
    const inscriptionId = 'd'.repeat(64) + 'i0';
    const shortened = subject.assetLabel({
      protocolId: 'ordinals',
      assetId: inscriptionId,
      assetKind: 'inscription',
    });
    expect(shortened).toContain('…');
    expect(shortened.length).toBeLessThan(inscriptionId.length);
    expect(
      subject.assetLabel({
        protocolId: 'runes',
        assetId: 'UNCOMMON.GOODS',
        ticker: 'UNCOMMON.GOODS',
        assetKind: 'fungible',
      }),
    ).toBe('UNCOMMON.GOODS');
  });

  it('returns an empty label rather than throwing on a missing asset', () => {
    expect(component().assetLabel(undefined)).toBe('');
  });

  it('marks a position whose authority cannot prove absence', () => {
    const subject = component();
    expect(subject.isPartialEvidence(position())).toBe(false);
    expect(subject.isPartialEvidence(position({ evidence: evidence('unknown') }))).toBe(true);
  });

  it('accents an asset present on both sides of the transaction', () => {
    const subject = component();
    const asset = { protocolId: 'runes', assetId: 'RUNE', assetKind: 'fungible' };
    const transferred = flow({
      actions: [
        {
          eventId: 'e0',
          protocolId: 'runes',
          actionType: 'transfer',
          asset,
          evidence: evidence(),
        },
      ],
    });
    expect(subject.accentClass(position({ asset }), transferred)).toBe('transferred');
    expect(subject.accentClass(position(), transferred)).toBe('');
  });

  it('names every protocol action it renders', () => {
    const subject = component();
    const action = (actionType: string): string =>
      subject.actionLabel({
        eventId: 'e',
        protocolId: 'runes',
        actionType,
        evidence: evidence(),
      });
    expect(action('transfer')).toBe('Transfer');
    expect(action('etch')).toBe('Etch');
    expect(action('burn')).toBe('Burn');
    // An action type the registry adds later still renders as itself.
    expect(action('teleport')).toBe('teleport');
  });
});

describe('AssetFlowComponent loading', () => {
  async function statesFor(
    api: Partial<UniverseApiService>,
    txid = 'e'.repeat(64),
  ): Promise<FlowViewState[]> {
    const subject = component(api);
    subject.txid = txid;
    subject.ngOnChanges({ txid: { currentValue: txid } } as never);
    return firstValueFrom(subject.state$.pipe(toArray()));
  }

  it('shows a loading state before the flow arrives', async () => {
    const states = await statesFor({ getTransactionFlow$: () => of(flow()) });
    expect(states.map((state) => state.kind)).toEqual(['loading', 'flow']);
  });

  it('treats an unconfigured authority as its own state, not an error', async () => {
    const error = new HttpErrorResponse({
      status: 503,
      error: { error: 'bitcoin-authority-unconfigured' },
    });
    const states = await statesFor({ getTransactionFlow$: () => throwError(() => error) });
    expect(states.map((state) => state.kind)).toEqual(['loading', 'unconfigured']);
  });

  it('reports any other failure as an error state', async () => {
    const error = new HttpErrorResponse({ status: 502, error: { error: 'unavailable' } });
    const states = await statesFor({ getTransactionFlow$: () => throwError(() => error) });
    expect(states.map((state) => state.kind)).toEqual(['loading', 'error']);
  });

  it('does not request anything until a txid is set', () => {
    const getTransactionFlow$ = vi.fn(() => of(flow()));
    const subject = component({ getTransactionFlow$ } as unknown as Partial<UniverseApiService>);
    subject.ngOnChanges({} as never);
    expect(getTransactionFlow$).not.toHaveBeenCalled();
  });
});
