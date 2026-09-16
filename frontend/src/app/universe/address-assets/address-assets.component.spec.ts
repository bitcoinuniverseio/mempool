import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { AddressAssetsComponent } from './address-assets.component';
import { summarise } from '@app/universe/address-assets/address-assets.component';
import type { OutpointEnrichment } from '@app/universe/universe.types';

describe('address asset coverage and exact totals', () => {
  it.each([true,false])('keeps incomplete quantities unknown in either order: %s', reverse => {
    const a=result({positions:[position('runes','A','5')] as never});
    const b=result({outpoint:`${'b'.repeat(64)}:0`,positions:[{...position('runes','A') as any,outpoint:`${'b'.repeat(64)}:0`}] as never});
    expect(summarise(reverse?[b,a]:[a,b]).holdings[0].quantityAtomic).toBeNull();
  });
  it('never sums duplicate results or accepts unrelated positions',()=>{
    const a=result({positions:[position('runes','A','5')] as never});
    expect(summarise([a,a])).toMatchObject({resolved:1,partial:true});
    expect(summarise([result({positions:[{...position('runes','A','5') as any,outpoint:`${'b'.repeat(64)}:0`}] as never})])).toMatchObject({holdings:[],partial:true});
  });
  it('shows an explicit source limit without querying asset authority',async()=>{
    const api={getOutpoints$:vi.fn()},component=new AddressAssetsComponent(api as any);
    component.sourceState='limit';component.ngOnChanges({sourceState:{} as any});
    expect(await firstValueFrom(component.state$)).toMatchObject({kind:'source-unavailable',reason:expect.stringContaining('500')});
    expect(api.getOutpoints$).not.toHaveBeenCalled();
  });
  it('counts missing requested outputs as unresolved',()=>{
    const api={getOutpoints$:vi.fn(()=>of({results:[result()]}))},component=new AddressAssetsComponent(api as any);
    component.utxos=[{txid:'a'.repeat(64),vout:0},{txid:'b'.repeat(64),vout:0}] as any;
    component.sourceState='complete';component.ngOnChanges({utxos:{} as any});
    const values:any[]=[];component.state$.subscribe(value=>values.push(value));
    expect(values[1]).toMatchObject({kind:'ready',resolved:1,notResolved:1,partial:true});
  });
});

function result(patch: Partial<OutpointEnrichment> = {}): OutpointEnrichment {
  return {
    outpoint: `${'a'.repeat(64)}:0`,
    status: 'ok',
    positions: [],
    coveredProtocolIds: [],
    unknownAttachments: false,
    checkpoint: null,
    ...patch,
  };
}

function position(
  protocolId: string,
  assetId: string,
  quantityAtomic?: string
): unknown {
  return {
    outpoint: `${'a'.repeat(64)}:0`,
    vout: 0,
    valueSatsAtomic: '546',
    asset: {
      protocolId,
      assetId: assetId,
      assetKind: 'fungible',
      displayName: assetId,
    },
    quantityAtomic,
    state: 'unspent',
    evidence: { authorityId: 'ord', coverage: 'complete' },
  };
}

describe('summarise', () => {
  it('reports nothing for no results', () => {
    const summary = summarise([]);
    expect(summary.holdings).toEqual([]);
    expect(summary.resolved).toBe(0);
    expect(summary.partial).toBe(false);
  });

  it('counts only the outputs the authority actually answered for', () => {
    const summary = summarise([result(), result({ status: 'unavailable' })]);
    expect(summary.resolved).toBe(1);
    expect(summary.partial).toBe(true);
  });

  it('marks an unindexed output as incomplete coverage', () => {
    const summary = summarise([result({ status: 'not-indexed' })]);
    expect(summary.resolved).toBe(0);
    expect(summary.partial).toBe(true);
  });

  it('flags unknown attachments as partial', () => {
    const summary = summarise([result({ unknownAttachments: true })]);
    expect(summary.partial).toBe(true);
  });

  it('sums quantities across outputs without losing precision', () => {
    const big = '340282366920938463463374607431768211455';
    const summary = summarise([
      result({ positions: [position('runes', 'RUNE', big)] as never }),
      result({
        outpoint: `${'b'.repeat(64)}:0`,
        positions: [
          {
            ...(position('runes', 'RUNE', '1') as any),
            outpoint: `${'b'.repeat(64)}:0`,
          },
        ] as never,
      }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBe(
      (BigInt(big) + 1n).toString()
    );
  });

  it('keeps a holding with no quantity rather than inventing a zero', () => {
    const summary = summarise([
      result({ positions: [position('ordinals', 'insc1')] as never }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBeNull();
    expect(summary.holdings[0].outpoints).toHaveLength(1);
  });

  it('separates assets that share a protocol', () => {
    const summary = summarise([
      result({
        positions: [
          position('runes', 'A', '1'),
          position('runes', 'B', '2'),
        ] as never,
      }),
    ]);
    expect(summary.holdings).toHaveLength(2);
  });

  it('ignores a malformed quantity instead of guessing', () => {
    const summary = summarise([
      result({ positions: [position('runes', 'A', '-5')] as never }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBeNull();
  });

  it('drops a position with no protocol rather than filing it wrongly', () => {
    const summary = summarise([
      result({ positions: [{ outpoint: 'x', asset: {} }] as never }),
    ]);
    expect(summary.holdings).toEqual([]);
  });

  it('refuses to present mixed checkpoints as one observation', () => {
    const summary = summarise([
      result({
        checkpoint: { heightAtomic: '900000', blockHash: 'a' } as never,
      }),
      result({
        outpoint: `${'b'.repeat(64)}:0`,
        checkpoint: { heightAtomic: '900001', blockHash: 'b' } as never,
      }),
    ]);
    expect(summary.checkpointHeight).toBeNull();
    expect(summary.partial).toBe(true);
  });

  it('sorts holdings by protocol and refuses duplicate positions', () => {
    const summary = summarise([
      result({
        positions: [
          position('runes', 'A', '1'),
          position('runes', 'B', '1'),
          position('runes', 'B', '1'),
          position('ordinals', 'C'),
        ] as never,
      }),
    ]);
    expect(summary.holdings.map((holding) => holding.protocolId)).toEqual([
      'ordinals',
      'runes',
      'runes',
    ]);
    expect(
      summary.holdings.find((h) => h.displayName === 'B')?.quantityAtomic
    ).toBeNull();
    expect(summary.partial).toBe(true);
  });
});
