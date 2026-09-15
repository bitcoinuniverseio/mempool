import { Transaction } from 'bitcoinjs-lib';
import { WorkbenchCoreReader, ownedWorkbenchCore } from './workbench-core';
import { verifyTransactionScripts } from './transaction-script-verifier';
import { CompilerError } from './miniscript-compiler';
export async function verifyOwnedTransactionInput(raw: unknown, inputIndex: unknown, core: WorkbenchCoreReader = ownedWorkbenchCore) {
  if (typeof raw !== 'string' || raw.length > 400000 || !/^(?:[0-9a-f]{2})+$/i.test(raw) || !Number.isSafeInteger(inputIndex) || Number(inputIndex) < 0) throw new CompilerError('invalid-transaction-context', 'Supply transaction hex and a nonnegative input index.', 400);
  let tx: Transaction; try { tx = Transaction.fromHex(raw); } catch { throw new CompilerError('invalid-transaction', 'Transaction bytes could not be decoded.', 400); }
  if (!tx.ins.length || tx.ins.length > 32 || Number(inputIndex) >= tx.ins.length) throw new CompilerError('invalid-input-count', 'This owned-source verifier supports one to 32 inputs and an index inside that range.', 400);
  const expected = {mainnet:'main',testnet:'test',testnet4:'testnet4',signet:'signet',regtest:'regtest'}[core.network];
  const call = async (method: string, params: unknown[]) => { try { return await core.call(method,params); } catch { throw new CompilerError('missing-transaction-context', 'The owned source cannot resolve the required transaction context.', 503); } };
  const before = await call('getblockchaininfo',[]);
  if (!expected || before.chain !== expected || !/^[0-9a-f]{64}$/.test(before.bestblockhash)) throw new CompilerError('wrong-network','Owned source network/checkpoint mismatch.',503);
  const previous_outputs: Array<{txid:string;vout:number;script_hex:string;amount_sats:number}> = [];
  const cache = new Map<string,Transaction>();
  for (const input of tx.ins) {
    const id=Buffer.from(input.hash).reverse().toString('hex');let previous=cache.get(id);
    if (!previous) {
      const bytes=await call('getrawtransaction',[id,false]);
      try { if (typeof bytes !== 'string' || bytes.length > 8000000) throw Error();previous=Transaction.fromHex(bytes);if (previous.getId()!==id) throw Error(); } catch { throw new CompilerError('invalid-source-transaction','Owned previous transaction bytes do not match their identifier.',503); }
      cache.set(id,previous);
    }
    const output=previous.outs[input.index];
    if (!output) throw new CompilerError('invalid-outpoint','An input references an output absent from its owned-source transaction.',400);
    previous_outputs.push({txid:id,vout:input.index,script_hex:output.script.toString('hex'),amount_sats:output.value});
  }
  const result=await verifyTransactionScripts([{transaction_hex:raw,input_index:Number(inputIndex),previous_outputs}]);
  const after=await call('getblockchaininfo',[]);
  if (after.chain!==before.chain || after.bestblockhash!==before.bestblockhash) throw new CompilerError('source-changed','Chain checkpoint changed; retry verification.',503);
  return {...result,txid:tx.getId(),input_index:inputIndex,previous_outputs,whole_transaction_valid:null,spendable_now:null,
    scope:'Selected input script executed using complete previous-output amounts and scripts independently read from the owned Bitcoin source. Historical spent outputs may supply context; current UTXO availability, maturity, fee policy and whole-transaction acceptance are not evaluated.',
    source:{network:core.network,block_hash:before.bestblockhash,block_height:before.blocks,observed_at:new Date().toISOString()}};
}
