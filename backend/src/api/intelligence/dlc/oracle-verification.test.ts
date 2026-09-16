import { readFileSync } from 'fs';
import { resolve } from 'path';
import { verifyAnnouncement } from './oracle-verification';
function find(value:any):any {if(value?.oracleAnnouncement)return value.oracleAnnouncement;for(const child of Object.values(value||{})){if(child&&typeof child==='object'){const found=find(child);if(found)return found;}}}
export function officialAnnouncement(name:string){
 const original=find(JSON.parse(readFileSync(resolve(__dirname,'../../../../../tools/dlc-verification/'+name+'.json'),'utf8')));
 const e=original.oracleEvent,d=e.eventDescriptor;
 return {protocol_revision:'rust-dlc-legacy-sha256',oracle_public_key:original.oraclePublicKey,announcement_signature:original.announcementSignature,event_id:e.eventId,event_maturity_epoch:e.eventMaturityEpoch,nonces:e.oracleNonces,event_descriptor:d.enumEvent?{type:'enumerated',outcomes:d.enumEvent.outcomes}:{type:'numeric',base:d.digitDecompositionEvent.base,is_signed:d.digitDecompositionEvent.isSigned,num_digits:d.digitDecompositionEvent.nbDigits,unit:d.digitDecompositionEvent.unit,precision:d.digitDecompositionEvent.precision}};
}
it.each(['enum_single_oracle_test','single_oracle_numerical_test'])('verifies independent dlcspecs %s announcement',name=>{expect(verifyAnnouncement(officialAnnouncement(name))).toMatchObject({verified:true,errors:[]});});

import * as secp from 'tiny-secp256k1';
import { verifyAttestation,serializeOracleEvent,oracleHash } from './oracle-verification';
const vectorRoot=resolve(__dirname,'../../../../../tools/dlc-verification');
const tagged=JSON.parse(readFileSync(resolve(vectorRoot,'tagged-fixtures.json'),'utf8'));
const copy=(v:any)=>JSON.parse(JSON.stringify(v));
describe('independent tagged oracle vectors and exact event binding',()=>{
 it.each([0,1])('verifies independent noble signature and serialization fixture %s',i=>{
  expect(serializeOracleEvent(tagged[i].announcement).toString('hex')).toBe(tagged[i].event_hex);
  expect(verifyAnnouncement(tagged[i].announcement).verified).toBe(true);
  expect(verifyAttestation(tagged[i].attestation)).toMatchObject({verified:true,has_conflict:null,conflict_state:'not_checked'});
 });
 it.each(['event_id','event_maturity_epoch','oracle_public_key','announcement_signature','event_descriptor','nonces'])('rejects altered signed announcement %s',field=>{
  const a=copy(tagged[0].announcement);
  if(field==='event_id')a[field]+='changed';if(field==='event_maturity_epoch')a[field]++;
  if(field==='oracle_public_key')a[field]='79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  if(field==='announcement_signature')a[field]='00'.repeat(64);
  if(field==='event_descriptor')a[field].outcomes[1]='changed';
  if(field==='nonces')a[field]=['79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'];
  expect(verifyAnnouncement(a).verified).toBe(false);
 });
 it('does not guess signing schemes or silently fall back',()=>{
  const a=copy(tagged[0].announcement);delete a.protocol_revision;expect(verifyAnnouncement(a).verified).toBe(false);
  a.protocol_revision='rust-dlc-legacy-sha256';expect(verifyAnnouncement(a).verified).toBe(false);
  const legacy=officialAnnouncement('enum_single_oracle_test');legacy.protocol_revision='dlcspecs-tagged-v0';expect(verifyAnnouncement(legacy).verified).toBe(false);
 });
 it('requires a signed announcement and binds key, event, ordered nonces and outcomes',()=>{
  for(const field of ['announcement','event_id','oracle_public_key','outcomes','signatures','announcement_id']){
   const a=copy(tagged[0].attestation);
   if(field==='announcement')delete a.announcement;
   if(field==='event_id')a.event_id='other';
   if(field==='oracle_public_key')a.oracle_public_key='00'.repeat(32);
   if(field==='outcomes')a.outcomes=['sunny'];
   if(field==='signatures')a.signatures=[tagged[1].attestation.signatures[0]];
   if(field==='announcement_id')a.announcement_id='wrong';
   expect(verifyAttestation(a).verified).toBe(false);
  }
  const a=copy(tagged[1].attestation);a.outcomes.reverse();a.signatures.reverse();expect(verifyAttestation(a).verified).toBe(false);
 });
 it('rejects missing signatures, invalid digits, nonce duplication and invalid curve points',()=>{
  const a=copy(tagged[1].attestation);a.signatures.pop();expect(verifyAttestation(a).verified).toBe(false);
  a.signatures=tagged[1].attestation.signatures;a.outcomes[1]='16';expect(verifyAttestation(a).verified).toBe(false);
  const b=copy(tagged[1].announcement);b.nonces[1]=b.nonces[0];expect(verifyAnnouncement(b).errors).toContain('Duplicate nonce points detected in announcement');
  b.nonces[1]='ff'.repeat(32);expect(verifyAnnouncement(b).verified).toBe(false);
 });
 it('normalizes NFC exactly and rejects malformed UTF-16 rather than substituting bytes',()=>{
  const a=copy(tagged[0].attestation);a.outcomes=['A\u030a'];a.announcement.event_descriptor.outcomes[0]='A\u030a';expect(verifyAttestation(a).verified).toBe(true);
  a.outcomes=['\ud800'];expect(verifyAttestation(a).verified).toBe(false);
 });
 it('binds supplied original serialized bytes',()=>{
  const a=copy(tagged[0].announcement),v=verifyAnnouncement(a);a.original_bytes_hex=v.announcement_bytes_hex;expect(verifyAnnouncement(a).verified).toBe(true);
  a.original_bytes_hex+='00';expect(verifyAnnouncement(a).verified).toBe(false);
 });
 it.each([null,{},[],true,'invalid'])('safely rejects malformed payloads',v=>{expect(verifyAnnouncement(v).verified).toBe(false);expect(verifyAttestation(v).verified).toBe(false);});
 it('verifies every official DLC Schnorr vector with the actual crypto engine',()=>{
  const vectors=JSON.parse(readFileSync(resolve(vectorRoot,'dlc_schnorr_test.json'),'utf8'));
  for(const v of vectors)expect(secp.verifySchnorr(Buffer.from(v.inputs.msgHash,'hex'),Buffer.from(v.pubKey,'hex'),Buffer.from(v.signature,'hex'))).toBe(true);
 });
 it('uses distinct domain separated announcement and attestation message digests',()=>{expect(oracleHash('announcement/v0',Buffer.from('same'))).not.toEqual(oracleHash('attestation/v0',Buffer.from('same')));});
});

it('matches all published Unicode normalization/hash vectors',()=>{
 const vectors=JSON.parse(readFileSync(resolve(vectorRoot,'dlc_hash_test.json'),'utf8'));
 const crypto=require('crypto');
 for(const vector of vectors)for(const text of vector.Variants){const bytes=Buffer.from(text.normalize('NFC'),'utf8');expect(bytes.toString('hex')).toBe(vector.Expected);expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(vector.SHA256);}
});
