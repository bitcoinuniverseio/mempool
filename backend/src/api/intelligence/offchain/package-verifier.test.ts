jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {network:'regtest',call:()=>{throw Error('No test source')}} }));
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { Transaction } from 'bitcoinjs-lib';
import { OffchainPackageVerifier, teleportContract } from './package-verifier';
const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../../../../../tools/offchain-proof/fixtures.json'),'utf8'));
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const live = process.env.OFFCHAIN_REGTEST_DATADIR ? describe : describe.skip;
live('owned isolated regtest transaction verification', () => {
  const call = async (method: string, params: unknown[]) => {
    const cookie = readFileSync(join(process.env.OFFCHAIN_REGTEST_DATADIR!, 'regtest/.cookie'),'utf8').trim();
    const response = await fetch('http://127.0.0.1:19483', {method:'POST',headers:{Authorization:'Basic '+Buffer.from(cookie).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const result: any = await response.json(); if(result.error)throw Error('Owned test RPC failed'); return result.result;
  };
  const verifier = new OffchainPackageVerifier({network:'regtest',call});
  it.each(['statechain','coinswap'] as const)('verifies actual signatures and owned UTXOs: %s', async kind => {
    const result=await verifier.verify(fixtures[kind],kind);
    expect(result).toMatchObject({is_valid:true,protocol_verified:null,recovery_state:'unknown',checkpoint:{network:'regtest'},signatures_reconciled:null});
    expect(result.transactions).toHaveLength(2);
  });
  it.each(['signature','output','locktime','caller-height','wrong-network','deposit-amount','duplicate'] as const)('rejects altered backup %s',async mutation=>{
    const data=clone(fixtures.statechain),t=Transaction.fromHex(data.backup_transactions[0].transaction_hex);
    if(mutation==='signature')t.ins[0].witness[0][2]^=1;
    if(mutation==='output')t.outs[0].value--;
    if(mutation==='locktime')data.backup_transactions[0].locktime++;
    if(mutation==='caller-height')data.current_height=999999999;
    if(mutation==='wrong-network')data.network='mainnet';
    if(mutation==='deposit-amount')data.deposit_amount_sats=5;
    data.backup_transactions[0].transaction_hex=t.toHex();
    if(mutation==='duplicate')data.backup_transactions[1]=data.backup_transactions[0];
    await expect(verifier.verify(data,'statechain')).rejects.toThrow();
  });
  it.each(['refund-signature','refund-sequence','contract-script','missing-signature','roles'] as const)('rejects altered CoinSwap %s',async mutation=>{
    const data=clone(fixtures.coinswap),c=data.contracts[0],t=Transaction.fromHex(c.transaction_hex),r=Transaction.fromHex(c.refund_transaction_hex);
    if(mutation==='refund-signature')r.ins[0].witness[0][3]^=1;
    if(mutation==='refund-sequence')r.ins[0].sequence++;
    if(mutation==='contract-script')c.redeem_script_hex='00'+c.redeem_script_hex.slice(2);
    if(mutation==='missing-signature')t.ins[0].witness[1]=Buffer.alloc(0);
    if(mutation==='roles')c.role=data.contracts[1].role;
    c.transaction_hex=t.toHex();c.refund_transaction_hex=r.toHex();
    await expect(verifier.verify(data,'coinswap')).rejects.toThrow();
  });
  it.each(['height','header','network','tip','spent'] as const)('rejects inconsistent owned source %s',async mutation=>{
    let reads=0;
    const inconsistent=new OffchainPackageVerifier({network:'regtest',call:async(method,params)=>{
      const value=await call(method,params);
      if(method==='getblockchaininfo') {reads++;if(mutation==='height')value.blocks++;if(mutation==='network')value.chain='main';if(mutation==='tip'&&reads>1)value.bestblockhash='00'.repeat(32);}
      if(method==='getblockheader'&&params[1]===false&&mutation==='header')return '00'.repeat(80);
      if(method==='gettxout'&&mutation==='spent')return null;
      return value;
    }});
    await expect(inconsistent.verify(fixtures.statechain,'statechain')).rejects.toThrow();
  });
});
describe('explicit supported protocol boundary',()=>{
  it('rejects arbitrary metadata before source access',async()=>{await expect(new OffchainPackageVerifier().verify({backup_transactions:[{server_signature:'anything',locktime:1}]},'statechain')).rejects.toThrow('Unsupported protocol proof');});
  it('decodes authentic Teleport relative CSV and rejects other algorithms',()=>{expect(teleportContract(fixtures.coinswap.contracts[0].redeem_script_hex)).toMatchObject({delay:20});expect(()=>teleportContract('51')).toThrow();});
});
