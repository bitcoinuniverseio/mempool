import { describe, expect, it } from 'vitest';
import { checkedKnowledgeLabels, checkedKnowledgeAudit } from './knowledge-evidence';
const at='2026-10-04T12:00:00.000Z';
function label() { return { label_id:'controlled',entity_type:'entity',entity_id:'controlled-entity',name:'Controlled submission',category:'custodian',confidence_level:1,confidence_score:0.5,status:'provisional',source:'submitted',created_at:at,updated_at:at,evidence:[{evidence_type:'public_disclosure',reference_uri:'urn:controlled:submission',description:'Unverified supplied evidence',verified_at_utc:null}] }; }
describe('bounded Knowledge response validation, controlled fixtures only',()=>{
  const envelope=(items=[label()])=>({schema:'universe-knowledge-labels-v1',network:'signet',count:items.length,labels:items});
  it('preserves provisional evidence without converting it to verification',()=>{expect(checkedKnowledgeLabels(envelope(),'signet')[0]).toMatchObject({status:'provisional',source:'submitted',evidence:[{verified_at_utc:null}]});});
  it.each([NaN,Infinity,-0.1,1.1,'0.5'])('rejects malformed confidence %s',score=>{expect(()=>checkedKnowledgeLabels(envelope([{...label(),confidence_score:score as number}]),'signet')).toThrow();});
  it('rejects duplicate label identities',()=>{expect(()=>checkedKnowledgeLabels(envelope([label(),label()]),'signet')).toThrow();});
  it('rejects JSON array enum substitutions without coercion',()=>{expect(()=>checkedKnowledgeLabels(envelope([{...label(),entity_type:['entity'] as any}]),'signet')).toThrow();});
  it('rejects impossible timestamps and malformed evidence arrays',()=>{
    expect(()=>checkedKnowledgeLabels(envelope([{...label(),updated_at:'2026-02-30T00:00:00.000Z'}]),'signet')).toThrow();
    expect(()=>checkedKnowledgeLabels(envelope([{...label(),evidence:[null as any]}]),'signet')).toThrow();
  });
  it('distinguishes proven empty from missing or foreign audit data',()=>{
    const empty={schema:'universe-knowledge-audit-v1',network:'signet',count:0,audit_events:[]};expect(checkedKnowledgeAudit(empty,'signet')).toEqual([]);
    expect(()=>checkedKnowledgeAudit({...empty,network:'mainnet'},'signet')).toThrow();expect(()=>checkedKnowledgeAudit({...empty,audit_events:undefined},'signet')).toThrow();
  });
});
