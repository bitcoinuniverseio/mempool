import http from 'http';
const { JsonRPC } = require('../rpc-api/jsonrpc');

describe('RPC complete lifecycle', () => {
  async function serve(handler, run) {
    const server = http.createServer(handler);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new JsonRPC({host:'127.0.0.1',port:(server.address() as any).port,timeout:100});
    try { await run(client); } finally { client.agent.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  it('keeps the absolute deadline through trickling response bytes', async () => {
    await serve((_req, res) => {
      res.writeHead(200); res.write('{');
      const timer = setInterval(() => res.write(' '), 10); res.on('close', () => clearInterval(timer));
    }, async client => { await expect(client.call('getblockcount', [])).rejects.toMatchObject({code:'ETIMEDOUT'}); });
  });
  it('settles a response aborted after headers', async () => {
    await serve((_req, res) => { res.writeHead(200); res.write('{'); setTimeout(() => res.destroy(), 10); },
      async client => { await expect(client.call('getblockcount', [])).rejects.toMatchObject({code:'ERPC_BODY'}); });
  });
  it('rejects wrong ids, duplicate batch ids and oversized input', async () => {
    await serve((_req, res) => res.end(JSON.stringify({id:'wrong',result:1})), async client => {
      await expect(client.call('getblockcount', [])).rejects.toMatchObject({code:'ERPC_RESPONSE'});
      client.opts.maxResponseBytes = 2;
      await expect(client.call('getblockcount', [])).rejects.toMatchObject({code:'ERPC_SIZE'});
    });
  });
  it('preserves split UTF8 and returns batches in request order', async () => {
    await serve((req, res) => {
      let body=''; req.on('data', chunk => body+=chunk); req.on('end', () => {
        const calls=JSON.parse(body); const result=Array.isArray(calls)
          ? calls.map((call,i) => ({id:call.id,result:i})).reverse() : {id:calls.id,result:'é'};
        const bytes=Buffer.from(JSON.stringify(result)); const split=bytes.indexOf(0xc3)+1;
        res.write(bytes.subarray(0,split)); res.end(bytes.subarray(split));
      });
    }, async client => {
      await expect(client.call('echo', ['é'])).resolves.toBe('é');
      await expect(client.call([{method:'a',params:[]},{method:'b',params:[]}])).resolves.toEqual([0,1]);
    });
  });  it('preserves Core error codes and safe missing-object messages without remote parameters', async () => {
    await serve((req,res)=>{
      let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
        const call=JSON.parse(body);res.statusCode=500;res.end(JSON.stringify({id:call.id,result:null,error:{code:-5,message:'sensitive caller parameters'}}));
      });
    }, async client=>{
      await expect(client.call('getrawtransaction',['opaque'])).rejects.toMatchObject({code:-5,rpcMethod:'getrawtransaction',message:'No such mempool or blockchain transaction'});
      await expect(client.call('getblock',['opaque'])).rejects.toMatchObject({code:-5,message:'Block not found'});
      await expect(client.call('getblockheader',['opaque'])).rejects.toMatchObject({code:-5,rpcMethod:'getblockheader',message:'Block not found'});
    });
  });  it('cancels an active request once and recovers on a following call', async () => {
    let first=true;
    await serve((req,res)=>{
      let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
        if(first){first=false;res.writeHead(200);res.write('{');return;}
        res.end(JSON.stringify({id:JSON.parse(body).id,result:7,error:null}));
      });
    },async client=>{
      const controller=new AbortController();
      const pending=client.call('getblockcount',[],{signal:controller.signal});
      setTimeout(()=>controller.abort(),10);
      await expect(pending).rejects.toMatchObject({code:'EABORTED'});
      await expect(client.call('getblockcount',[])).resolves.toBe(7);
    });
  });
});
