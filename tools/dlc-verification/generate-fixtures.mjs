import { schnorr } from '../../frontend/node_modules/@noble/secp256k1/index.js';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const sha=x=>createHash('sha256').update(x).digest();
const tag=(name,bytes)=>{const t=sha(Buffer.from('DLC/oracle/'+name));return sha(Buffer.concat([t,t,bytes]));};
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
const big=n=>n<253?Buffer.from([n]):Buffer.concat([Buffer.from([253]),u16(n)]);
const str=s=>{const b=Buffer.from(s.normalize('NFC'));return Buffer.concat([big(b.length),b]);};
const tlv=(t,b)=>Buffer.concat([big(t),big(b.length),b]);
// Public fixed test scalar: no chain, wallet, or oracle registration.
const key=Uint8Array.from({length:32},()=>47),pub=Buffer.from(schnorr.getPublicKey(key)).toString('hex');
const fixtures=[];
for(const numeric of [false,true]){
 const outcomes=numeric?['-','10','15']:['Å'];
 const signatures=[];
 for(let i=0;i<outcomes.length;i++)signatures.push(Buffer.from(await schnorr.signAsync(tag('attestation/v0',Buffer.from(outcomes[i])),key,new Uint8Array(32).fill(i+1))).toString('hex'));
 const nonces=signatures.map(s=>s.slice(0,64));
 const descriptor=numeric?{type:'numeric',base:16,is_signed:true,num_digits:2,unit:'units',precision:-2}:{type:'enumerated',outcomes:['Å','sunny']};
 const descBytes=numeric?tlv(55306,Buffer.concat([big(16),Buffer.from([1]),str('units'),Buffer.from('fffffffe','hex'),u16(2)])):tlv(55302,Buffer.concat([u16(2),str('Å'),str('sunny')]));
 const eventId=numeric?'Synthetic numeric event':'Synthetic NFC event';
 const epoch=Buffer.alloc(4);epoch.writeUInt32BE(1700000000);
 const event=tlv(55330,Buffer.concat([u16(nonces.length),...nonces.map(s=>Buffer.from(s,'hex')),epoch,descBytes,str(eventId)]));
 const announcement={protocol_revision:'dlcspecs-tagged-v0',oracle_public_key:pub,event_id:eventId,event_descriptor:descriptor,event_maturity_epoch:1700000000,nonces,announcement_signature:Buffer.from(await schnorr.signAsync(tag('announcement/v0',event),key,new Uint8Array(32))).toString('hex')};
 fixtures.push({announcement,attestation:{announcement,oracle_public_key:pub,event_id:eventId,outcomes,signatures},event_hex:event.toString('hex')});
}
writeFileSync(new URL('tagged-fixtures.json',import.meta.url),JSON.stringify(fixtures,null,2));
writeFileSync(new URL('../../frontend/src/app/universe/dlc/oracle-verification-sample.ts',import.meta.url),'// Synthetic public oracle data, signed with independent noble BIP340. No funds.\nexport const ORACLE_SAMPLE = '+JSON.stringify(fixtures[0],null,2)+';\n');
