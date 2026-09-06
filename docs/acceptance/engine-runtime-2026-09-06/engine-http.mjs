import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin=process.argv[2] || 'http://127.0.0.1:3410';
if (!['http://127.0.0.1:3410','http://127.0.0.1:4310'].includes(origin)) throw new Error('Unexpected local candidate origin');
const backend='D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5/backend';
const vectors=JSON.parse(fs.readFileSync(backend+'/src/api/intelligence/multiparty/vectors/sig_agg_vectors.json','utf8'));
const vector=vectors.valid_test_cases.find(test=>test.tweak_indices.length===0);
const transcript={participant_public_keys:vector.key_indices.map(index=>vectors.pubkeys[index]),public_nonces:vector.nonce_indices.map(index=>vectors.pnonces[index]),partial_signatures:vector.psig_indices.map(index=>vectors.psigs[index]),aggregate_nonce:vector.aggnonce,message_hash:vectors.msg,final_signature:vector.expected};
fs.writeFileSync(new URL('public-musig2-transcript.json',import.meta.url),JSON.stringify(transcript,null,2));
const fixtures=backend+'/src/api/intelligence/opentimestamps/__fixtures__/';
const proof=name=>fs.readFileSync(fixtures+name).toString('base64');
const digest='03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340';
const evidence={startedAt:new Date().toISOString(),origin,scope:'Actual candidate monolith HTTP; no intercepted responses; BIP327 public transcript verification and historical Bitcoin .ots commitment reads through configured Universe-owned Esplora',observations:[]};
async function request(name,path,body,expectedStatus,check){
  const response=await fetch(origin+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  const result=await response.json();
  const row={name,path,method:body?'POST':'GET',request:body??null,status:response.status,response:result,observedAt:new Date().toISOString()};
  evidence.observations.push(row);
  assert.equal(response.status,expectedStatus,name);check(result);row.assertions='PASS';
  return result;
}
try {
  await request('candidate identity','/api/v1/backend-info',null,200,result=>assert.match(JSON.stringify(result),/0a8e157/));
  const m='/api/v1/intelligence/multiparty/public-sessions/verify';
  await request('complete public transcript',m,transcript,200,r=>{assert.equal(r.verified,true);assert.equal(r.stage,'verified-session');assert.ok(r.partial_signature_validity.every(Boolean));assert.equal(r.final_signature,vector.expected.toLowerCase());});
  await request('corrupt partial rejected',m,{...transcript,partial_signatures:['00'.repeat(32),transcript.partial_signatures[1]]},400,r=>assert.equal(r.verified,false));
  await request('key aggregation scope',m,{participant_public_keys:transcript.participant_public_keys,message_hash:transcript.message_hash},200,r=>{assert.equal(r.verified,false);assert.equal(r.key_aggregation_verified,true);assert.equal(r.stage,'partial-session');});
  await request('unsupported tweak rejected',m,{...transcript,tweaks:['01'.repeat(32)]},400,r=>assert.equal(r.verified,false));
  const t='/api/v1/intelligence/timestamps/proofs/verify';
  const valid={proof:proof('hello-world.txt.ots'),digest,network:'mainnet'};
  const anchored=r=>{assert.equal(r.verified,true);assert.equal(r.digest_matches,true);assert.equal(r.status,'bitcoin_attestation_verified');assert.equal(r.network,'mainnet');assert.equal(r.earliest_proven_block_height,358391);assert.equal(r.bitcoin_block_hash,'000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319');assert.equal(r.earliest_proven_time_utc,'2015-05-28T15:41:18.000Z');};
  await request('actual owned-header anchored proof',t,valid,200,anchored);
  await request('document mismatch',t,{...valid,digest:'ff'.repeat(32)},200,r=>{assert.equal(r.verified,false);assert.equal(r.status,'file_mismatch');});
  await request('invalid Bitcoin commitment',t,{proof:proof('bad-stamp.txt.ots'),digest:'7e3717bbe020f53cdc6c40154a1a8e55bddc13a28c8bb3c82e9ee64b81b44872',network:'mainnet'},200,r=>{assert.equal(r.verified,false);assert.equal(r.status,'bitcoin_attestation_invalid');});
  await request('pending calendar without fetching it',t,{proof:proof('incomplete.txt.ots'),network:'mainnet'},200,r=>{assert.equal(r.verified,false);assert.equal(r.status,'pending_calendar_attestation');});
  await request('unknown notary',t,{proof:proof('unknown-notary.txt.ots'),network:'mainnet'},200,r=>{assert.equal(r.verified,false);assert.equal(r.status,'unsupported_attestation');});
  await request('wrong network cannot inherit mainnet',t,{...valid,network:'signet'},200,r=>{assert.equal(r.verified,false);assert.equal(r.status,'network_mismatch');});
  await request('malformed proof rejected',t,{proof:'not-a-proof'},400,r=>assert.match(r.stage,/invalid-proof/));
  await request('subsequent valid proof recovers',t,valid,200,anchored);
  evidence.result='PASS SCOPED ASSERTIONS';
} catch(error) {evidence.result='FAIL';evidence.error=String(error);process.exitCode=1;}
finally {evidence.finishedAt=new Date().toISOString();fs.writeFileSync(new URL(`engine-http-${origin.endsWith('3410')?'direct':'gateway'}.json`,import.meta.url),JSON.stringify(evidence,null,2));console.log(JSON.stringify({result:evidence.result,count:evidence.observations.length,error:evidence.error}));}
