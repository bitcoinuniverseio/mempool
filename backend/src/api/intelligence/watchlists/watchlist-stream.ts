import * as WebSocket from 'ws';
import config from '../../../config';
import { developerIdentity } from '../identity/developer-identity';
import { ownerStore } from '../identity/owner-store';
/** Owner-only frames share the existing public connection; key never enters URLs or public messages. */
export function attachWatchlistStream(server: WebSocket.Server): void {
  server.on('connection', socket => {
    let timer: NodeJS.Timeout | undefined;
    let generation = 0;
    let polling = false;
    let cursor: string | null = null;
    let key = '';
    const network = config.MEMPOOL.NETWORK;
    const send = (value: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      if (socket.bufferedAmount > 262144) { socket.close(1013,'Notification buffer exceeded'); return false; }
      socket.send(JSON.stringify(value)); return true;
    };
    const stop = () => { generation++; if(timer) clearInterval(timer); timer=undefined; key=''; };
    const poll = async (version: number) => {
      if (polling || version !== generation) return;
      polling=true;
      try {
        const owner=await developerIdentity.authenticateKey(key,'watchlists');
        if (version!==generation) return;
        if (!owner || owner.network!==network || network!==config.MEMPOOL.NETWORK) { send({'watchlist-error':{code:'unauthenticated'}});stop();return; }
        const rows=await ownerStore().listNotificationsAfter(owner.owner_id,network,cursor,100);
        if(version!==generation)return;
        send({'watchlist-ready':{network,cursor}});
        for(const row of rows) {
          if(!send({'watchlist-notification':{...row,created_at_utc:row.created_at,acknowledged:row.state==='acknowledged'}})) {stop();return;}
          cursor=row.notification_id;
        }
        send({'watchlist-ready':{network,cursor}});
      } catch { send({'watchlist-error':{code:'stream_unavailable'}});stop(); }
      finally {polling=false;}
    };
    socket.on('message', bytes => {
      if (bytes.toString().length > 4096) return;
      let message: any;
      try {message=JSON.parse(bytes.toString());}catch{return;}
      if(message?.action!=='watchlist-subscribe')return;
      stop();
      if(typeof message.api_key!=='string'||message.api_key.length>128||message.cursor!==undefined&&message.cursor!==null&&!/^[a-f0-9-]{36}$/.test(message.cursor)) {send({'watchlist-error':{code:'invalid_subscription'}});return;}
      key=message.api_key; cursor=message.cursor??null;
      const version=generation;
      poll(version).catch(() => stop());
      timer=setInterval(()=>{poll(version).catch(() => stop());},1000);timer.unref();
    });
    socket.on('close',stop);socket.on('error',stop);
  });
}
