import { Injectable } from '@angular/core';
export interface SimplicityCompiledOutput {
 version:string;cmr:string;static_cost:string;memory_bound:number;extra_frames:number;program_base64:string;witness_base64:string;program_type:string;cmr_redecoded:true;
}
@Injectable({providedIn:'root'})
export class SimplicityCompilerService {
 compile(source:string,argumentsJson:string,witnessJson:string):{promise:Promise<SimplicityCompiledOutput>;cancel:()=>void} {
  let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,rejectPending:(reason:Error)=>void;
  const cleanup=()=>{worker?.terminate();if(timer)clearTimeout(timer);};
  const promise=new Promise<SimplicityCompiledOutput>((resolve,reject)=>{
   rejectPending=reject;
   try {
    if(source.length>16000||argumentsJson.length>10000||witnessJson.length>10000)throw new Error('Compiler input exceeds the local size limit.');
    const input={source,arguments:JSON.parse(argumentsJson),witness:JSON.parse(witnessJson)};
    worker=new Worker(new URL('resources/simplicity-compiler/compiler.worker.js',document.baseURI),{type:'module'});
    timer=setTimeout(()=>{cleanup();reject(new Error('Compilation exceeded the 15-second limit. Simplify the source.'));},15000);
    worker.onmessage=({data})=>{cleanup();if(data.error)reject(new Error(data.error));else resolve(data.result);};
    worker.onerror=()=>{cleanup();reject(new Error('The local compiler failed. Check the source and toolchain.'));};
    worker.postMessage(input);
   }catch(error){cleanup();reject(error);}
  });
  return {promise,cancel:()=>{cleanup();rejectPending?.(new Error('Compilation cancelled.'));}};
 }
}
