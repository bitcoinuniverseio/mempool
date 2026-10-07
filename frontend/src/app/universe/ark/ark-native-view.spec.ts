import { describe, expect, it } from 'vitest';
import { nativeBatch, nativeInput, nativeSource, nativeVerdict, batchPage } from './ark-native-test-fixtures';
import { arkWindow, readArkBatchPage, readArkProof, readArkVerdict } from './ark-native-view';

describe('Native Ark bounded observation and public proof binding', () => {
  it('accepts the historical actual native PSBT package and independently checked scoped verdict', () => {
    const request=readArkProof(JSON.stringify(nativeInput), 'signet');
    expect(readArkVerdict(nativeVerdict, request, nativeSource)).toEqual(nativeVerdict);
    expect(nativeVerdict.exitViable).toBeNull(); expect(nativeVerdict.protocolVerified).toBeNull();
  });
  it('binds original signed bytes rather than just the reconstructed txid', () => {
    const request=structuredClone(nativeInput);
    request.arkade.nodes[0].tx=btoa('psbt\xffdifferent-original-bytes');
    expect(() => readArkVerdict(nativeVerdict, request, nativeSource)).toThrow(/digest/);
  });
  it.each(['provider','challenge','profile','digest','vtxo','signature','overstated-exit','stage','checkpoint','time'])('rejects mismatched native proof %s', field => {
    const verdict=structuredClone(nativeVerdict);
    if(field==='provider') verdict.source!.profile.providerId='foreign-provider';
    if(field==='challenge') verdict.source!.profile.signetChallenge='51';
    if(field==='profile') verdict.source!.profileSha256='f'.repeat(64);
    if(field==='digest') verdict.evidence!.nativePsbtSha256[0]='f'.repeat(64);
    if(field==='vtxo') verdict.evidence!.vtxoOutpoint='f'.repeat(64)+':0';
    if(field==='signature') verdict.evidence!.transactionChecks[0].signature_valid=false;
    if(field==='overstated-exit') (verdict as any).exitViable=true;
    if(field==='stage') verdict.stage='invalid-native-proof';
    if(field==='checkpoint') verdict.source!.anchor.hash='f'.repeat(64);
    if(field==='time') verdict.source!.observedAt=new Date(Date.parse(nativeSource.observedAt)-1).toISOString();
    expect(() => readArkVerdict(verdict,nativeInput,nativeSource)).toThrow();
  });
  it('preserves unavailable and invalid as distinct nonpositive scoped outcomes', () => {
    for(const valid of [false,null]){
      const verdict={schema:'universe-ark-native-proof-verdict-v1',valid,stage:valid===false?'invalid-native-proof':'unavailable-native-verifier',
        exitViable:null,protocolVerified:null,error:'Source did not establish the requested proof.',scope:nativeVerdict.scope};
      expect(readArkVerdict(verdict,nativeInput,nativeSource).valid).toBe(valid);
    }
  });
  it.each(['hash-array','network','missing-tree','duplicate','noncanonical-base64','secret-field','wrong-leaf'])('rejects %s proof input before source IO', field => {
    const input=structuredClone(nativeInput) as any;
    if(field==='hash-array') {expect(() => readArkProof(JSON.stringify(['a'.repeat(64)]),'signet')).toThrow();return;}
    if(field==='network') input.network='mainnet';
    if(field==='missing-tree') input.arkade.nodes=[];
    if(field==='duplicate') input.arkade.nodes.push(input.arkade.nodes[0]);
    if(field==='noncanonical-base64') input.arkade.nodes[0].tx+='\n';
    if(field==='secret-field') input.privateKey='rejected-test-marker';
    if(field==='wrong-leaf') input.arkade.leaf_outpoint='f'.repeat(64)+':0';
    expect(() => readArkProof(JSON.stringify(input),'signet')).toThrow();
  });
  it('accepts a bounded native window with null amounts and explicit unknown total', () => {
    const page=batchPage([nativeBatch]);expect(readArkBatchPage(page,'signet',{after:'0',limit:10})).toBe(page);
    expect(page.total).toBeNull();expect(page.page.completeCatalogue).toBe(false);
  });
  it.each(['total','count','limit','continuation','scope','network','provider','duplicate','order','interval'])('rejects a misleading %s completed-round page', field => {
    const page=structuredClone(batchPage([nativeBatch])) as any;
    if(field==='total') page.total=1;
    if(field==='count') page.page.observedCount=0;
    if(field==='limit') page.page.limit=50;
    if(field==='continuation') page.page.continuation='invented';
    if(field==='scope') page.page.completeCatalogue=true;
    if(field==='network') page.batches[0].source.profile.network='mainnet';
    if(field==='provider') page.batches[0].operatorId='foreign-provider';
    if(field==='duplicate') {page.batches.push(page.batches[0]);page.page.nativeObservedCount=2;page.page.observedCount=2;}
    if(field==='order') {const row=structuredClone(nativeBatch);row.batchId='00000000-0000-4000-8000-000000000001';row.roundTimestamp++;page.batches.push(row);page.page.nativeObservedCount=2;page.page.observedCount=2;}
    if(field==='interval') page.batches[0].roundTimestamp=Number(page.page.before);
    expect(() => readArkBatchPage(page,'signet',{after:'0',limit:10})).toThrow();
  });
  it('uses scalar exact seconds and an explicit bounded limit without invented pagination', () => {
    expect(arkWindow('0','',10)).toEqual({after:'0',limit:10});
    expect(arkWindow('100','200',100)).toEqual({after:'100',before:'200',limit:100});
    for(const values of [['200','100',10],['0','',101],['0','',0],['1e3','',10]])expect(() => arkWindow(values[0] as string,values[1] as string,values[2] as number)).toThrow();
  });
});
