import { createCipheriv,createHash } from 'crypto';
const MODULUS=(1n<<3072n)-1103717n;
function inverse(a:bigint):bigint{let oldR=MODULUS,r=a,oldT=0n,t=1n;while(r){const q=oldR/r;[oldR,r]=[r,oldR-q*r];[oldT,t]=[t,oldT-q*t];}if(oldR!==1n)throw Error('Invalid MuHash denominator');return (oldT%MODULUS+MODULUS)%MODULUS;}
function element(data:Buffer):bigint{const key=createHash('sha256').update(data).digest();const stream=createCipheriv('chacha20',key,Buffer.alloc(16));return BigInt('0x'+Buffer.concat([stream.update(Buffer.alloc(384)),stream.final()]).reverse().toString('hex'))%MODULUS;}
/** Bitcoin Core compatible MuHash3072; scalar arithmetic is intentionally bounded by the projection limits. */
export class UtxoMuHash {
 constructor(public numerator=1n,public denominator=1n){}
 insert(data:Buffer){this.numerator=this.numerator*element(data)%MODULUS;}
 remove(data:Buffer){this.denominator=this.denominator*element(data)%MODULUS;}
 digest(){const value=this.numerator*inverse(this.denominator)%MODULUS;const bytes=Buffer.from(value.toString(16).padStart(768,'0'),'hex').reverse();return createHash('sha256').update(bytes).digest().reverse().toString('hex');}
 clone(){return new UtxoMuHash(this.numerator,this.denominator);}
}
export interface UtxoCoin {txid:string;vout:number;height:number;coinbase:boolean;value:number;script:string;time:number;}
export function serializeCoin(coin:UtxoCoin):Buffer{
 const script=Buffer.from(coin.script,'hex');const prefix=Buffer.alloc(48);Buffer.from(coin.txid,'hex').reverse().copy(prefix);prefix.writeUInt32LE(coin.vout,32);prefix.writeUInt32LE(coin.height*2+Number(coin.coinbase),36);prefix.writeBigUInt64LE(BigInt(coin.value),40);
 let size:Buffer;if(script.length<253)size=Buffer.from([script.length]);else{size=Buffer.alloc(3);size[0]=253;size.writeUInt16LE(script.length,1);}return Buffer.concat([prefix,size,script]);
}
