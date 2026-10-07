import { sha256 } from '@noble/hashes/sha2.js';
import { Sv2ConfiguredSource, Sv2Family, Sv2Page } from './stratum-v2.types';
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const atomic=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
const time=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const text=(v:unknown,max=256):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&[...v].every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127);
const revision=(v:unknown)=>v===null||typeof v==='string'&&/^[0-9a-f]{40}$/.test(v);
const nullableAtomic=(v:unknown)=>v===null||atomic(v);
function requireValue(v:unknown,message='The source returned invalid or mismatched SV2 observations.'):asserts v{if(!v)throw new Error(message);}
export const sv2Stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.keys(item).sort().reduce((out,key)=>{out[key]=item[key];return out;},{} as any):item);
export function configuredSv2Profile(value:unknown):Sv2ConfiguredSource{
 if(typeof value==='string'){requireValue(value.length<=32768);try{value=JSON.parse(value);}catch{throw new Error('Invalid public SV2 source configuration.');}}
 const c=value as any,p=c?.profile;
 requireValue(c&&Object.keys(c).sort().join(',')==='profile,profileSha256'&&hash(c.profileSha256)&&p?.schema==='universe-sv2-source-profile-v1','No independently configured SV2 source.');
 requireValue(Object.keys(p).sort().join(',')==='blockOneHash,core,genesisHash,network,roleSources,schema,signetChallenge'&&Object.keys(p.core||{}).sort().join(',')==='binarySha256,configurationSha256,software,sourceRevision,versionAtomic','The public SV2 profile contains unsupported fields.');
 requireValue(['regtest','signet'].includes(p.network)&&hash(p.genesisHash)&&hash(p.blockOneHash)&&p.blockOneHash!==p.genesisHash);
 requireValue(p.network==='regtest'?p.genesisHash==='0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'&&p.signetChallenge===null:p.genesisHash==='00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6'&&typeof p.signetChallenge==='string'&&/^(?:[0-9a-f]{2}){1,10000}$/.test(p.signetChallenge));
 requireValue(text(p.core?.software)&&atomic(p.core.versionAtomic)&&revision(p.core.sourceRevision)&&hash(p.core.binarySha256)&&hash(p.core.configurationSha256));
 requireValue(Array.isArray(p.roleSources)&&p.roleSources.length>0&&p.roleSources.length<=8&&new Set(p.roleSources.map((r:any)=>r.roleId)).size===p.roleSources.length);
 for(const r of p.roleSources){requireValue(Object.keys(r).sort().join(',')==='binarySha256,configurationSha256,derivative,roleId,software,sourceRevision,version'&&text(r.roleId,64)&&text(r.software)&&text(r.version)&&revision(r.sourceRevision)&&hash(r.binarySha256)&&hash(r.configurationSha256));if(r.derivative!==null)requireValue(r.derivative&&Object.keys(r.derivative).sort().join(',')==='baseRevision,cargoLockSha256,patchSha256,patchedSourceSha256'&&/^[0-9a-f]{40}$/.test(r.derivative.baseRevision)&&hash(r.derivative.patchSha256)&&hash(r.derivative.patchedSourceSha256)&&hash(r.derivative.cargoLockSha256));}
 return c;
}
export function validateSv2Page(value:unknown,expected:Sv2ConfiguredSource,family:Sv2Family):Sv2Page<any>{
 const p=value as any,s=p?.source,ret=s?.retention;
 requireValue(p?.schemaVersion==='universe-sv2-observatory-v1'&&p.totalScope==='captured-retained-observations'&&p.completeHistory===false);
 requireValue(s?.profileSha256===expected.profileSha256&&sv2Stable(s.profile)===sv2Stable(expected.profile),'The observed SV2 source differs from the independent configured profile.');
 requireValue(typeof s.sourceEpoch==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.sourceEpoch)&&atomic(s.sourceGenerationAtomic)&&hash(s.rawSnapshotSha256)&&time(s.observedAt)&&time(s.latestVerifiedAt)&&Date.parse(s.latestVerifiedAt)>=Date.parse(s.observedAt));
 const core=s.core;requireValue(core?.genesisHash===expected.profile.genesisHash&&core.signetChallenge===expected.profile.signetChallenge&&core.initialBlockDownload===false&&time(core.verifiedAt)&&atomic(core.checkpoint?.heightAtomic)&&hash(core.checkpoint.blockHash)&&/^[0-9a-f]{160}$/.test(core.checkpoint.headerHex));
 const bytes=Uint8Array.from(core.checkpoint.headerHex.match(/../g).map((h:string)=>parseInt(h,16))),digest=Array.from(sha256(sha256(bytes))).reverse().map(b=>b.toString(16).padStart(2,'0')).join('');requireValue(digest===core.checkpoint.blockHash,'The SV2 checkpoint header does not match its hash.');
 requireValue(ret?.scope==='bounded-retained-native-links'&&ret.maximumLinks===512&&ret.completeHistory===false&&atomic(ret.retainedLinksAtomic)&&BigInt(ret.retainedLinksAtomic)<=512n&&nullableAtomic(ret.droppedLinksAtomic)&&nullableAtomic(ret.firstSequenceAtomic)&&nullableAtomic(ret.lastSequenceAtomic)&&(ret.gapReason===null||text(ret.gapReason))&&(ret.droppedLinksAtomic!==null||ret.gapReason!==null));
 requireValue(ret.retainedLinksAtomic==='0'?ret.firstSequenceAtomic===null&&ret.lastSequenceAtomic===null:atomic(ret.firstSequenceAtomic)&&atomic(ret.lastSequenceAtomic)&&BigInt(ret.lastSequenceAtomic)-BigInt(ret.firstSequenceAtomic)+1n>=BigInt(ret.retainedLinksAtomic));
 requireValue(Number.isSafeInteger(p.total)&&p.total>=0&&p.total<=(family==='roles'?8:512)&&Array.isArray(p.items)&&p.items.length<=100&&p.items.length<=p.total&&(p.nextCursor===null||text(p.nextCursor,4096)));
 requireValue(p.nextCursor===null||p.items.length>0,'The SV2 continuation made no progress.');
 requireValue(p.total===(family==='roles'?expected.profile.roleSources.length:Number(ret.retainedLinksAtomic)));
 const ids=new Set<string>();for(const item of p.items){const id=family==='roles'?item?.roleId:item?.eventId;requireValue(family==='roles'?text(id,64):hash(id));requireValue(!ids.has(id));ids.add(id);
  if(family==='roles'){
   requireValue(expected.profile.roleSources.some(r=>r.roleId===id)&&['observed','unavailable'].includes(item.health?.status)&&(item.health.httpStatus===null||Number.isInteger(item.health.httpStatus)&&item.health.httpStatus>=100&&item.health.httpStatus<=599)&&(item.health.observedAt===null||time(item.health.observedAt))&&nullableAtomic(item.uptimeSecondsAtomic)&&nullableAtomic(item.connectedDownstreamsAtomic));
   requireValue(item.globalCounters===null||Array.isArray(item.globalCounters)&&item.globalCounters.length<=32&&item.globalCounters.every((c:any)=>text(c.name,64)&&atomic(c.valueAtomic)));
   requireValue(Array.isArray(item.transports)&&item.transports.length<=16);for(const t of item.transports)requireValue(['upstream','downstream'].includes(t.direction)&&['SV1','SV2','unknown'].includes(t.protocol)&&['plaintext','noise','unknown'].includes(t.security)&&['configured','observed-negotiated','observed-traffic','unknown'].includes(t.evidence)&&(t.peerRoleId===null||expected.profile.roleSources.some(r=>r.roleId===t.peerRoleId))&&(t.observedAt===null||time(t.observedAt)));
  }else{
   requireValue(atomic(item.templateId)&&atomic(item.channelId));
   if(family==='templates')requireValue(item.blockHeight===null&&atomic(item.coinbaseValueRemainingSats)&&item.coinbaseTxValueSats===null&&atomic(item.declaredTxCount)&&item.poolSelectedTxCount===null&&item.feeRateDeltaSatVb===null&&item.totalWeight===null&&hash(item.previousBlockHash)&&['observed-current','unverified-history'].includes(item.status)&&time(item.observedAt)&&item.generatedAt===null&&(item.status==='observed-current')===(item.previousBlockHash===core.checkpoint.blockHash));
   else requireValue(atomic(item.jobId)&&atomic(item.requestId)&&item.minerDeclaredTxids===null&&item.poolModifiedTxids===null&&item.acceptedByPool===true&&item.latencyMs===null&&time(item.declarationObservedAt)&&time(item.acceptanceObservedAt)&&Date.parse(item.acceptanceObservedAt)>=Date.parse(item.declarationObservedAt));
  }
 }
 return p;
}
export function appendSv2Page(previous:Sv2Page<any>,next:Sv2Page<any>,items:any[],family:Sv2Family):any[]{
 requireValue(previous.total===next.total&&previous.source.rawSnapshotSha256===next.source.rawSnapshotSha256&&previous.source.sourceEpoch===next.source.sourceEpoch&&previous.source.sourceGenerationAtomic===next.source.sourceGenerationAtomic&&sv2Stable(previous.source.core)===sv2Stable(next.source.core)&&previous.source.observedAt===next.source.observedAt,'The captured SV2 source changed; restart this panel.');
 const key=(x:any)=>family==='roles'?x.roleId:x.eventId,ids=new Set(items.map(key));requireValue(next.items.every(x=>!ids.has(key(x))),'The SV2 page overlaps accepted observations. Restart this panel.');
 const joined=[...items,...next.items];requireValue(joined.length<=next.total&&(next.nextCursor===null?joined.length===next.total:joined.length<next.total),'The retained SV2 count and continuation do not close.');return joined;
}
