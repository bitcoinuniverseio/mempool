import axios from 'axios';
import { readFileSync } from 'fs';
import { LiquidObservatoryEvidenceError as EvidenceError } from './liquid-observatory.service';
export interface ElementsReader { call(method: string, params: unknown[]): Promise<any>; }
export const ownedElementsReader: ElementsReader = {
 async call(method, params) {
  const origin = process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN;
  if (!origin) throw new EvidenceError('unavailable-elements-node','An owned Elements RPC source is not configured.');
  try {
   const url = new URL(origin);
   if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid source');
   const cookie = process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE;
   const credentials = cookie ? readFileSync(cookie,'utf8').trim() : `${process.env.UNIVERSE_ELEMENTS_RPC_USER || ''}:${process.env.UNIVERSE_ELEMENTS_RPC_PASSWORD || ''}`;
   const response = await axios.post(url.toString(),{jsonrpc:'1.0',id:'public-elements-evidence',method,params},{headers:{Authorization:'Basic '+Buffer.from(credentials).toString('base64')},timeout:3000,maxContentLength:100000,maxBodyLength:1000,maxRedirects:0,proxy:false});
   if (response.data?.error || !Object.prototype.hasOwnProperty.call(response.data || {},'result')) throw Error('RPC failure');
   return response.data.result;
  } catch { throw new EvidenceError('unavailable-elements-node','The owned Elements node could not return public chain evidence.'); }
 }
};
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const script = (v: unknown): v is string => typeof v === 'string' && /^(?:[0-9a-f]{2}){1,10000}$/.test(v);
let active = 0;
/** Public chain facts only. Signing-policy bytes do not measure signer liveness or reserves. */
export class ElementsNodeSource {
 constructor(private reader: ElementsReader = ownedElementsReader) {}
 async snapshot(network: string) {
  if (!['liquidv1','liquidtestnet','elementsregtest'].includes(network)) throw new EvidenceError('invalid-network','Choose liquidv1, liquidtestnet or elementsregtest.',400);
  if (active >= 2) throw new EvidenceError('source-busy','The bounded Elements reader is busy.');
  active++;
  try {
   const before = await this.reader.call('getblockchaininfo',[]);
   if (before.chain !== network || !Number.isSafeInteger(before.blocks) || before.blocks < 0 || !hash(before.bestblockhash) || typeof before.initialblockdownload !== 'boolean') throw new EvidenceError('invalid-checkpoint','Owned Elements source returned an invalid or wrong-network checkpoint.');
   const header = await this.reader.call('getblockheader',[before.bestblockhash,true]);
   const atHeight = await this.reader.call('getblockhash',[before.blocks]);
   const after = await this.reader.call('getblockchaininfo',[]);
   if (header.hash !== before.bestblockhash || header.height !== before.blocks || atHeight !== before.bestblockhash || after.bestblockhash !== before.bestblockhash || after.blocks !== before.blocks || after.chain !== network) throw new EvidenceError('source-changed','The owned Elements checkpoint changed during retrieval. Retry.',409);
   if (!script(before.current_signblock_hex) || !script(before.current_fedpeg_program) || !script(before.current_fedpeg_script)) throw new EvidenceError('unsupported-federation-format','The owned Elements node did not return supported dynamic-federation policy bytes.');
   return {network,blockHeight:before.blocks,blockHash:before.bestblockhash,initialBlockDownload:before.initialblockdownload,signblockScript:before.current_signblock_hex,fedpegProgram:before.current_fedpeg_program,fedpegScript:before.current_fedpeg_script,source:'owned-elements-rpc',reserveSats:null,activeAssetCount:null,signersOnline:null,scope:'checkpoint-and-policy-only'};
  } finally { active--; }
 }
}
export const elementsNodeSource = new ElementsNodeSource();
