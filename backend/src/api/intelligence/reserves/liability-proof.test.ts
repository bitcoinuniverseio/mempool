import { createHash, generateKeyPairSync, sign } from 'crypto';
import { mkdtempSync,writeFileSync,rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { AddressInfo } from 'net';
import { leafHash,rootMessage,TREE_SCHEME,verifyLiabilityProof,TrustedProvider } from './liability-proof';
import routes from './reserves.routes';
import config from '../../../config';
const keys=generateKeyPairSync('ed25519');
const provider:TrustedProvider={provider_id:'test-provider',name:'Test provider',key_id:'key-1',public_key_pem:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
const leaf={account_id:'account',nonce:'ab'.repeat(16),liability_sats:12345};
function proof(){const p:any={scheme:TREE_SCHEME,leaf:{...leaf},merkle_root:leafHash(leaf).toString('hex'),path:[],index:0};p.attestation={provider_id:provider.provider_id,key_id:provider.key_id,network:config.MEMPOOL.NETWORK,scheme:TREE_SCHEME,snapshot_id:'s1',merkle_root:p.merkle_root,total_liability_sats:12345,issued_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),signature:''};p.attestation.signature=sign(null,rootMessage(p.attestation),keys.privateKey).toString('hex');return p;}
describe('committed liability evidence',()=>{
 it('derives authenticated amounts only from signed-root included leaf',()=>{expect(verifyLiabilityProof(proof(),[provider])).toMatchObject({verified:true,total_verified_sats:12345,verified_items_count:1,solvency_verified:false});});
 it('separates mathematical inclusion from an untrusted root',()=>{expect(verifyLiabilityProof(proof(),[])).toMatchObject({verified:false,inclusion_verified:true,total_verified_sats:0,verified_items_count:0});});
 it.each(['amount','root','signature','network','expiry'])('rejects tampered %s without verified totals',field=>{const p=proof();if(field==='amount')p.leaf.liability_sats++;if(field==='root')p.merkle_root='ff'.repeat(32);if(field==='signature')p.attestation.signature='00'.repeat(64);if(field==='network')p.attestation.network='other';if(field==='expiry')p.attestation.expires_at='2000-01-01T00:00:00.000Z';expect(verifyLiabilityProof(p,[provider])).toMatchObject({verified:false,total_verified_sats:0,verified_items_count:0});});
 it('rejects legacy caller amounts, malformed paths and oversized indices',()=>{const p=proof();p.expected_liability_sats=999;expect(()=>verifyLiabilityProof(p,[provider])).toThrow(/Expected liability/);delete p.expected_liability_sats;p.index=1;expect(()=>verifyLiabilityProof(p,[provider])).toThrow(/index/);p.index=0;p.path=Array(33).fill('ff'.repeat(32));expect(()=>verifyLiabilityProof(p,[provider])).toThrow();});
 it('uses binary domain-separated directional nodes',()=>{const p=proof();delete p.attestation;const sibling=Buffer.alloc(32,1);p.path=[sibling.toString('hex')];p.index=1;p.merkle_root=createHash('sha256').update(Buffer.from([1])).update(sibling).update(leafHash(leaf)).digest('hex');expect(verifyLiabilityProof(p,[]).inclusion_verified).toBe(true);p.index=0;expect(verifyLiabilityProof(p,[]).inclusion_verified).toBe(false);});
 it('serves signed and tampered proofs over actual local HTTP',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reserves-http-'));const previous=process.env.UNIVERSE_RESERVES_TRUST_STORE;const previousAttestations=process.env.UNIVERSE_RESERVES_ATTESTATIONS;const file=join(directory,'trust.json');writeFileSync(file,JSON.stringify({schema:'universe-reserves-trust-v1',providers:[provider]}));process.env.UNIVERSE_RESERVES_TRUST_STORE=file;
  const app=express();app.use(express.json({limit:'256kb'}));routes.initRoutes(app);const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try{const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/intelligence/reserves/verify`;const p=proof();const send=async()=>{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({proof_type:'merkle_inclusion',merkle_proof:p})});expect(r.status).toBe(200);return r.json() as Promise<any>;};expect(await send()).toMatchObject({verified:true,total_verified_sats:12345});
const source=join(directory,'attestations.json');writeFileSync(source,JSON.stringify({schema:'universe-reserves-attestations-v1',attestations:[p.attestation]}));process.env.UNIVERSE_RESERVES_ATTESTATIONS=source;
const base=url.replace('/verify','');const providers=await (await fetch(base+'/providers')).json() as any;expect(providers[0]).toMatchObject({provider_id:'test-provider',total_reserve_sats:null,solvency_ratio_percentage:null});
const snapshots=await (await fetch(base+'/snapshots')).json() as any;expect(snapshots[0]).toMatchObject({authenticated_root:true,attested_liability_sats:12345,total_reserve_sats:null,verified_onchain:false});
p.attestation.signature='ff'.repeat(64);writeFileSync(source,JSON.stringify({schema:'universe-reserves-attestations-v1',attestations:[p.attestation]}));expect((await fetch(base+'/snapshots')).status).toBe(503);
p.leaf.liability_sats++;expect(await send()).toMatchObject({verified:false,total_verified_sats:0,verified_items_count:0});}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));if(previous===undefined)delete process.env.UNIVERSE_RESERVES_TRUST_STORE;else process.env.UNIVERSE_RESERVES_TRUST_STORE=previous;if(previousAttestations===undefined)delete process.env.UNIVERSE_RESERVES_ATTESTATIONS;else process.env.UNIVERSE_RESERVES_ATTESTATIONS=previousAttestations;rmSync(directory,{recursive:true,force:true});}
 });
});
