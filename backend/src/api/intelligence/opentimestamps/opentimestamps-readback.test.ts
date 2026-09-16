import { readFileSync } from 'fs';
import { join } from 'path';
import { Block } from 'bitcoinjs-lib';
import { OpenTimestampsService } from './opentimestamps.service';
import { MemoryTimestampRecordStore, TimestampRecord } from './opentimestamps-store';
import { CalendarClient } from './ots-calendar-client';
const header = JSON.parse(readFileSync(join(__dirname, '__fixtures__/bitcoin-358391-header.json'), 'utf8'));
const genesis = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const digest = '03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340';
const record: TimestampRecord = { record_id: '00000000-0000-4000-8000-000000000001', digest_hex: digest, algorithm: 'sha256', network: 'mainnet', commitment_hex: 'ab'.repeat(32), proof_base64: readFileSync(join(__dirname, '__fixtures__/hello-world.txt.ots')).toString('base64'), status: 'anchored', calendars: [{ calendar_id: 'local', url: 'https://local.example', status: 'anchored', contacted_at: '2026-09-01T00:00:00Z' }], submitted_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', anchor_block_height: header.height, anchor_block_hash: header.hash };
function setup() {
  const store = new MemoryTimestampRecordStore();
  let active = header.hash; let encoded = header.header; let unavailable = false;
  const reader = { $getBlockHash: async (height: number) => { if (unavailable) throw new Error('private-source-path'); return height === 0 ? genesis : active; }, $getBlockHeader: async () => encoded };
  const calendars = new CalendarClient([{ calendar_id: 'local', name: 'Local', url: 'https://local.example' }], { get: async () => ({status:404,body:Buffer.alloc(0)}), post: async () => { throw new Error('no writes'); } });
  const service = new OpenTimestampsService({store,reader,network:'mainnet',calendars});
  return {store,service,outage:()=>{unavailable=true;},reorg:()=>{const block=Block.fromHex(header.header);block.merkleRoot=Buffer.alloc(32,3);block.nonce++;active=block.getId();encoded=block.toBuffer(true).toString('hex');}};
}
describe('persisted timestamp active-chain readback',()=>{
  it('derives the Bitcoin Merkle root from the actual official proof header, never the nonced commitment',async()=>{
    const {store,service}=setup();await store.insert(record);
    const anchors=await service.listAnchors();
    expect(anchors.coverage).toEqual({record_limit:500,records_examined:1,complete:true});
    expect(anchors.anchors[0].merkle_root).toBe(Buffer.from(Block.fromHex(header.header).merkleRoot!).reverse().toString('hex'));
    expect(anchors.anchors[0].merkle_root).not.toBe(record.commitment_hex);
    expect(await service.getBatch(record.record_id)).toMatchObject({merkle_root:null,commitment_hex:record.commitment_hex,anchor_status:'active-chain'});
  });
  it('removes an orphaned stored anchor without destroying the historical proof',async()=>{
    const {store,service,reorg}=setup();await store.insert(record);expect((await service.listAnchors()).anchors).toHaveLength(1);
    reorg();expect((await service.listAnchors()).anchors).toEqual([]);
    expect(await service.getBatch(record.record_id)).toMatchObject({status:'failed',anchor_status:'reorged'});
    expect(await service.getOverview()).toMatchObject({bitcoin_confirmed_proofs:0,stored_anchored_proofs:1,latest_anchored_block_height:null});
    expect(await store.get(record.record_id)).toEqual(record);
  });
  it('returns unavailable rather than trusting persisted evidence when the owned reader fails',async()=>{
    const {store,service,outage}=setup();await store.insert(record);outage();
    await expect(service.listAnchors()).rejects.toMatchObject({status:503,code:'unavailable-bitcoin-header'});
    await expect(service.getBatch(record.record_id)).rejects.toMatchObject({status:503});
  });
  it('treats malformed persisted proof bytes as a source failure, not caller input failure',async()=>{
    const {store,service}=setup();await store.insert({...record,proof_base64:'invalid'});
    await expect(service.listAnchors()).rejects.toMatchObject({status:503,code:'unavailable-record-store'});
  });
  it('uses verified proof height instead of corrupted stored metadata',async()=>{
    const {store,service}=setup();await store.insert({...record,anchor_block_height:999999,anchor_block_hash:'ff'.repeat(32)});
    expect(await service.getBatch(record.record_id)).toMatchObject({anchor_status:'active-chain',anchor_block_height:header.height,anchor_block_hash:header.hash});
    expect((await service.listCalendars()).calendars[0].last_anchor_block_height).toBe(header.height);
  });
  it('declares capped windows and withholds an exact global active count',async()=>{
    const {store,service}=setup();for(let n=0;n<501;n++) await store.insert({...record,record_id:String(n)});
    const anchors=await service.listAnchors();expect(anchors.coverage).toEqual({record_limit:500,records_examined:500,complete:false});
    expect(anchors.verified_records).toBe(500);
    const overview=await service.getOverview();expect(overview.bitcoin_confirmed_proofs).toBeNull();expect(overview.stored_anchored_proofs).toBe(501);
    expect((await service.listCalendars()).calendars[0]).toMatchObject({anchored_proofs_count:200,anchored_coverage:{complete:false,records_examined:200}});
  });
});
