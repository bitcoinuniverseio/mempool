import { createHash } from 'crypto';
import { scanRbfBodyRanges } from '../api/rbf-body-ranges';
async function* chunks(bytes:Buffer,size:number):AsyncIterable<Buffer>{for(let n=0;n<bytes.length;n+=size)yield bytes.subarray(n,n+size);}
const id=(n:number):string=>n.toString(16).padStart(64,'0');
const digest=(b:Buffer):string=>createHash('sha256').update(b).digest('hex');
describe('unactivated full-body byte range candidate',()=>{
 it.each([1,7,65536])('preserves every body byte/hash across %i-byte chunks without decoding giant fields',async size=>{
  const txs=[0,1,2].map(n=>[id(n),{txid:id(n),weight:400,vin:[],vout:[],arbitrary:{text:'\u00e9\ud83d\ude80',large:'x'.repeat(n===1?200000:50)}}]);
  const bytes=Buffer.from(JSON.stringify({network:'signet',rbfCacheSchemaVersion:1,rbf:{txs,trees:[],expiring:[]}}));
  const result=await scanRbfBodyRanges(chunks(bytes,size),'signet');expect(result.qualified).toBe(false);
  expect(result.sourceBytes).toBe(bytes.length);expect(result.sourceSha256).toBe(digest(bytes));expect(result.bodies).toHaveLength(3);
  for(let n=0;n<3;n++){const r=result.bodies[n],raw=bytes.subarray(r.offset,r.offset+r.bytes);expect(r.txid).toBe(id(n));expect(r.sha256).toBe(digest(raw));expect(JSON.parse(raw.toString())).toEqual(txs[n][1]);}
  expect(result.maximumCapturedTokenBytes).toBeLessThan(100);
 });
 it('fails closed on tuple/txid/network/schema problems rather than returning partial success',async()=>{
  for(const value of [
   {network:'mainnet',rbfCacheSchemaVersion:1,rbf:{txs:[]}},
   {network:'signet',rbfCacheSchemaVersion:2,rbf:{txs:[]}},
   {network:'signet',rbfCacheSchemaVersion:1,rbf:{txs:[[id(0),{txid:id(1)}]]}},
   {network:'signet',rbfCacheSchemaVersion:1,rbf:{txs:[[id(0),{txid:id(0)},'extra']]}},
   {network:'signet',rbfCacheSchemaVersion:1,rbf:{txs:[[id(0),[]]]}},
   {network:'signet',rbfCacheSchemaVersion:1,rbf:{txs:[[id(0),{txid:id(0)}],[id(0),{txid:id(0)}]]}},
  ]){await expect(scanRbfBodyRanges(chunks(Buffer.from(JSON.stringify(value)),13),'signet')).rejects.toThrow();}
 });
 it('never upgrades a grammar-only index into graph/expiry/immutable-file qualification',async()=>{
  const value={network:'signet',rbfCacheSchemaVersion:1,rbf:{txs:[[id(0),{txid:id(0)}]],trees:['not-a-qualified-graph'],expiring:['not-qualified']}};
  const result=await scanRbfBodyRanges(chunks(Buffer.from(JSON.stringify(value)),64),'signet');expect(result.qualified).toBe(false);
 });
});
