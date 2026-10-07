import * as http from 'http';
import {WebSocket,WebSocketServer,RawData} from 'ws';
import { attachWatchlistStream } from './watchlist-stream';
import { developerIdentity } from '../identity/developer-identity';
import { MemoryOwnerStore,useOwnerStore } from '../identity/owner-store';
import config from '../../../config';
import {createHash} from 'crypto';
import {watchlistsService} from './watchlists.service';
import {WatchlistMatcher} from './watchlist-matcher';
import {BlockExtended,TransactionExtended} from '../../../mempool.interfaces';
it('dispatches persisted descriptor and outpoint receive/spend findings over the actual authenticated socket',async()=>{
 const store=new MemoryOwnerStore();useOwnerStore(store);developerIdentity.resetForTests();
 const key=await developerIdentity.bootstrapOwner('dispatch','93.184.216.35');const owner=(await developerIdentity.authenticateKey(key.secret_key))!;
 const wl=await watchlistsService.createWatchlist(owner,'streamed script');const received='a'.repeat(64);
 await watchlistsService.addEntity(owner,wl.watchlist_id,'outpoint',received.toUpperCase()+':0','outpoint');
 await watchlistsService.addEntity(owner,wl.watchlist_id,'descriptor','raw(51)#8lvh9jxk','descriptor',false,{version:1,network:config.MEMPOOL.NETWORK,children:[{script_hash:createHash('sha256').update(Buffer.from('51','hex')).digest('hex'),derivation_index:4}]});
 await watchlistsService.addRule(owner,wl.watchlist_id,'value_transfer','websocket');
 const server=http.createServer(),wss=new WebSocketServer({server});attachWatchlistStream(wss);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const socket=new WebSocket(`ws://127.0.0.1:${(server.address() as {port:number}).port}/api/v1/ws`);const frames:any[]=[];
 try{
  await new Promise<void>(resolve=>socket.once('open',resolve));socket.on('message',data=>frames.push(JSON.parse(data.toString())));socket.send(JSON.stringify({action:'watchlist-subscribe',api_key:key.secret_key}));
  const matcher=new WatchlistMatcher();const block=(height:number):BlockExtended=>({height,id:String(height).repeat(64),timestamp:height,weight:4000,extras:{medianFee:1}} as unknown as BlockExtended);
  const receivedTx={txid:received,vout:[{scriptpubkey:'51',value:1000}],vin:[]} as unknown as TransactionExtended;
  const spentTx={txid:'b'.repeat(64),vout:[],vin:[{txid:received,vout:0,prevout:{scriptpubkey:'51',value:1000}}]} as unknown as TransactionExtended;
  expect((await matcher.observeBlock(block(1),[receivedTx])).inserted).toBe(2);expect((await matcher.observeBlock(block(2),[spentTx])).inserted).toBe(2);expect((await matcher.observeBlock(block(2),[spentTx])).duplicates).toBe(2);
  const deadline=Date.now()+4000;while(frames.filter(frame=>frame['watchlist-notification']).length<4&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  const delivered=frames.filter(frame=>frame['watchlist-notification']).map(frame=>frame['watchlist-notification']);expect(delivered).toHaveLength(4);expect(new Set(delivered.map(row=>row.notification_id)).size).toBe(4);expect(delivered.every(row=>row.owner_id===owner.owner_id&&row.network===config.MEMPOOL.NETWORK)).toBe(true);expect(delivered.filter(row=>row.entity_type==='descriptor')).toHaveLength(2);expect(frames[0]).toMatchObject({'watchlist-ready':{network:config.MEMPOOL.NETWORK}});
 }finally{socket.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
},10000);
it('actual loopback websocket authenticates and isolates catchup, reconnect and revocation',async()=>{
 const store=new MemoryOwnerStore();useOwnerStore(store);developerIdentity.resetForTests();
 const key=await developerIdentity.bootstrapOwner('socket','93.184.216.33');
 const other=await developerIdentity.bootstrapOwner('other','93.184.216.34');
 const own='11111111-1111-7111-8111-111111111111';
 for(const [id,owner] of [[own,key.owner_id],['22222222-2222-7222-8222-222222222222',other.owner_id]])await store.insertNotification({notification_id:id,owner_id:owner,network:config.MEMPOOL.NETWORK,watchlist_id:'w',rule_id:id,event_id:id,title:'t',message:'m',severity:'info',entity_type:'txid',blinded_hash:'a'.repeat(64),block_height:1,block_hash:'b'.repeat(64),state:'open',created_at:new Date().toISOString(),acknowledged_at:null});
 const server=http.createServer();const wss=new WebSocketServer({server});attachWatchlistStream(wss);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const clients:WebSocket[]=[];
 const connect=async()=>{const socket=new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/api/v1/ws`);clients.push(socket);await new Promise<void>(resolve=>socket.once('open',()=>resolve()));return socket;};
 const next=(socket:WebSocket,predicate:(value:any)=>boolean)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('socket frame timeout')),5000);const listener=(data:RawData)=>{const value=JSON.parse(data.toString());if(predicate(value)){clearTimeout(timer);socket.off('message',listener);resolve(value);}};socket.on('message',listener);});
 try {
  const a=await connect();const notifications:any[]=[];a.on('message',data=>{const value=JSON.parse(data.toString());if(value['watchlist-notification'])notifications.push(value['watchlist-notification']);});const ready=next(a,v=>v['watchlist-ready']?.cursor===own);a.send(JSON.stringify({action:'watchlist-subscribe',api_key:key.secret_key}));await ready;expect(notifications.map(row=>row.notification_id)).toEqual([own]);
  const b=await connect();const wrong=next(b,v=>v['watchlist-error']);b.send(JSON.stringify({action:'watchlist-subscribe',api_key:other.secret_key,cursor:own}));expect(await wrong).toMatchObject({'watchlist-error':{code:'stream_unavailable'}});
  const owner=(await developerIdentity.authenticateKey(key.secret_key))!;const rejected=next(a,v=>v['watchlist-error']);await developerIdentity.revokeApiKey(owner,key.key_id);expect(await rejected).toMatchObject({'watchlist-error':{code:'unauthenticated'}});
 }finally{for(const socket of clients)socket.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);
