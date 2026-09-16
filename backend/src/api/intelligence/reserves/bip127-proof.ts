import { Transaction, payments, script, crypto as btc } from 'bitcoinjs-lib';
import * as secp from 'tiny-secp256k1';
import { createHash } from 'crypto';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import config from '../../../config';
const GENESIS:Record<string,string>={mainnet:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',signet:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',testnet:'000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',testnet4:'00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',regtest:'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'};
/** No transaction is submitted: read current confirmed UTXOs and check native P2WPKH signatures.  @asyncUnsafe rejections propagate to the caller, which handles them. */
export async function verifyBip127(proof:any, reader=bitcoinClient, network=config.MEMPOOL.NETWORK) {
  const fail=(message:string):never=>{throw new Error(message);};
  const deadline=Date.now()+15000;
  const read=async <T>(operation:()=>Promise<T>):Promise<T>=>{
    const remaining=deadline-Date.now();if(remaining<=0)fail('Owned UTXO verification exceeded its 15-second limit.');
    let timer:NodeJS.Timeout|undefined;
    try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned UTXO verification exceeded its 15-second limit.')),remaining);})]);}
    finally{if(timer)clearTimeout(timer);}
  };
  if(!proof || typeof proof.transaction_hex!=='string'||!/^([0-9a-f]{2})+$/.test(proof.transaction_hex)||proof.transaction_hex.length>200_000||typeof proof.expected_message!=='string'||Buffer.byteLength(proof.expected_message)<1||Buffer.byteLength(proof.expected_message)>4096) fail('BIP127 requires transaction_hex (at most 100 KiB) and expected_message; ad-hoc signature items are not BIP127 transactions.');
  const tx=Transaction.fromHex(proof.transaction_hex);
  if(tx.ins.length<2||tx.ins.length>101||tx.outs.length!==1) fail('BIP127 requires one commitment input, 1–100 reserve inputs and exactly one output.');
  if(![1,2].includes(tx.version)||tx.locktime!==0||tx.ins.some(input=>input.sequence!==0xffffffff)) fail('Unsupported BIP127 timelock context: require transaction version 1 or 2, zero locktime and final input sequences.');
  const commitment=createHash('sha256').update('Proof-of-Reserves: '+proof.expected_message).digest();
  if(!Buffer.from(tx.ins[0].hash).reverse().equals(commitment)||tx.ins[0].index!==0||tx.ins[0].script.length||tx.ins[0].witness.length) fail('Commitment outpoint or empty commitment unlocking data is invalid.');
  const unique=new Set<string>();
  for(const input of tx.ins.slice(1)){const id=input.hash.toString('hex')+':'+input.index;if(unique.has(id)) fail('Duplicate reserve outpoint.');unique.add(id);}
  if(await read(()=>reader.getBlockHash(0))!==GENESIS[network]) fail('Owned UTXO reader is on a different or unsupported network.');
  const tip=await read(()=>reader.getBestBlockHash()); let total=0;
  for(let i=1;i<tx.ins.length;i++) {
    const input=tx.ins[i]; const out=await read<any>(()=>reader.getTxOut(Buffer.from(input.hash).reverse().toString('hex'),input.index,true));
    if(!out || out.bestblock!==tip || !Number.isSafeInteger(out.confirmations)||out.confirmations<1||(out.coinbase&&out.confirmations<100)) fail('A reserve outpoint is missing, spent, immature or not confirmed at the observed tip.');
    const value=Math.round(out.value*100_000_000);
    if(!Number.isSafeInteger(value)||value<0||value>2_100_000_000_000_000||Number((value/100_000_000).toFixed(8))!==out.value) fail('Owned UTXO amount is invalid.');
    const locking=Buffer.from(out.scriptPubKey.hex,'hex');
    if(locking.length!==22||locking[0]!==0||locking[1]!==20||input.script.length||input.witness.length!==2) fail('Unsupported BIP127 spending template: this verifier currently accepts native P2WPKH reserve inputs only.');
    const [signature,key]=input.witness;
    if(key.length!==33 || !btc.hash160(key).equals(locking.subarray(2))) fail('Reserve public key does not match its owned UTXO.');
    const decoded=script.signature.decode(signature);
    if(decoded.hashType!==Transaction.SIGHASH_ALL) fail('Every reserve signature must use SIGHASH_ALL without ANYONECANPAY.');
    const digest=tx.hashForWitnessV0(i,payments.p2pkh({pubkey:key}).output!,value,decoded.hashType);
    if(!secp.verify(digest,key,decoded.signature,true)) fail('Reserve input signature is invalid.');
    total+=value; if(!Number.isSafeInteger(total)||total>2_100_000_000_000_000) fail('Reserve sum exceeds monetary bounds.');
  }
  if(tx.outs[0].value!==total) fail('The single output must equal the exact owned input sum (zero fee).');
  if(await read(()=>reader.getBestBlockHash())!==tip) fail('Owned chain tip changed during verification; retry.');
  return {verified:true,total_verified_sats:total,verified_items_count:tx.ins.length-1,attestation_digest:createHash('sha256').update(Buffer.from(proof.transaction_hex,'hex')).digest('hex'),errors:[],authenticated_root:false,solvency_verified:false,
    scope:'BIP127 native P2WPKH signatures and currently confirmed unspent inputs at owned chain tip '+tip+'. The supplied message is bound; provider identity, full liabilities, historical ownership and solvency are not established.',warnings:['Current-tip evidence only. No provider identity or liability completeness was authenticated.']};
}
