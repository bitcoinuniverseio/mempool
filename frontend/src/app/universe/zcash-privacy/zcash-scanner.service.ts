import { Injectable } from '@angular/core';
export interface ZcashScanResult {
 key_family:string;mode:string;scanned_blocks:number;outputs_examined:number;notes_found:number;received_zatoshis:string;balance_zatoshis:null;history_complete:false;spend_status:string;notes:unknown[];last_hash:string|null;next_height:number|null;sapling_supported:boolean;orchard_supported:boolean;
}
@Injectable({providedIn:'root'})
export class ZcashScannerService {
 run(input:any):{promise:Promise<ZcashScanResult>;cancel:()=>void} {
  let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,rejectPending:(reason:Error)=>void;
  const cleanup=()=>{worker?.terminate();if(timer)clearTimeout(timer);};
  const promise=new Promise<ZcashScanResult>((resolve,reject)=>{
   rejectPending=reject;
   try {
    if(typeof input.viewing_key!=='string'||input.viewing_key.length>4096)throw new Error('Viewing key exceeds the local limit.');
    worker=new Worker(new URL('resources/zcash-scanner/scanner.worker.js',document.baseURI),{type:'module'});
    timer=setTimeout(()=>{cleanup();reject(new Error('Scanning exceeded 30 seconds. Request fewer blocks.'));},30000);
    worker.onmessage=({data})=>{cleanup();if(data.error)reject(new Error(data.error));else resolve(data.result);};
    worker.onerror=()=>{cleanup();reject(new Error('The local scanner failed or exceeded its memory bound.'));};
    worker.postMessage(input);
   }catch(error){cleanup();reject(error);}
  });
  return {promise,cancel:()=>{cleanup();rejectPending?.(new Error('Scanning cancelled.'));}};
 }
 async publicBlocks(network:string,start:number,end:number,previous:string|undefined,signal:AbortSignal):Promise<any> {
  if(!['mainnet','testnet'].includes(network)||!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end-start>=10)throw new Error('Choose an interval of 1–10 positive block heights.');
  const query=new URLSearchParams({network,start:String(start),end:String(end)});if(previous)query.set('previous',previous);
  const response=await fetch(new URL('api/v1/zcash/privacy/blocks?'+query,document.baseURI),{signal,cache:'no-store'});
  if(!response.ok){let message='Owned Zcash public block source unavailable.';try{const error=await response.json();if(typeof error.error==='string')message=error.error;}catch{}throw new Error(message);}
  const reader=response.body?.getReader();let raw='';
  if(reader){const decoder=new TextDecoder();let bytes=0;try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>8100000)throw new Error('Public block response exceeds the local limit.');raw+=decoder.decode(item.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();}}
  else {raw=await response.text();if(raw.length>8100000)throw new Error('Public block response exceeds the local limit.');}
  const data=JSON.parse(raw);
  if(data.mode!=='owned-blocks'||data.network!==network||data.start_height!==start||data.end_height!==end||data.blocks?.length!==end-start+1||!/^([0-9a-f]{64})$/.test(data.previous_hash)||(previous!==undefined&&data.previous_hash!==previous))throw new Error('Public interval or resume checkpoint differs from the request.');
  return data;
 }
}
