// BIP380 descriptor checksum. No key material is derived or persisted here.
const alphabet="0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\\ ";
const checksumAlphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export function descriptorChecksum(input:string):string {
 let c=BigInt(1),cls=0,clscount=0;
 const generators=['0xf5dee51989','0xa9fdca3312','0x1bab10e32d','0x3706b1677a','0x644d626ffd'].map(BigInt);
 const polymod=(value:number)=>{const top=c>>BigInt(35);c=((c&BigInt('0x7ffffffff'))<<BigInt(5))^BigInt(value);for(let i=0;i<5;i++)if((top>>BigInt(i))&BigInt(1))c^=generators[i];};
 for(const char of input){const position=alphabet.indexOf(char);if(position<0)throw new Error('invalid_descriptor_character');polymod(position&31);cls=cls*3+(position>>5);if(++clscount===3){polymod(cls);cls=0;clscount=0;}}
 if(clscount)polymod(cls);for(let i=0;i<8;i++)polymod(0);c^=BigInt(1);
 let result='';for(let i=0;i<8;i++)result+=checksumAlphabet[Number((c>>BigInt(5*(7-i)))&BigInt(31))];return result;
}
export function validPublicDescriptorChecksum(value:string):boolean {
 const parts=value.split('#');return parts.length===2&&parts[1].length===8&&descriptorChecksum(parts[0])===parts[1];
}
