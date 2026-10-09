import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { incidentProfileDigest, validIncidentResponse } from './incident-observations';

// Controlled source-shape fixtures, not native-chain acceptance.
function fixture(): any {
  const at='2026-10-04T12:00:00.000Z', header={height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1};
  const profile={schema:'universe-incident-profile-v1',network:'signet',stale_after_seconds:30,sources:[{source_id:'core-one',independence_id:'host-one',implementation:'bitcoin-core',source_revision:null,
    binary_sha256:'1'.repeat(64),configuration_sha256:'2'.repeat(64),genesis_hash:'3'.repeat(64),block_one_hash:'4'.repeat(64),signet_challenge:'51'}]};
  return {schema:'universe-incident-observations-v1',network:'signet',profile,profile_sha256:createHash('sha256').update(JSON.stringify(profile)).digest('hex'),observed_at_utc:at,
    incidents:[],count:0,sources:[{source_id:'core-one',status:'observed',checkpoint:header,observed_at_utc:at}],
    coverage:{started_at_utc:at,last_observed_at_utc:at,retained_header_limit:128,retained_incident_limit:256,observation_count:1,gaps:[],complete_monitoring:false,global_consensus_verified:false,
      invalid_block_validation:'unavailable',consensus_validation:'unavailable',displaced_transactions:'unmeasured',double_spend_attempts:'unmeasured'}};
}
function reorg(): any {
  const v=fixture(), ancestor={height:1,hash:'4'.repeat(64),parent:'3'.repeat(64),timestamp:1};
  v.incidents=[{incident_id:'b'.repeat(64),incident_type:'reorg',title:'Controlled reorg',block_height:2,block_hash:'c'.repeat(64),detected_at_utc:v.observed_at_utc,
    resolved_at_utc:null,duration_seconds:null,reorg_depth:1,displaced_tx_count:null,double_spend_attempts_count:null,status:'investigating',summary:'Controlled only',technical_postmortem:'',source_ids:['core-one'],
    evidence:{before:[ancestor,{height:2,hash:'a'.repeat(64),parent:ancestor.hash,timestamp:2}],after:[ancestor,{height:2,hash:'c'.repeat(64),parent:ancestor.hash,timestamp:3}],common_ancestor:ancestor},
    timeline:[{observed_at_utc:v.observed_at_utc,stage:'detected',source_ids:['core-one']}] }];v.count=1;return v;
}
describe('Incident observation protocol guards',()=>{
  it('matches owning ordered profile bytes despite response object key ordering',()=>{
    const v=fixture();v.profile.sources[0]=Object.fromEntries(Object.entries(v.profile.sources[0]).reverse());
    expect(incidentProfileDigest(v.profile)).toBe(v.profile_sha256);expect(validIncidentResponse(v,'signet')).toBe(true);
  });
  it('retains a linked reorg header branch and exact nullable effects',()=>{expect(validIncidentResponse(reorg(),'signet')).toBe(true);});
  it.each([
    ['wrong schema',(v:any)=>v.schema='unversioned'],['foreign registration',(v:any)=>v.profile.network='mainnet'],
    ['source identity substituted',(v:any)=>v.profile.sources[0].genesis_hash='f'.repeat(64)],['foreign source',(v:any)=>v.sources[0].source_id='other'],
    ['fabricated unavailable checkpoint',(v:any)=>v.sources[0].status='unavailable'],['future source measurement',(v:any)=>v.sources[0].observed_at_utc='2026-10-05T12:00:00.000Z'],
    ['unsafe checkpoint',(v:any)=>v.sources[0].checkpoint.height=Number.MAX_SAFE_INTEGER+1],['impossible calendar',(v:any)=>v.observed_at_utc='2026-02-31T12:00:00.000Z'],
    ['unsupported complete monitoring',(v:any)=>v.coverage.complete_monitoring=true],['unsupported consensus verdict',(v:any)=>v.coverage.global_consensus_verified=true],
    ['unsupported displacement measurement',(v:any)=>v.coverage.displaced_transactions='measured'],['unsafe count',(v:any)=>v.coverage.observation_count=Number.MAX_SAFE_INTEGER+1],
    ['missing last observation',(v:any)=>v.coverage.last_observed_at_utc=null],['wrong retention',(v:any)=>v.coverage.retained_header_limit=129],
    ['unknown gap',(v:any)=>v.coverage.gaps=[{at_utc:v.observed_at_utc,reason:'other'}]],['registered genesis checkpoint mismatch',(v:any)=>v.sources[0].checkpoint.height=0],['source measurement newer than coverage',(v:any)=>{v.coverage.started_at_utc='2026-10-04T11:58:00.000Z';v.coverage.last_observed_at_utc='2026-10-04T11:59:00.000Z';}],['missing registered source',(v:any)=>v.sources=[]]
  ])('rejects %s',(_name,mutate)=>{const v=fixture();mutate(v);expect(validIncidentResponse(v,'signet')).toBe(false);});
  it.each([
    ['unrelated common ancestor',(v:any)=>v.incidents[0].evidence.common_ancestor.hash='f'.repeat(64)],
    ['broken parent chain',(v:any)=>v.incidents[0].evidence.after[1].parent='f'.repeat(64)],
    ['foreign reported tip',(v:any)=>v.incidents[0].block_hash='f'.repeat(64)],['foreign reported height',(v:any)=>v.incidents[0].block_height=3],['missing branch evidence',(v:any)=>v.incidents[0].evidence.after=[]],['wrong depth',(v:any)=>v.incidents[0].reorg_depth=2],['invented displaced count',(v:any)=>v.incidents[0].displaced_tx_count=0],
    ['invented double spend count',(v:any)=>v.incidents[0].double_spend_attempts_count=0],
    ['unresolved timestamp',(v:any)=>v.incidents[0].resolved_at_utc=v.observed_at_utc],
    ['foreign timeline source',(v:any)=>v.incidents[0].timeline[0].source_ids=['other']],
    ['out of order timeline',(v:any)=>v.incidents[0].timeline.push({observed_at_utc:'2026-10-04T11:00:00.000Z',stage:'matching-tip-observed',source_ids:['core-one']})],
    ['invalid-block claim',(v:any)=>v.incidents[0].incident_type='invalid_block'],['duplicate incident',(v:any)=>{v.incidents.push(v.incidents[0]);v.count=2;}]
  ])('rejects %s',(_name,mutate)=>{const v=reorg();mutate(v);expect(validIncidentResponse(v,'signet')).toBe(false);});
});

describe('Type-specific retained evidence (controlled fixtures)',()=>{
  it('rejects changed branches labelled as a stale tip',()=>{const v=reorg();v.incidents[0].incident_type='stale_tip';v.incidents[0].reorg_depth=null;expect(validIncidentResponse(v,'signet')).toBe(false);});
  it('rejects an ordinary accepted chain extension labelled as a reorg',()=>{const v=reorg(),i=v.incidents[0];i.evidence.after=[...i.evidence.before,{height:3,hash:'d'.repeat(64),parent:'a'.repeat(64),timestamp:3}];i.block_height=3;i.block_hash='d'.repeat(64);expect(validIncidentResponse(v,'signet')).toBe(false);});
  it('rejects a reorg improperly attributed to multiple source observations',()=>{const v=reorg();v.profile.sources.push({...v.profile.sources[0],source_id:'core-two',independence_id:'host-two'});v.profile_sha256=createHash('sha256').update(JSON.stringify(v.profile)).digest('hex');v.sources.push({...v.sources[0],source_id:'core-two'});v.incidents[0].source_ids.push('core-two');expect(validIncidentResponse(v,'signet')).toBe(false);});
});

describe('Node-tip divergence source independence',()=>{
  function divergence():any {const v=reorg();v.profile.sources.push({...v.profile.sources[0],source_id:'core-two',independence_id:'host-two'});v.profile_sha256=createHash('sha256').update(JSON.stringify(v.profile)).digest('hex');v.sources.push({...v.sources[0],source_id:'core-two'});const i=v.incidents[0];i.incident_type='node_tip_divergence';i.reorg_depth=null;i.source_ids.push('core-two');i.evidence.common_ancestor=null;return v;}
  it('accepts two independently registered branches disagreeing at their shared height',()=>expect(validIncidentResponse(divergence(),'signet')).toBe(true));
  it('rejects an invented reorg depth on node-tip divergence',()=>{const v=divergence();v.incidents[0].reorg_depth=1;expect(validIncidentResponse(v,'signet')).toBe(false);});
  it('rejects a supplied common ancestor on node-tip divergence',()=>{const v=divergence();v.incidents[0].evidence.common_ancestor=v.incidents[0].evidence.before[0];expect(validIncidentResponse(v,'signet')).toBe(false);});
  it('rejects singleton, shared independence and identical branches',()=>{
    const singleton=divergence();singleton.incidents[0].source_ids=['core-one'];
    const shared=divergence();shared.profile.sources[1].independence_id='host-one';shared.profile_sha256=createHash('sha256').update(JSON.stringify(shared.profile)).digest('hex');
    const identical=divergence();identical.incidents[0].evidence.before=identical.incidents[0].evidence.after;
    for(const value of [singleton,shared,identical])expect(validIncidentResponse(value,'signet')).toBe(false);
  });
});
