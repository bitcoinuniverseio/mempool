import { Request,Response } from 'express';
import { RelayCollectorService,RelayPollEvent } from './relay-collector.service';
import config from '../../../config';
/** Close slow streams instead of queuing an unbounded history in HTTP buffers. */
export function streamRelay(req:Request,res:Response,collector:RelayCollectorService,network:string=config.MEMPOOL.NETWORK):void{
  let ended=false;let unsubscribe:()=>void=()=>undefined;let heartbeat:NodeJS.Timeout|undefined;
  const cleanup=()=>{if(ended)return;ended=true;if(heartbeat)clearInterval(heartbeat);unsubscribe();req.removeListener('close',cleanup);res.removeListener('close',cleanup);};
  const close=()=>{cleanup();res.destroy();};
  const write=(frame:string)=>{if(ended)return;if(Buffer.byteLength(frame)>65536||res.writableLength>65536){close();return;}try{if(!res.write(frame))close();}catch{close();}};
  unsubscribe=collector.subscribe((event:RelayPollEvent)=>{if(event.network!==network)return;write(`id: ${event.event_id}\nevent: intelligence.relay.transaction\ndata: ${JSON.stringify(event)}\n\n`);});
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
  req.on('close',cleanup);res.on('close',cleanup);
  write(`event: relay.connected\ndata: ${JSON.stringify({network,scope:'Live local poll events only; no replay across disconnects. Clock calibration and per-transaction transport are unknown.'})}\n\n`);
  if(!ended){heartbeat=setInterval(()=>write(': keepalive\n\n'),15000);heartbeat.unref();}
}
