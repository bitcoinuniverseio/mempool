import { scanRbfJson, JsonEvent } from '../api/rbf-stream-json';

async function* chunks(bytes: Buffer, size: number): AsyncIterable<Buffer> {
  for (let at=0;at<bytes.length;at+=size) { yield bytes.subarray(at,at+size); }
}
describe('unactivated bounded RBF JSON lexer', () => {
  it.each([1,2,3,7,64,65536])('preserves paths and values across %i-byte UTF8/escape/number boundaries', async size => {
    const bodyValue={txid:'id',text:'\u00e9\ud83d\ude80"\\\n',weight:1e3,truth:true,empty:null,arr:[]};
    const value={network:'signet',rbfCacheSchemaVersion:1,rbf:{txs:[['id',bodyValue]],trees:[],expiring:[]}};
    const bytes=Buffer.from(JSON.stringify(value));const events:JsonEvent[]=[];
    const result=await scanRbfJson(chunks(bytes,size),{captureString:()=>true,onEvent:e=>events.push(e)});
    expect(result.bytes).toBe(bytes.length);
    expect(events.find(e=>e.kind==='scalar'&&e.path.join('.')==='rbf.txs.0.1.text')?.value).toBe(bodyValue.text);
    expect(events.find(e=>e.kind==='scalar'&&e.path.join('.')==='rbf.txs.0.1.weight')?.value).toBe(1000);
    const body=events.find(e=>e.kind==='object-end'&&e.path.join('.')==='rbf.txs.0.1')!;
    expect(JSON.parse(bytes.subarray(body.start,body.end).toString())).toEqual(value.rbf.txs[0][1]);
  });
  it('validates a giant skipped string while retaining only tiny keys and selected scalars', async () => {
    const bytes=Buffer.from(JSON.stringify({network:'signet',body:'x'.repeat(1024*1024)}));const events:JsonEvent[]=[];
    const result=await scanRbfJson(chunks(bytes,65536),{captureString:p=>p.join('.')==='network',onEvent:e=>events.push(e)});
    expect(result.maximumCapturedTokenBytes).toBeLessThan(32);expect(events.find(e=>e.path.join('.')==='body')?.value).toBeUndefined();
    expect(events.find(e=>e.path.join('.')==='network')?.value).toBe('signet');
  });
  it.each(['{"a":1,"a":2}','{"a":1,"\\u0061":2}','[1,]','{"a":1,}','{"a" 1}','[01]','[1e]','[1.]','[+1]','truefalse','{}{}','[true false]','{"x":"\\q"}','{"x":"\\uXY12"}','{"x":"line\n"}','{"x":"unfinished}','{"x":false',''])('rejects malformed or ambiguous input %s', async text => {
    await expect(scanRbfJson(chunks(Buffer.from(text),1),{captureString:()=>false,onEvent:()=>undefined})).rejects.toThrow();
  });
  it('rejects invalid UTF8, excessive depth, oversized captured tokens and live key budget', async () => {
    for(const bytes of [Buffer.from([123,34,120,34,58,34,255,34,125]),Buffer.from('['.repeat(65)+'0'+']'.repeat(65)),Buffer.from(JSON.stringify({x:'a'.repeat(4097)}))]){
      await expect(scanRbfJson(chunks(bytes,7),{captureString:()=>true,onEvent:()=>undefined})).rejects.toThrow();
    }
    await expect(scanRbfJson(chunks(Buffer.from('{"abc":1,"def":2}'),8),{maximumKeyBytes:5,captureString:()=>false,onEvent:()=>undefined})).rejects.toThrow();
  });
  it('checks cancellation between bounded chunks and never publishes a synthetic EOF', async () => {
    const controller=new AbortController();let ended=false;
    await expect(scanRbfJson(chunks(Buffer.from('{"long":"'+'x'.repeat(1000)+'"}'),64),{signal:controller.signal,captureString:()=>false,
      onEvent:e=>{if(e.kind==='object-end')ended=true;},onChunk:()=>controller.abort()})).rejects.toThrow('cancelled');
    expect(ended).toBe(false);
  });
});
