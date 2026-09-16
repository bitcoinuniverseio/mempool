import { createHash } from 'crypto';
import DB from '../../../database';
import config from '../../../config';
import { DatabaseSwapObservations } from './swaps-observations';
jest.mock('../../../database', () => ({__esModule:true,default:{query:jest.fn()}}));
const context = {chain:'bitcoin' as const,network:'signet' as const,source_id:'configured-bitcoin-core',block_height:200,block_hash:'a'.repeat(64),observed_at:'2026-09-15T18:00:00.000Z'};
const payload = {...context,txid:'b'.repeat(64),vout:1,value_sats:100000,stage:'lockup-script-verified'};
const row = (p:any) => ({payload:JSON.stringify(p),payload_hash:createHash('sha256').update(JSON.stringify(p,Object.keys(p).sort())).digest('hex')});
describe('Durable swap observation schema and integrity', () => {
  const enabled=config.DATABASE.ENABLED;
  beforeEach(()=>{config.DATABASE.ENABLED=true;jest.clearAllMocks();});
  afterAll(()=>{config.DATABASE.ENABLED=enabled;});
  it('returns valid bounded records with their integrity digest',async()=>{
    (DB.query as jest.Mock).mockResolvedValue([[row(payload)]]);
    expect(await new DatabaseSwapObservations().recent(context)).toEqual([{...payload,payload_hash:row(payload).payload_hash}]);
  });
  it.each([{value_sats:-1},{value_sats:'1000'},{value_sats:2100000000000001},{vout:0x100000000},{block_height:-1},{observed_at:'yesterday'},{txid:'invalid'},{stage:'refunded'},{source_id:''}])('rejects malformed data even with a matching digest %j',async changes=>{
    (DB.query as jest.Mock).mockResolvedValue([[row({...payload,...changes})]]);
    await expect(new DatabaseSwapObservations().recent(context)).rejects.toThrow(/schema/);
  });
  it('rejects duplicate outpoint records and altered hashes',async()=>{
    (DB.query as jest.Mock).mockResolvedValueOnce([[row(payload),row(payload)]]).mockResolvedValueOnce([[{...row(payload),payload_hash:'0'.repeat(64)}]]);
    await expect(new DatabaseSwapObservations().recent(context)).rejects.toThrow(/integrity/);
    await expect(new DatabaseSwapObservations().recent(context)).rejects.toThrow(/integrity/);
  });
  it('rejects malformed writes before database mutation',async()=>{
    await expect(new DatabaseSwapObservations().save(context,payload.txid,1,-1,'lockup-script-verified')).rejects.toThrow(/schema/);
    expect(DB.query).not.toHaveBeenCalled();
  });
});
