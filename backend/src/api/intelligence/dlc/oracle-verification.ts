import { createHash } from 'crypto';
import * as secp from 'tiny-secp256k1';
const sha=(value:Buffer)=>createHash('sha256').update(value).digest();
export function oracleHash(tag:'announcement/v0'|'attestation/v0',message:Buffer):Buffer {
 const prefix=sha(Buffer.from('DLC/oracle/'+tag,'utf8'));return sha(Buffer.concat([prefix,prefix,message]));
}
function object(v:unknown):v is Record<string,any>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function hex(value:unknown,bytes:number):Buffer {
 if(typeof value!=='string'||value.length!==bytes*2||!/^[0-9a-f]+$/i.test(value))throw new Error('Invalid key or signature encoding.');return Buffer.from(value,'hex');
}
function point(value:unknown):Buffer {const p=hex(value,32);if(!secp.isXOnlyPoint(p))throw new Error('Invalid x-only curve point.');return p;}
function uint(value:unknown,max:number):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)throw new Error('Invalid unsigned integer.');return value;}
export function bigSize(n:number):Buffer {
 uint(n,0xffffffff);if(n<253)return Buffer.from([n]);const out=Buffer.alloc(n<=65535?3:5);out[0]=n<=65535?253:254;if(out.length===3)out.writeUInt16BE(n,1);else out.writeUInt32BE(n,1);return out;
}
function u16(n:number):Buffer {const out=Buffer.alloc(2);out.writeUInt16BE(uint(n,65535));return out;}
function text(value:unknown,max=1024):string {
 if(typeof value!=='string'||value.length>max)throw new Error('Invalid bounded UTF-8 string.');
 const normalized=value.normalize('NFC'),bytes=Buffer.from(normalized,'utf8');
 if(bytes.length>max||bytes.toString('utf8')!==normalized)throw new Error('Invalid UTF-8 string.');return normalized;
}
function string(value:string):Buffer {const bytes=Buffer.from(value,'utf8');return Buffer.concat([bigSize(bytes.length),bytes]);}
function tlv(type:number,value:Buffer):Buffer{return Buffer.concat([bigSize(type),bigSize(value.length),value]);}
interface ParsedAnnouncement {data:Record<string,any>;pubkey:Buffer;signature:Buffer;nonces:Buffer[];eventId:string;descriptor:Record<string,any>;event:Buffer;}
function parseAnnouncement(input:unknown):ParsedAnnouncement {
 if(!object(input)||!object(input.event_descriptor))throw new Error('An announcement and event descriptor are required.');
 const data=input,descriptor=input.event_descriptor,eventId=text(data.event_id);
 if(!['dlcspecs-tagged-v0','rust-dlc-legacy-sha256'].includes(data.protocol_revision))throw new Error('Declare a supported protocol_revision explicitly.');
 if(!eventId)throw new Error('Event ID is required.');
 if(!Array.isArray(data.nonces)||!data.nonces.length||data.nonces.length>64)throw new Error('Provide 1 to 64 nonce points.');
 const nonces=data.nonces.map(point);
 if(new Set(nonces.map(p=>p.toString('hex'))).size!==nonces.length)throw new Error('Duplicate nonce points detected in announcement');
 let descriptorBytes:Buffer;
 if(descriptor.type==='enumerated'){
  if(Object.keys(descriptor).some(k=>!['type','outcomes'].includes(k)))throw new Error('Unsupported unsigned descriptor fields.');
  if(!Array.isArray(descriptor.outcomes)||!descriptor.outcomes.length||descriptor.outcomes.length>256)throw new Error('Provide 1 to 256 enumerated outcomes.');
  const outcomes=descriptor.outcomes.map((v:unknown)=>text(v));
  if(outcomes.some(v=>!v)||new Set(outcomes).size!==outcomes.length||nonces.length!==1)throw new Error('Enumerated events require unique outcomes and exactly one nonce.');
  descriptorBytes=tlv(55302,Buffer.concat([u16(outcomes.length),...outcomes.map(string)]));
 }else if(descriptor.type==='numeric'){
  if(Object.keys(descriptor).some(k=>!['type','base','is_signed','num_digits','unit','precision'].includes(k)))throw new Error('Unsupported unsigned descriptor fields.');
  const base=uint(descriptor.base,65535),digits=uint(descriptor.num_digits,63);
  if(base<2||digits<1||typeof descriptor.is_signed!=='boolean'||typeof descriptor.precision!=='number'||!Number.isInteger(descriptor.precision)||descriptor.precision< -2147483648||descriptor.precision>2147483647)throw new Error('Invalid digit decomposition descriptor.');
  if(nonces.length!==digits+(descriptor.is_signed?1:0))throw new Error('Nonce count does not match the signed digit descriptor.');
  const precision=Buffer.alloc(4);precision.writeInt32BE(descriptor.precision);
  descriptorBytes=tlv(55306,Buffer.concat([data.protocol_revision === 'rust-dlc-legacy-sha256' ? u16(base) : bigSize(base),Buffer.from([descriptor.is_signed?1:0]),string(text(descriptor.unit,128)),precision,u16(digits)]));
 }else throw new Error('Unsupported event descriptor type.');
 const maturity=Buffer.alloc(4);maturity.writeUInt32BE(uint(data.event_maturity_epoch,0xffffffff));
 const payload=Buffer.concat([u16(nonces.length),...nonces,maturity,descriptorBytes,string(eventId)]);
 const event=data.protocol_revision === 'rust-dlc-legacy-sha256' ? payload : tlv(55330,payload);
 return {data,pubkey:point(data.oracle_public_key),signature:hex(data.announcement_signature,64),nonces,eventId,descriptor,event};
}
export function serializeOracleEvent(input:unknown):Buffer{return parseAnnouncement(input).event;}
export function verifyAnnouncement(input:unknown){
 try {
  const parsed=parseAnnouncement(input),digest=parsed.data.protocol_revision==='rust-dlc-legacy-sha256'?sha(parsed.event):oracleHash('announcement/v0',parsed.event);
  const completeEvent=parsed.data.protocol_revision==='rust-dlc-legacy-sha256'?tlv(55330,parsed.event):parsed.event;
  const completeAnnouncement=tlv(55332,Buffer.concat([parsed.signature,parsed.pubkey,completeEvent]));
  if(parsed.data.original_bytes_hex!==undefined&&parsed.data.original_bytes_hex!==completeAnnouncement.toString('hex'))throw new Error('Original announcement bytes mismatch.');
  if(parsed.data.event_bytes_hex!==undefined&&parsed.data.event_bytes_hex!==parsed.event.toString('hex'))throw new Error('Signed event bytes mismatch.');
  const verified=secp.verifySchnorr(digest,parsed.pubkey,parsed.signature);
  return {verified,announcement_id:'ann-'+sha(completeAnnouncement).toString('hex'),payload_hash:digest.toString('hex'),event_bytes_hex:parsed.event.toString('hex'),announcement_bytes_hex:completeAnnouncement.toString('hex'),protocol_revision:parsed.data.protocol_revision,errors:verified?[]:['Invalid BIP340 announcement signature.']};
 }catch(error){return {verified:false,announcement_id:'',payload_hash:'',event_bytes_hex:'',errors:[error instanceof Error?error.message:'Invalid announcement.']};}
}
export function verifyAttestation(input:unknown){
 const failure=(message:string)=>({verified:false,attestation_id:'',has_conflict:null,conflict_state:'not_checked',errors:[message]});
 try {
  if(!object(input))return failure('An attestation and its full announcement are required.');
  const announcement=verifyAnnouncement(input.announcement);
  if(!announcement.verified)return failure('A cryptographically verified full announcement is required.');
  const parsed=parseAnnouncement(input.announcement);
  if(input.announcement_id!==undefined&&input.announcement_id!==announcement.announcement_id)return failure('Announcement identifier mismatch.');
  if(!point(input.oracle_public_key).equals(parsed.pubkey)||text(input.event_id)!==parsed.eventId)return failure('Attestation oracle key or event identifier mismatch.');
  if(!Array.isArray(input.outcomes)||!Array.isArray(input.signatures)||input.outcomes.length!==parsed.nonces.length||input.signatures.length!==parsed.nonces.length)return failure('Outcomes and signatures must match every announced nonce.');
  const outcomes=input.outcomes.map((v:unknown)=>text(v));
  if(parsed.descriptor.type==='enumerated'){
   if(!parsed.descriptor.outcomes.map((v:unknown)=>text(v)).includes(outcomes[0]))return failure('Outcome is not in the signed descriptor.');
  }else{
   const start=parsed.descriptor.is_signed?1:0;
   if(start&&!['+','-'].includes(outcomes[0]))return failure('Invalid signed outcome sign.');
   if(outcomes.slice(start).some(v=>! /^(0|[1-9][0-9]*)$/.test(v)||Number(v)>=parsed.descriptor.base))return failure('Outcome digit is outside the signed descriptor base.');
   if(start&&outcomes[0]==='-'&&outcomes.slice(1).every(v=>v==='0'))return failure('Zero must use the positive sign.');
  }
  const signatures=input.signatures.map((v:unknown)=>hex(v,64));
  for(let i=0;i<signatures.length;i++){
   if(!signatures[i].subarray(0,32).equals(parsed.nonces[i]))return failure('Signature nonce does not match its announced position.');
   if(!secp.verifySchnorr((parsed.data.protocol_revision==='rust-dlc-legacy-sha256'?sha(Buffer.from(outcomes[i],'utf8')):oracleHash('attestation/v0',Buffer.from(outcomes[i],'utf8'))),parsed.pubkey,signatures[i]))return failure('Invalid BIP340 attestation signature.');
  }
  return {verified:true,attestation_id:'att-'+sha(Buffer.concat([parsed.pubkey,string(parsed.eventId),...signatures,...outcomes.map(string)])).toString('hex'),has_conflict:null,conflict_state:'not_checked',errors:[]};
 }catch(error){return failure(error instanceof Error?error.message:'Invalid attestation.');}
}
