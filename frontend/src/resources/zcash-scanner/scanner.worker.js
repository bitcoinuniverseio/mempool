/** One invocation, no key persistence. All WASM memory is wiped before termination. */
export function scanZcash(instance, input) {
 const api=instance.exports;let request;
 try {
  request=new TextEncoder().encode(JSON.stringify(input));
  if(request.length>10000000)throw new Error('Scan request exceeds 10 MB.');
  const pointer=api.allocate(request.length);if(!pointer)throw new Error('Local scanner allocation failed.');
  new Uint8Array(api.memory.buffer,pointer,request.length).set(request);
  const packed=api.verify(pointer,request.length),out=Number(packed>>32n),length=Number(packed&0xffffffffn);
  if(length>2000000)throw new Error('Local scan result exceeds the output bound.');
  const result=JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer,out,length)));
  if(result.error)throw new Error(result.error);
  if(result.balance_zatoshis!==null||result.history_complete!==false||!/^\d+$/.test(result.received_zatoshis))throw new Error('Unexpected scanner result.');
  return result;
 } finally {request?.fill(0);new Uint8Array(api.memory.buffer).fill(0);input.viewing_key='';}
}
if(typeof self!=='undefined'&&typeof self.postMessage==='function')self.onmessage=async({data})=>{
 try {
  const response=await fetch(new URL('universe_zcash_scanner.wasm',import.meta.url));
  if(!response.ok)throw new Error('Local scanner artifact unavailable.');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>20000000)throw new Error('Scanner artifact exceeds size limit.');
  const module=await WebAssembly.compile(bytes);
  if(WebAssembly.Module.imports(module).length)throw new Error('Scanner attempted an unsupported host import.');
  const instance=await WebAssembly.instantiate(module,{});
  self.postMessage({result:scanZcash(instance,data)});
 } catch(error){self.postMessage({error:error instanceof Error?error.message:'Local note scanning failed.'});}
 finally {data.viewing_key='';self.close();}
};
