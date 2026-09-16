import { readFileSync,statSync } from 'fs';
import { trustedProviders,RootAttestation,TREE_SCHEME } from './liability-proof';
import { ReserveProvider,ReserveSnapshot } from './reserves.models';
import config from '../../../config';
import { createPublicKey,verify } from 'crypto';
import { rootMessage } from './liability-proof';
/** Operator-owned sources only. A key registry does not establish balances. */
export function providerDirectory():ReserveProvider[]{
 return [...new Map(trustedProviders().map(p=>[p.provider_id,p])).values()].map(p=>({provider_id:p.provider_id,name:p.name,category:'unclassified',attestation_frequency:'unknown',total_reserve_sats:null,total_liability_sats:null,solvency_ratio_percentage:null,last_attestation_height:null,last_attestation_utc:null,proof_standard:'signed_liability_root',website_url:p.website_url||'',status:'key_configured'}));
}
export function signedSnapshots():ReserveSnapshot[]{
 const path=process.env.UNIVERSE_RESERVES_ATTESTATIONS;
 if(!path) throw new Error('No operator attestation source is configured.');
 if(statSync(path).size>1024*1024)throw new Error('Attestation source exceeds 1 MiB.');
 const source=JSON.parse(readFileSync(path,'utf8'));const providers=trustedProviders();
 if(source.schema!=='universe-reserves-attestations-v1'||!Array.isArray(source.attestations)||source.attestations.length>500)throw new Error('Invalid attestation source.');
 const ids=new Set<string>();
 return source.attestations.map((a:RootAttestation)=>{
  const provider=providers.find(p=>p.provider_id===a.provider_id&&p.key_id===a.key_id);const now=Date.now();
  if(!provider||a.network!==config.MEMPOOL.NETWORK||a.scheme!==TREE_SCHEME||!/^[0-9a-f]{64}$/.test(a.merkle_root)||!/^[0-9a-f]{128}$/.test(a.signature)||typeof a.snapshot_id!=='string'||!a.snapshot_id.length||a.snapshot_id.length>128||ids.has(a.snapshot_id)||!Number.isSafeInteger(a.total_liability_sats)||a.total_liability_sats<0||a.total_liability_sats>2_100_000_000_000_000||!Number.isFinite(Date.parse(a.issued_at))||!Number.isFinite(Date.parse(a.expires_at))||Date.parse(a.issued_at)>now||Date.parse(a.expires_at)<=now||Date.parse(a.expires_at)<=Date.parse(a.issued_at)||!verify(null,rootMessage(a),createPublicKey(provider.public_key_pem),Buffer.from(a.signature,'hex')))throw new Error('Attestation source contains an invalid, expired, untrusted or duplicate signed root.');
  ids.add(a.snapshot_id);
  return{snapshot_id:a.snapshot_id,provider_id:a.provider_id,block_height:null,block_hash:null,timestamp_utc:a.issued_at,total_reserve_sats:null,total_liability_sats:null,solvency_ratio:null,merkle_root:a.merkle_root,utxo_count:null,signature_count:1,verified_onchain:false,authenticated_root:true,attested_liability_sats:a.total_liability_sats,evidence_scope:'Operator-pinned provider signed this liability root and declared total. Reserve ownership, full liabilities, Merkle-sum consistency and solvency have not been established.'};
 });
}
