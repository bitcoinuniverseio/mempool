import {base64url,base64urlnopad,bech32,bech32m} from '@scure/base';
import {secp256k1} from '@noble/curves/secp256k1';
import {bytesToHex} from '@noble/hashes/utils';
const MAX=65536;
const utf8=new TextDecoder('utf-8',{fatal:true});
function fail():never {throw new Error('Malformed or unsupported artifact encoding.');}
function object(v:any):any {if(!v||typeof v!=='object'||Array.isArray(v)||v instanceof Uint8Array)fail();return v;}
function array(v:any):any[]{if(!Array.isArray(v)||!v.length||v.length>1024)fail();return v;}
function string(v:any):string {if(typeof v!=='string'||!v.length||v.length>8192)fail();return v;}
function url(v:any,protocols:string[]):string {const u=new URL(string(v));if(!protocols.includes(u.protocol))fail();return u.href;}
function publicUrl(value:string,secrets:string[]):string {const u=new URL(value);u.username='';u.password='';u.search='';u.hash='';const text=u.href;return secrets.some(s=>text.includes(s)||text.includes(encodeURIComponent(s)))?'[redacted endpoint]':text;}
class Reader {
 pos=0;constructor(readonly bytes:Uint8Array){}
 take(n:number):Uint8Array{if(!Number.isSafeInteger(n)||n<0||n>this.bytes.length-this.pos)fail();const a=this.bytes.slice(this.pos,this.pos+n);this.pos+=n;return a;}
 byte():number{return this.take(1)[0];}
 number(n:number):bigint{let v=0n;for(const b of this.take(n))v=(v<<8n)|BigInt(b);return v;}
 done():void{if(this.pos!==this.bytes.length)fail();}
 bigsize():number{const p=this.byte();const v=p<253?BigInt(p):this.number(p===253?2:p===254?4:8);if((p===253&&v<253n)||(p===254&&v<=65535n)||(p===255&&v<=4294967295n)||v>BigInt(MAX))fail();return Number(v);}
}
/** Definite-length CBOR profile, bounded depth/items; duplicate map keys fail closed. */
function cbor(bytes:Uint8Array):any {const r=new Reader(bytes);let nodes=0;
 function read(depth=0):any{if(depth>16||++nodes>4096)fail();const lead=r.byte(),major=lead>>5,info=lead&31;if(info>=28)fail();const n=info<24?BigInt(info):r.number(1<<(info-24));
  if(major===0)return n;
  if(major===1)return -1n-n;
  if(n>BigInt(MAX))fail();const size=Number(n);
  if(major===2)return r.take(size);if(major===3)return utf8.decode(r.take(size));
  if(major===4){if(size>4096)fail();return Array.from({length:size},()=>read(depth+1));}
  if(major===5){if(size>2048)fail();const out=Object.create(null);for(let i=0;i<size;i++){const k=read(depth+1);if(typeof k!=='string'||Object.prototype.hasOwnProperty.call(out,k))fail();out[k]=read(depth+1);}return out;}
  if(major===7&&info===20)return false;if(major===7&&info===21)return true;if(major===7&&info===22)return null;fail();
 }const out=read();r.done();return out;}
export interface CashuInspection {type:'cashu';version:'V3'|'V4';mints:string[];total_amount:string;proofs_count:number;keysets:string[];unit:string;}
export interface FedimintInspection {type:'fedimint';federation_id:string;peers_count:number;endpoints:string[];unknown_fields:number;api_secret_present:boolean;}
export function inspectCashu(input:string):CashuInspection {
 const token=input.startsWith('cashu:')?input.slice(6):input;if(token.length>MAX||!/^cashu[AB][A-Za-z0-9_-]+={0,2}$/.test(token))fail();const encoded=token.slice(6);const bytes=(encoded.includes('=')?base64url:base64urlnopad).decode(encoded);
 const v4=token[5]==='B';const data=object(v4?cbor(bytes):JSON.parse(utf8.decode(bytes)));
 let nodes=0;function bound(v:any,depth=0){if(depth>16||++nodes>4096)fail();if(v&&typeof v==='object'&&!(v instanceof Uint8Array))for(const x of Object.values(v))bound(x,depth+1);}bound(data);
 const unit=data[v4?'u':'unit'];if(unit!==undefined&&!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(string(unit)))fail();if(v4&&unit===undefined)fail();
 const groups=v4?[{mint:data.m,groups:array(data.t)}]:array(data.token).map(g=>({mint:object(g).mint,groups:[{p:object(g).proofs}]}));
 const secrets:string[]=[],mints:string[]=[],ids=new Set<string>(),seen=new Set<string>();let count=0,total=0n;
 for(const group of groups){mints.push(url(group.mint,['http:','https:']));for(const entry of group.groups){object(entry);for(const p of array(entry.p)){object(p);if(++count>1024)fail();const secret=string(p[v4?'s':'secret']);if(seen.has(secret))fail();seen.add(secret);secrets.push(secret);
  const a=p[v4?'a':'amount'];if(typeof a!=='bigint'&&(!Number.isSafeInteger(a)||a<1))fail();const amount=BigInt(a);if(amount<=0n||amount>18446744073709551615n)fail();total+=amount;
  const rawId=v4?entry.i:p.id;const id=rawId instanceof Uint8Array?bytesToHex(rawId):rawId;if(typeof id!=='string'||!/^([a-fA-F0-9]{16}|[a-fA-F0-9]{66})$/.test(id))fail();ids.add(id.toLowerCase());
  const rawC=p[v4?'c':'C'];const C=rawC instanceof Uint8Array?bytesToHex(rawC):rawC;if(typeof C!=='string'||!/^0[23][a-fA-F0-9]{64}$/.test(C))fail();secp256k1.ProjectivePoint.fromHex(C).assertValidity();
 }}}
 return {type:'cashu',version:v4?'V4':'V3',mints:mints.map(m=>publicUrl(m,secrets)),total_amount:total.toString(),proofs_count:count,keysets:[...ids].map(id=>secrets.some(s=>id.includes(s))?'[redacted]':id),unit:unit??'unit not declared'};
}
export function inspectFedimint(input:string):FedimintInspection {
 if(input.length>MAX)fail();let bytes:Uint8Array;
 if(/^fedimint/i.test(input)){const text=input.slice(8).toLowerCase(),alphabet='0123456789abcdefghijklmnopqrstuv';let bits=0,value=0;const out:number[]=[];for(const ch of text){const n=alphabet.indexOf(ch);if(n<0)fail();value|=n<<bits;bits+=5;if(bits>=8){out.push(value&255);value>>>=8;bits-=8;}}if(value!==0||bits>=5)fail();bytes=Uint8Array.from(out);}
 else {let decoded;try{decoded=bech32m.decode(input as any,MAX);}catch{decoded=bech32.decode(input as any,MAX);}if(decoded.prefix!=='fed1')fail();bytes=bech32m.fromWords(decoded.words);}
 const r=new Reader(bytes),count=r.bigsize();if(!count||count>128)fail();let id:string|null=null,unknown=0;const peers=new Map<number,string>(),secrets:string[]=[];
 for(let i=0;i<count;i++){const tag=r.bigsize();const part=new Reader(r.take(r.bigsize()));if(tag===0){const endpoint=url(utf8.decode(part.take(part.bigsize())),['ws:','wss:','http:','https:']);const peer=part.bigsize();if(peer>65535||peers.has(peer))fail();peers.set(peer,endpoint);part.done();}else if(tag===1){if(id!==null)fail();id=bytesToHex(part.take(32));part.done();}else if(tag===2){secrets.push(utf8.decode(part.take(part.bigsize())));part.done();}else unknown++;}
 r.done();if(!id||!peers.size)fail();return {type:'fedimint',federation_id:secrets.some(s=>s.length>0&&id!.includes(s))?'[redacted]':id,peers_count:peers.size,endpoints:[...peers.values()].map(u=>publicUrl(u,secrets.filter(Boolean))),unknown_fields:unknown,api_secret_present:secrets.length>0};
}
