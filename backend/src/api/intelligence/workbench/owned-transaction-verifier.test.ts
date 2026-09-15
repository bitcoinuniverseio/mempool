import { Transaction } from 'bitcoinjs-lib';
import { verifyOwnedTransactionInput } from './owned-transaction-verifier';
import { verifyTransactionScripts } from './transaction-script-verifier';
jest.mock('./workbench-core',()=>({ownedWorkbenchCore:{}}));
jest.mock('./transaction-script-verifier',()=>({verifyTransactionScripts:jest.fn(async()=>({engine:'native',results:[{script_valid:true}]}))}));
const previous=new Transaction();previous.addInput(Buffer.alloc(32,1),0);previous.addOutput(Buffer.from('51','hex'),12345);
const tx=new Transaction();tx.addInput(Buffer.from(previous.getId(),'hex').reverse(),0);tx.addOutput(Buffer.from('51','hex'),12000);
const hash='22'.repeat(32);
const core=(chain='regtest',bytes=previous.toHex())=>({network:'regtest',call:jest.fn(async(method:string)=>method==='getblockchaininfo'?{chain,bestblockhash:hash,blocks:104}:bytes)});
describe('Owned complete transaction context',()=>{
 beforeEach(()=>jest.clearAllMocks());
 it('binds all native previous outputs to owned raw transaction bytes',async()=>{const result=await verifyOwnedTransactionInput(tx.toHex(),0,core());expect(verifyTransactionScripts).toHaveBeenCalledWith([{transaction_hex:tx.toHex(),input_index:0,previous_outputs:[{txid:previous.getId(),vout:0,script_hex:'51',amount_sats:12345}]}]);expect(result).toMatchObject({whole_transaction_valid:null,spendable_now:null,source:{network:'regtest'}});});
 it('rejects caller input index before source reads',async()=>{const c=core();await expect(verifyOwnedTransactionInput(tx.toHex(),1,c)).rejects.toMatchObject({status:400});expect(c.call).not.toHaveBeenCalled();});
 it('rejects wrong owned network',async()=>{await expect(verifyOwnedTransactionInput(tx.toHex(),0,core('signet'))).rejects.toMatchObject({status:503});expect(verifyTransactionScripts).not.toHaveBeenCalled();});
 it('rejects unrelated returned transaction bytes',async()=>{await expect(verifyOwnedTransactionInput(tx.toHex(),0,core('regtest',tx.toHex()))).rejects.toMatchObject({status:503});expect(verifyTransactionScripts).not.toHaveBeenCalled();});
});
