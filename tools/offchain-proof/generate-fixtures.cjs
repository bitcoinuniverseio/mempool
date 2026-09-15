// Creates public synthetic fixtures on the explicitly supplied isolated regtest node only.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const bitcoin = require(root + '/backend/node_modules/bitcoinjs-lib');
const ecc = require(root + '/backend/node_modules/tiny-secp256k1');
bitcoin.initEccLib(ecc);
const { Transaction, payments, script, opcodes: O, crypto } = bitcoin;
const data = process.env.OFFCHAIN_REGTEST_DATADIR;
if (!data) throw Error('Explicit isolated OFFCHAIN_REGTEST_DATADIR required');
const auth = fs.readFileSync(path.join(data, 'regtest/.cookie'), 'utf8').trim();
async function rpc(method, params = [], wallet = false) {
 const response = await fetch('http://127.0.0.1:19483/' + (wallet ? 'wallet/offchain-proof' : ''), { method:'POST', headers:{ Authorization:'Basic ' + Buffer.from(auth).toString('base64'), 'Content-Type':'application/json' }, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
 const result = await response.json(); if(result.error) throw Error('Regtest RPC ' + method + ' failed: ' + result.error.code); return result.result;
}
const scalar = n => { const key = Buffer.alloc(32); key[31] = n; return key; };
const keys = [11,12,13,14,15].map(scalar), pubs = keys.map(k => Buffer.from(ecc.pointFromScalar(k,true)));
const destination = payments.p2wpkh({pubkey:pubs[4],network:bitcoin.networks.regtest}).output;
function tx(point,value,output,sequence,locktime=0) { const t=new Transaction(); t.version=2;t.locktime=locktime;t.addInput(Buffer.from(point.txid,'hex').reverse(),point.vout,sequence);t.addOutput(output,value);return t; }
function sign(t, witnessScript, amount, key) { return script.signature.encode(Buffer.from(ecc.sign(t.hashForWitnessV0(0,witnessScript,amount,1),key)),1); }
async function fund(address) { const txid=await rpc('sendtoaddress',[address,0.01],true);const raw=Transaction.fromHex(await rpc('getrawtransaction',[txid]));return {txid,vout:raw.outs.findIndex(o=>o.script.equals(bitcoin.address.toOutputScript(address,bitcoin.networks.regtest)))}; }
(async()=>{
 const info=await rpc('getblockchaininfo');if(info.chain!=='regtest')throw Error('Refusing non-regtest');
 try{await rpc('createwallet',['offchain-proof'])}catch{await rpc('loadwallet',['offchain-proof']).catch(()=>{});}
 const mining=await rpc('getnewaddress',[],true);await rpc('generatetoaddress',[101,mining]);
 const tap=payments.p2tr({internalPubkey:pubs[0].subarray(1),network:bitcoin.networks.regtest});
 const deposit=await fund(tap.address);
 const ms=payments.p2ms({m:2,pubkeys:[pubs[1],pubs[2]],network:bitcoin.networks.regtest});
 const funding=payments.p2wsh({redeem:ms,network:bitcoin.networks.regtest});
 const points=[await fund(funding.address),await fund(funding.address)];
 await rpc('generatetoaddress',[1,mining]);const height=(await rpc('getblockchaininfo')).blocks;
 const tweaked=Buffer.from(ecc.privateAdd(pubs[0][0]===3?ecc.privateNegate(keys[0]):keys[0],crypto.taggedHash('TapTweak',pubs[0].subarray(1))));
 const backups=[height+20,height+10].map(lock=>{const t=tx(deposit,999000,destination,0xfffffffe,lock);t.setWitness(0,[Buffer.from(ecc.signSchnorr(t.hashForWitnessV1(0,[tap.output],[1000000],0),tweaked))]);return {transaction_hex:t.toHex(),locktime:lock};});
 const commitment=crypto.hash160(Buffer.alloc(32,42));
 const contracts=points.map((point,i)=>{const delay=i===0?20:10;const redeem=script.compile([O.OP_SIZE,O.OP_SWAP,O.OP_HASH160,commitment,O.OP_EQUAL,O.OP_IF,pubs[3],script.number.encode(32),O.OP_1,O.OP_ELSE,pubs[4],O.OP_0,script.number.encode(delay),O.OP_ENDIF,O.OP_CHECKSEQUENCEVERIFY,O.OP_DROP,O.OP_ROT,O.OP_EQUALVERIFY,O.OP_CHECKSIG]);
 const t=tx(point,999000,payments.p2wsh({redeem:{output:redeem}}).output,0);t.setWitness(0,[Buffer.alloc(0),sign(t,ms.output,1000000,keys[1]),sign(t,ms.output,1000000,keys[2]),ms.output]);
 const refund=tx({txid:t.getId(),vout:0},998000,destination,delay);refund.setWitness(0,[sign(refund,redeem,999000,keys[4]),Buffer.alloc(0),redeem]);
 return {role:i===0?'forward_contract':'backward_contract',transaction_hex:t.toHex(),refund_transaction_hex:refund.toHex(),redeem_script_hex:redeem.toString('hex')};});
 fs.writeFileSync(path.join(__dirname,'fixtures.json'),JSON.stringify({statechain:{verification_profile:'bitcoin-backup-sequence-v1',network:'regtest',backup_transactions:backups},coinswap:{verification_profile:'teleport-p2wsh-contracts-v1',network:'regtest',contracts}},null,2)+'\n');
 console.log(JSON.stringify({network:'regtest',height,publicFixtures:path.join(__dirname,'fixtures.json'),funds:'synthetic regtest only'}));
})().catch(()=>{console.error('Isolated regtest fixture generation failed.');process.exitCode=1;});
