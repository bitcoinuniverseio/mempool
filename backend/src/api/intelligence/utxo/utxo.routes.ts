import { Application,Request,Response } from 'express';
import { UtxoIntelligenceService,utxoIntelligenceService } from './utxo-intelligence.service';
import { UtxoEvidenceError } from './utxo-evidence';
export class UtxoRoutes {
 constructor(private readonly service:UtxoIntelligenceService=utxoIntelligenceService){}
 initRoutes(app:Application):void{const prefix='/api/v1/intelligence/utxo/';
 const route=(fn:(req:Request)=>unknown)=>(req:Request,res:Response)=>{res.setHeader('Cache-Control','no-store');Promise.resolve().then(()=>fn(req)).then(data=>res.json(data)).catch(e=>res.status(e instanceof UtxoEvidenceError?e.status:503).json({stage:e instanceof UtxoEvidenceError?e.code:'utxo-source-unavailable',error:e instanceof UtxoEvidenceError?e.message:'Owned UTXO evidence is unavailable.'}));};
 app.get(prefix+'overview',route(()=>this.service.getOverview()));app.get(prefix+'cohorts',route(()=>this.service.getCohorts()));
 app.get(prefix+'history',route(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async()=>{const {transitions,...context}=await this.service.getSpendTransitionEvidence(30);return {...context,history:transitions};}));
 app.get(prefix+'economic-thresholds',route(()=>this.service.getEconomicThresholdEvidence()));
 app.get(prefix+'spend-transitions',route(/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async req=>{const raw=req.query.limit;if(raw!==undefined&&(typeof raw!=='string'||!/^([1-9][0-9]{0,2})$/.test(raw)||Number(raw)>288))throw new UtxoEvidenceError('invalid-utxo-limit','Transition limit must be an integer from1 to288.',400);return this.service.getSpendTransitionEvidence(raw===undefined?10:Number(raw));}));
 app.get(prefix+'reconciliation',route(()=>this.service.getReconciliation()));}
}
export default new UtxoRoutes();
