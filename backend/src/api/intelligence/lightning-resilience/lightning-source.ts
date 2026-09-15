import axios from 'axios';
import { Agent } from 'https';
import { readFileSync } from 'fs';
import config from '../../../config';
import { LIGHTNING_LIMITS,LightningEvidenceError } from './lightning-evidence';
export interface LightningObservation {network:string;observed_at_utc:string;identity_pubkey:string;channels:any[];}
/** No RPC unless an operator explicitly enables publication of owned channel metrics. */
export async function readOwnedLnd():Promise<LightningObservation>{
  if(!config.LIGHTNING.ENABLED)throw new LightningEvidenceError('lightning-disabled','Owned Lightning integration is disabled.');
  if(process.env.UNIVERSE_LIGHTNING_RESILIENCE_PUBLISH!=='1')throw new LightningEvidenceError('publication-disabled','Owned channel telemetry publication is not enabled.');
  if(config.LIGHTNING.BACKEND!=='lnd')throw new LightningEvidenceError('adapter-unavailable','Owned channel telemetry adapter is currently available for LND only.');
  try{
    const options={headers:{'Grpc-Metadata-macaroon':readFileSync(config.LND.MACAROON_PATH).toString('hex')},httpsAgent:new Agent({ca:readFileSync(config.LND.TLS_CERT_PATH)}),timeout:LIGHTNING_LIMITS.timeoutMs,maxContentLength:LIGHTNING_LIMITS.bodyBytes,maxRedirects:0};
    try{
      const info=(await axios.get(config.LND.REST_API_URL+'/v1/getinfo',options)).data;
      const network=config.MEMPOOL.NETWORK==='testnet4'?'testnet4':config.MEMPOOL.NETWORK;
      if(!Array.isArray(info.chains)||info.chains.length!==1||info.chains[0].chain!=='bitcoin'||info.chains[0].network!==network)throw new LightningEvidenceError('lightning-network-mismatch','Owned Lightning source network does not match this backend.');
      if(info.synced_to_chain!==true)throw new LightningEvidenceError('lightning-not-synced','Owned Lightning source is not synced to its chain.');
      const result=(await axios.get(config.LND.REST_API_URL+'/v1/channels',options)).data;
      return {network,observed_at_utc:new Date().toISOString(),identity_pubkey:info.identity_pubkey,channels:result.channels};
    }finally{options.httpsAgent.destroy();}
  }catch(error){if(error instanceof LightningEvidenceError)throw error;throw new LightningEvidenceError('lightning-source-unavailable','Owned Lightning telemetry could not be read.');}
}
