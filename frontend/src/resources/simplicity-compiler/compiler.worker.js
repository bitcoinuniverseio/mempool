/** Single-use bounded compiler instance. No source or witnesses leave this worker. */
export function compileSimplicity(instance, input) {
 const api=instance.exports; let request;
 try {
  if(typeof input.source!=='string'||input.source.length>16000)throw new Error('Source exceeds 16000 characters.');
  request=new TextEncoder().encode(JSON.stringify(input));
  if(request.length>40000)throw new Error('Compiler request exceeds 40 KB.');
  const pointer=api.allocate(request.length);if(!pointer)throw new Error('Compiler allocation failed.');
  new Uint8Array(api.memory.buffer,pointer,request.length).set(request);
  const packed=api.verify(pointer,request.length),out=Number(packed>>32n),length=Number(packed&0xffffffffn);
  if(length>2000000)throw new Error('Compiled output exceeds the local limit.');
  const result=JSON.parse(new TextDecoder().decode(new Uint8Array(api.memory.buffer,out,length)));
  if(result.error)throw new Error(result.error.slice(0,8000));
  if(!/^[0-9a-f]{64}$/.test(result.cmr)||result.cmr_redecoded!==true)throw new Error('Compiled commitment validation failed.');
  return result;
 } finally {request?.fill(0);new Uint8Array(api.memory.buffer).fill(0);}
}
if(typeof self!=='undefined'&&typeof self.postMessage==='function')self.onmessage=async({data})=>{
 try {
  const response=await fetch(new URL('universe_simplicity_compiler.wasm',import.meta.url));
  if(!response.ok)throw new Error('Local compiler artifact unavailable.');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>20000000)throw new Error('Compiler artifact exceeds size limit.');
  const module=await WebAssembly.compile(bytes); const instance=await WebAssembly.instantiate(module,compilerImports(module));
  self.postMessage({result:compileSimplicity(instance,data)});
 } catch(error){self.postMessage({error:error instanceof Error?error.message:'Local compilation failed.'});}
};
// The pinned crate retains unused wasm-bindgen imports through its getrandom-js dependency.
// Compilation is deterministic and needs no host calls. Reject any attempted host import.
export function compilerImports(module) {
 const imports={};
 for(const item of WebAssembly.Module.imports(module)) {
  if(item.kind!=='function')throw new Error('Unsupported compiler host import.');
  (imports[item.module]??={})[item.name]=()=>{throw new Error('Compiler attempted an unsupported host operation.');};
 }
 return imports;
}
