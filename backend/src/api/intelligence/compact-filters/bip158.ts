/** BIP158 basic-filter codec. No network access. Integers remain exact through BigInt. */
export function decodeBasicFilter(hex: string): bigint[] {
 if (!/^(?:[0-9a-f]{2}){1,1000000}$/i.test(hex)) throw Error('Malformed or oversized basic filter');
 const bytes=Uint8Array.from(hex.match(/../g)!,x=>parseInt(x,16)); let cursor=1; let n=bytes[0];
 if(n===253){if(bytes.length<3)throw Error('Truncated CompactSize');n=bytes[1]+bytes[2]*256;cursor=3;if(n<253)throw Error('Noncanonical CompactSize');}
 else if(n===254){if(bytes.length<5)throw Error('Truncated CompactSize');n=bytes[1]+bytes[2]*256+bytes[3]*65536+bytes[4]*16777216;cursor=5;if(n<65536)throw Error('Noncanonical CompactSize');}
 else if(n===255)throw Error('Filter element count exceeds bounded decoder');
 if(n>100000)throw Error('Filter element count exceeds bounded decoder');
 let bit=cursor*8;const read=()=>{if(bit>=bytes.length*8)throw Error('Truncated Golomb-Rice stream');return(bytes[bit>>3]>>(7-(bit++&7)))&1;};
 const values:bigint[]=[];let value=0n;const limit=BigInt(n)*784931n;
 for(let i=0;i<n;i++){let q=0n;while(read()){q++;if((q<<19n)>=limit)throw Error('Golomb-Rice quotient exceeds filter range');}let remainder=0n;for(let j=0;j<19;j++)remainder=(remainder<<1n)|BigInt(read());value+=(q<<19n)|remainder;if(value>=limit)throw Error('Filter value exceeds mapped range');values.push(value);}
 if(bytes.length*8-bit>=8)throw Error('Noncanonical trailing filter bytes');while(bit<bytes.length*8)if(read())throw Error('Nonzero filter padding');return values;
}
const mask=(1n<<64n)-1n;
/** SipHash-2-4, keyed by the first16 bytes of the internal block hash. */
export function siphash24(key:Uint8Array,data:Uint8Array):bigint {
 if(key.length!==16)throw Error('SipHash key must be16 bytes');
 const le=(b:Uint8Array)=>Array.from(b).reduce((v,x,i)=>v|(BigInt(x)<<BigInt(8*i)),0n);
 const k0=le(key.slice(0,8)),k1=le(key.slice(8));let v0=0x736f6d6570736575n^k0,v1=0x646f72616e646f6dn^k1,v2=0x6c7967656e657261n^k0,v3=0x7465646279746573n^k1;
 const rot=(x:bigint,n:bigint)=>((x<<n)|(x>>(64n-n)))&mask;
 const round=()=>{v0=(v0+v1)&mask;v1=rot(v1,13n)^v0;v0=rot(v0,32n);v2=(v2+v3)&mask;v3=rot(v3,16n)^v2;v0=(v0+v3)&mask;v3=rot(v3,21n)^v0;v2=(v2+v1)&mask;v1=rot(v1,17n)^v2;v2=rot(v2,32n);};
 let pos=0;for(;pos+8<=data.length;pos+=8){const m=le(data.slice(pos,pos+8));v3^=m;round();round();v0^=m;}const last=le(data.slice(pos))|(BigInt(data.length&255)<<56n);v3^=last;round();round();v0^=last;v2^=255n;round();round();round();round();return(v0^v1^v2^v3)&mask;
}
export function matchesBasicFilter(filterHex:string,blockHash:string,scripts:Uint8Array[]):boolean {
 if(!/^[0-9a-f]{64}$/i.test(blockHash)||scripts.length>1000||scripts.some(s=>s.length>10000))throw Error('Invalid matching input');
 const values=decodeBasicFilter(filterHex);if(!values.length)return false;
 const key=Uint8Array.from(blockHash.match(/../g)!.reverse().slice(0,16),x=>parseInt(x,16));const targets=new Set(values.map(String));
 return scripts.some(script=>targets.has(((siphash24(key,script)*BigInt(values.length)*784931n)>>64n).toString()));
}
