export class UtxoEvidenceError extends Error {constructor(public readonly code:string,message:string,public readonly status=503){super(message);}}
export const UTXO_LIMITS={coins:100000,undoBlocks:288,undoOperations:300000,blocksPerSync:250,rawBlockBytes:4000000,history:288,sourceFreshMs:30000} as const;
export const GENESIS:Record<string,string>={mainnet:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',signet:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',testnet:'000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',testnet4:'00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',regtest:'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'};
export const MAX_SATS=2100000000000000;
export function integer(value:unknown,max=Number.MAX_SAFE_INTEGER):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)throw new UtxoEvidenceError('invalid-utxo-source','Invalid bounded UTXO integer.');return value;}
export function btcToSats(value:unknown):number{
 if(typeof value!=='number'&&typeof value!=='string')throw new UtxoEvidenceError('invalid-utxo-source','Invalid Bitcoin amount.');
 const match=/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));if(!match)throw new UtxoEvidenceError('invalid-utxo-source','Invalid Bitcoin amount.');
 const exponent=Number(match[3]??0)-(match[2]?.length??0)+8;if(Math.abs(exponent)>30)throw new UtxoEvidenceError('invalid-utxo-source','Bitcoin amount precision exceeds bounds.');let sats=BigInt(match[1]+(match[2]??''));if(exponent>=0)sats*=10n**BigInt(exponent);else{const divisor=10n**BigInt(-exponent);if(sats%divisor)throw new UtxoEvidenceError('invalid-utxo-source','Fractional satoshis are unsupported.');sats/=divisor;}if(sats>BigInt(MAX_SATS))throw new UtxoEvidenceError('invalid-utxo-source','Bitcoin amount exceeds maximum supply.');return Number(sats);
}
