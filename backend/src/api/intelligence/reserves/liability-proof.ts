import { createHash, createPublicKey, verify } from 'crypto';
import { readFileSync, statSync } from 'fs';
import config from '../../../config';
export const TREE_SCHEME = 'universe-liability-sha256-v1';
const HASH=/^[0-9a-f]{64}$/;
const amount=(n:unknown): n is number => Number.isSafeInteger(n) && (n as number)>=0 && (n as number)<=2_100_000_000_000_000;
const bounded=(s:unknown,max:number): s is string => typeof s==='string' && Buffer.byteLength(s)>0 && Buffer.byteLength(s)<=max;
export interface LiabilityLeaf { account_id: string; nonce: string; liability_sats: number }
export interface RootAttestation { provider_id:string; key_id:string; network:string; scheme:string; snapshot_id:string; merkle_root:string; total_liability_sats:number; issued_at:string; expires_at:string; signature:string }
export interface TrustedProvider { provider_id:string; name:string; key_id:string; public_key_pem:string; website_url?:string }
export function leafHash(leaf:LiabilityLeaf): Buffer {
  if (!leaf || !bounded(leaf.account_id,256) || !/^[0-9a-f]{32,128}$/.test(leaf.nonce) || leaf.nonce.length%2 || !amount(leaf.liability_sats)) throw new Error('Leaf requires account_id (1–256 UTF-8 bytes), 16–64 byte hex nonce and a nonnegative safe satoshi amount.');
  return createHash('sha256').update(Buffer.from([0])).update(JSON.stringify([TREE_SCHEME,leaf.account_id,leaf.nonce,String(leaf.liability_sats)])).digest();
}
export function rootMessage(a:RootAttestation): Buffer {
  return Buffer.from(JSON.stringify(['universe-reserves-root-v1',a.provider_id,a.key_id,a.network,a.scheme,a.snapshot_id,a.merkle_root,String(a.total_liability_sats),a.issued_at,a.expires_at]));
}
export function trustedProviders(): TrustedProvider[] {
  const path=process.env.UNIVERSE_RESERVES_TRUST_STORE;
  if (!path) return [];
  if(statSync(path).size>256*1024) throw new Error('Trust registry exceeds 256 KiB.');
  const value=JSON.parse(readFileSync(path,'utf8'));
  if(value.schema!=='universe-reserves-trust-v1' || !Array.isArray(value.providers) || value.providers.length>100) throw new Error('Invalid reserves trust registry.');
  const ids=new Set<string>();
  for(const p of value.providers) {
    if(!bounded(p.provider_id,128)||!bounded(p.name,256)||!bounded(p.key_id,128)||!bounded(p.public_key_pem,4096)||ids.has(p.provider_id+'\0'+p.key_id)) throw new Error('Invalid or duplicate provider trust entry.');
    if(createPublicKey(p.public_key_pem).asymmetricKeyType!=='ed25519') throw new Error('Provider key must be Ed25519.');
    ids.add(p.provider_id+'\0'+p.key_id);
  }
  return value.providers;
}
export function verifyLiabilityProof(mp:any, providers=trustedProviders(), network=config.MEMPOOL.NETWORK, now=Date.now()) {
  if(!mp || mp.scheme!==TREE_SCHEME || !HASH.test(mp.merkle_root) || !Array.isArray(mp.path) || mp.path.length>32 || !mp.path.every((s:unknown)=>typeof s==='string' && HASH.test(s)) || !Number.isSafeInteger(mp.index) || mp.index<0 || mp.index>=2**mp.path.length) throw new Error('Invalid Merkle proof: supply the explicit scheme, binary SHA-256 hashes, bounded path and valid leaf index.');
  let current=leafHash(mp.leaf); const computedLeaf=current.toString('hex');
  if(mp.leaf_hash!==undefined && mp.leaf_hash!==computedLeaf) throw new Error('Declared leaf hash differs from the committed leaf.');
  if(mp.expected_liability_sats!==undefined && mp.expected_liability_sats!==mp.leaf.liability_sats) throw new Error('Expected liability differs from the committed leaf amount.');
  let index=mp.index;
  for(const sibling of mp.path) { const other=Buffer.from(sibling,'hex'); current=createHash('sha256').update(Buffer.from([1])).update(index%2 ? Buffer.concat([other,current]) : Buffer.concat([current,other])).digest(); index=Math.floor(index/2); }
  const inclusion=current.toString('hex')===mp.merkle_root;
  let authenticated=false; const warnings:string[]=[];
  const a=mp.attestation as RootAttestation|undefined;
  if(a) {
    const provider=providers.find(p=>p.provider_id===a.provider_id && p.key_id===a.key_id);
    const issued=Date.parse(a.issued_at), expiry=Date.parse(a.expires_at);
    if(!provider) warnings.push('No operator-pinned provider key authenticates this root.');
    else if(a.network!==network || a.scheme!==TREE_SCHEME || a.merkle_root!==mp.merkle_root || !bounded(a.snapshot_id,128) || !amount(a.total_liability_sats) || a.total_liability_sats<mp.leaf.liability_sats || !Number.isFinite(issued)||!Number.isFinite(expiry)||issued>now||expiry<=now||expiry<=issued || typeof a.signature!=='string'|| !/^[0-9a-f]{128}$/.test(a.signature)) warnings.push('Attestation binding, amount, signature encoding or validity window is invalid.');
    else authenticated=verify(null,rootMessage(a),provider.public_key_pem,Buffer.from(a.signature,'hex'));
    if(provider && !authenticated && !warnings.length) warnings.push('Provider root signature is invalid.');
  } else warnings.push('Caller-supplied root has no authenticated provider attestation.');
  return { inclusion_verified:inclusion, authenticated_root:authenticated, solvency_verified:false as const,
    included_liability_sats:inclusion ? mp.leaf.liability_sats : 0,
    verified:inclusion&&authenticated, total_verified_sats:inclusion&&authenticated ? mp.leaf.liability_sats : 0,
    verified_items_count:inclusion&&authenticated ? 1 : 0, attestation_digest:current.toString('hex'),
    errors:inclusion ? [] : ['Calculated Merkle root does not match declared root.'], warnings,
    scope:'Liability leaf inclusion and optional operator-pinned Ed25519 root authentication. This is not a Merkle-sum tree, proof of complete liabilities, reserve ownership or solvency.' };
}
