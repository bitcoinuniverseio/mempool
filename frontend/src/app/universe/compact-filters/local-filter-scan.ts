import { sha256 } from '@noble/hashes/sha2.js';
import { Address, OutScript, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { decodeBasicFilter,matchesBasicFilter } from './bip158';
const unhex=(hex:string)=>Uint8Array.from(hex.match(/../g)||[],x=>parseInt(x,16));
const hex=(bytes:Uint8Array)=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const sha256d=(bytes:Uint8Array)=>sha256(sha256(bytes));
export function scanScript(input:string,network:string):Uint8Array {
 const value=input.trim();if(value.length>20010)throw Error('Descriptor or address exceeds the local limit.');
 const raw=/^raw\(([0-9a-f]+)\)$/i.exec(value);if(raw){if(raw[1].length%2||raw[1].length>20000)throw Error('Invalid raw script.');return unhex(raw[1]);}
 if(value.includes('(')&&!/^addr\([^()]+\)$/.test(value))throw Error('This scanner supports addresses, addr(address) and raw(scriptHex). Other descriptor profiles are not implemented.');
 const address=value.startsWith('addr(')?value.slice(5,-1):value;
 const params=network==='main'?NETWORK:network==='regtest'?{...TEST_NETWORK,bech32:'bcrt'}:TEST_NETWORK;
 try{return OutScript.encode(Address(params).decode(address));}catch{throw Error('Invalid address or wrong network. Private keys are not supported.');}
}
export function verifyLocalFilter(filter:any):void {
 if(!filter||!/^[0-9a-f]{64}$/.test(filter.block_hash)||!/^[0-9a-f]{64}$/.test(filter.prev_filter_header)||!/^[0-9a-f]{64}$/.test(filter.filter_header))throw Error('Malformed filter evidence.');
 const values=decodeBasicFilter(filter.filter_bytes_hex);const digest=sha256d(unhex(filter.filter_bytes_hex));const header=sha256d(new Uint8Array([...digest,...unhex(filter.prev_filter_header).reverse()]));
 if(values.length!==filter.element_count||hex(digest.slice().reverse())!==filter.filter_hash||hex(header.reverse())!==filter.filter_header)throw Error('Filter hash, count or header commitment does not match.');
}
export function scanFilterRange(ranges:any,script:Uint8Array,start:number,end:number,network:string){
 if(!Array.isArray(ranges)||ranges.length!==1||!Array.isArray(ranges[0].filters))throw Error('Malformed filter interval.');const filters=ranges[0].filters;
 if(filters.length!==end-start+1||filters.length>32||ranges[0].network!==network)throw Error('Filter interval or network does not match.');
 const matches:Array<{height:number;hash:string}>=[];let previous:string|undefined;
 for(let i=0;i<filters.length;i++){const filter=filters[i];if(filter.block_height!==start+i||filter.network!==network)throw Error('Filter height or network mismatch.');verifyLocalFilter(filter);if(previous&&filter.prev_filter_header!==previous)throw Error('Filter interval does not link.');previous=filter.filter_header;if(matchesBasicFilter(filter.filter_bytes_hex,filter.block_hash,[script]))matches.push({height:filter.block_height,hash:filter.block_hash});}
 return{total_scanned:filters.length,false_positives:'Unconfirmed',matches};
}
