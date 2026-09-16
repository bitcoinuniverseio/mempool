import { Application, Request, Response } from 'express';
import defaultService, { LightningResilienceService } from './lightning-resilience.service';
import { LightningEvidenceError } from './lightning-evidence';
export class LightningResilienceRoutes {
 constructor(private readonly service:LightningResilienceService=defaultService){}
 public initRoutes(app:Application):void{
  const prefix='/api/v1/intelligence/lightning/resilience/';
  const route=(fn:(req:Request)=>unknown)=>(req:Request,res:Response)=>{Promise.resolve().then(()=>fn(req)).then(value=>res.json(value)).catch(e=>res.status(e instanceof LightningEvidenceError?e.status:503).json({stage:e instanceof LightningEvidenceError?e.code:'lightning-source-unavailable',error:e instanceof LightningEvidenceError?e.message:'Owned Lightning evidence is unavailable.'}));};
  app.get(prefix+'overview',route(()=>this.service.getOverview()));
  app.get(prefix+'channels',route(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async()=>({channels:await this.service.listChannels()})));
  app.get(prefix+'channels/:shortId',route(req=>this.service.getChannel(req.params.shortId)));
  app.get(prefix+'nodes/:publicKey',route(req=>this.service.getNodeResilience(req.params.publicKey)));
  app.get(prefix+'incidents',route(()=>({incidents:this.service.listIncidents(),status:'unknown',scope:'No incident detector or historical hold telemetry is configured.'})));
  app.get(prefix+'mitigations',route(()=>({mitigations:this.service.listMitigations()})));
  app.get(prefix+'capabilities',route(()=>this.service.getCapabilities()));
  app.post(prefix+'simulate',route(req=>this.service.runSimulator(req.body)));
 }
}
export default new LightningResilienceRoutes();
