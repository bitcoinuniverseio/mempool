import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Block } from 'bitcoinjs-lib';
import { decodeBasicFilter,siphash24,matchesBasicFilter } from './bip158';
import { filterCommitments } from './core-filter-source';
const vectors=JSON.parse(readFileSync(resolve(__dirname,'../../../../../tools/compact-filters/bip158-testnet19.json'),'utf8')).slice(1);
describe('official BIP158 independent testnet vectors',()=>{
 it.each(vectors)('fully decodes and reconstructs official block %s',(...row:any[])=>{ const [_height,hash,raw,prev,previousHeader,filter,header]=row;
  const block=Block.fromHex(raw);expect(block.getId()).toBe(hash);const scripts=new Set<string>((prev as string[]).filter(s=>s.length>0));for(const tx of block.transactions!)for(const out of tx.outs)if(out.script.length&&out.script[0]!==0x6a)scripts.add(out.script.toString('hex'));
  const key=Buffer.from(hash,'hex').reverse().subarray(0,16);const values=[...scripts].map(s=>(siphash24(key,Buffer.from(s,'hex'))*BigInt(scripts.size)*784931n)>>64n).sort((a,b)=>a<b?-1:a>b?1:0);
  expect(decodeBasicFilter(filter)).toEqual(values);expect(filterCommitments(filter,previousHeader).filter_header).toBe(header);
  for(const script of scripts)expect(matchesBasicFilter(filter,hash,[Buffer.from(script,'hex')])).toBe(true);
 });
 it.each(['','fd010000','ff0000000000000000','0100','0000','019dfca9','01ffffffffffffffff'])('rejects malformed/noncanonical encoding %s',filter=>expect(()=>decodeBasicFilter(filter)).toThrow());
 it('rejects corrupted commitments',()=>expect(filterCommitments(vectors[0][5], '11'.repeat(32)).filter_header).not.toBe(vectors[0][6]));
 it('matches canonical empty filter with no elements',()=>expect(decodeBasicFilter('00')).toEqual([]));
});
