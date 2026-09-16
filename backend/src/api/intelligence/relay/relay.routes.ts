import { Application,Request,Response } from 'express';
import { RelayCollectorService,RelayEvidenceError,relayCollectorService } from './relay-collector.service';
import { streamRelay } from './relay-stream';
export class RelayRoutes {
  constructor(private readonly collector:RelayCollectorService=relayCollectorService){}
  public initRoutes(app:Application):void{
    const prefix='/api/v1/intelligence/relay/';
    const route=(fn:(req:Request,res:Response)=>Promise<unknown>|unknown)=>(req:Request,res:Response)=>{Promise.resolve().then(()=>fn(req,res)).catch(error=>{
      if(res.headersSent){res.destroy();return;}
      if(error instanceof RelayEvidenceError)res.status(error.status).json({stage:error.code,error:error.message});
      else res.status(503).json({stage:'relay-source-unavailable',error:'Relay evidence source is unavailable.'});
    });};
    app.get(prefix+'overview',route(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async(_req,res)=>res.json(await this.collector.getOverview())))
      .get(prefix+'transactions/:txid',route((req,res)=>res.json(this.collector.getPropagationForTx(req.params.txid))))
      .get(prefix+'sensors',route(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async(_req,res)=>{const sensors=await this.collector.getSensors();res.json({sensors,total:sensors.length});}))
      .get(prefix+'policy-differences',route(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async(_req,res)=>res.json(await this.collector.getPolicyDifferences())))
      .get(prefix+'transports',route(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async(_req,res)=>res.json(await this.collector.getTransportMetrics())))
      .get(prefix+'stream',route((req,res)=>streamRelay(req,res,this.collector)));
  }
}
export default new RelayRoutes();
