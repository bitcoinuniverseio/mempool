import { spawn } from 'child_process';
import { once } from 'events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HistoryStore, historyPathForRole } from './history-store';
import { TimeMachineService, TIME_MACHINE_LIMITS } from './time-machine.service';
const tx = (id: string) => ({ txid: id.repeat(64), vsize: 100, weight: 400, fee: 200 } as any);
const block = (height: number) => ({height, id: height.toString(16).padStart(64,'0'), weight: 4000, extras:{totalFees:100}} as any);
describe('durable observed history', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(),'history-test-')); });
  afterEach(() => { rmSync(directory,{recursive:true,force:true}); });
  const create = (store: HistoryStore, now=1000) => new TimeMachineService({store,network:'signet',now,feed:()=>({'a':tx('a')})});
  it('restores events, rejects restart gaps and reanchors after restart', async () => {
    const store = new HistoryStore(join(directory,'state.gz'),'signet'); const service=create(store);
    const checkpoint=service.observeBlock(block(1),[],1000);
    service.observeMempoolChange([tx('b')],[],1100); await service.flushHistory();
    const restarted=create(store,2000);
    expect(restarted.getCoverage().persistence.error).toBeNull();
    expect(restarted.exportState(checkpoint.state_hash)?.txids).toEqual(['a'.repeat(64)]);
    expect(restarted.replayToTimestampOrHeight(new Date(1100).toISOString()).total_transactions).toBe(2);
    expect(()=>restarted.replayToTimestampOrHeight(new Date(1500).toISOString())).toThrow(/not observing/);
    restarted.observeBlock(block(2),[],2100);
    expect(restarted.replayToTimestampOrHeight(undefined,2).coverage_status).toBe('complete');
    expect(restarted.replayToTimestampOrHeight(new Date(2200).toISOString()).coverage_status).toBe('partial');
    await restarted.flushHistory();
  });
  it.each(['corrupt','network','schema'])('preserves and reports %s storage', async kind => {
    const path=join(directory,'state.gz'); const store=new HistoryStore(path,'signet');
    if(kind==='corrupt') writeFileSync(path,'broken');
    else if(kind==='network') { const other=new HistoryStore(path,'mainnet'); await other.write({}); other.close(); }
    else await store.write({schema:'observed-history-v1'});
    const original=readFileSync(path); const service=create(store);
    expect(service.getCoverage().persistence.error).toMatch(/preserved/);
    service.observeBlock(block(1),[],1000);
    await expect(service.flushHistory()).rejects.toMatchObject({code:'history-storage-invalid'});
    expect(readFileSync(path)).toEqual(original);
  });
  it('serializes and drains writes while new observations arrive', async () => {
    const store=new HistoryStore(join(directory,'state.gz'),'signet'); let release!:()=>void;
    const barrier=new Promise<void>(resolve=>release=resolve); const actual=store.write.bind(store);
    const spy=jest.spyOn(store,'write').mockImplementationOnce(async value=>{await barrier;await actual(value);});
    const service=create(store); service.observeBlock(block(1),[],1000);
    const first=service.flushHistory(); service.observeMempoolChange([tx('b')],[],1100);
    expect(service.flushHistory()).toBe(first); release(); await first;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(create(store,1200).getTransactionLifecycle('b'.repeat(64))).toHaveLength(1);
  });
  it('reports disk failure and recovers on retry', async () => {
    const store=new HistoryStore(join(directory,'state.gz'),'signet'); const service=create(store);
    jest.spyOn(store,'write').mockRejectedValueOnce(new Error('disk full'));
    service.observeBlock(block(1),[],1000);
    await expect(service.flushHistory()).rejects.toMatchObject({code:'history-storage-write-failed'});
    expect(service.getCoverage().persistence.error).toMatch(/not be persisted/);
    await service.flushHistory(); expect(service.getCoverage().persistence.error).toBeNull();
  });
  it('refuses timestamp replay when same-time events were pruned', () => {
    const service=new TimeMachineService({store:null,network:'signet',now:1000,feed:()=>({})}); service.observeBlock(block(1),[],1000);
    const original=TIME_MACHINE_LIMITS.events; (TIME_MACHINE_LIMITS as any).events=1;
    try { service.observeMempoolChange([tx('a'),tx('b')],[],1000);
      expect(()=>service.replayToTimestampOrHeight(new Date(1000).toISOString())).toThrow(/pruned/);
      expect(service.replayToTimestampOrHeight(undefined,1).total_transactions).toBe(0);
    } finally { (TIME_MACHINE_LIMITS as any).events=original; }
  });
  it.each([NaN,Infinity,-1,1.2,'1x',null])('rejects malformed height %s', height => {
    expect(()=>new TimeMachineService({store:null}).replayToTimestampOrHeight(undefined,height as any)).toThrow(/nonnegative integer/);
  });
  it('extends failed-poll gaps through recovery and advances empty complete polls', () => {
    const service=new TimeMachineService({store:null,network:'signet',now:1000,feed:()=>({})});
    service.observeBlock(block(1),[],1000);
    service.observePoll([],[],true,1100);
    expect(service.getCoverage().observed_through_utc).toBe(new Date(1100).toISOString());
    service.markObservationFailure(1200); service.observePoll([],[],true,1500);
    expect(()=>service.replayToTimestampOrHeight(new Date(1400).toISOString())).toThrow(/not observing/);
    service.observeBlock(block(2),[],1600);
    expect(service.replayToTimestampOrHeight(undefined,2).coverage_status).toBe('complete');
  });  it('isolates stable cluster workers and never opens a primary writer', () => {
    expect(historyPathForRole('/cache/history',true,true)).toBeNull();
    expect(historyPathForRole('/cache/history',true,false,'0')).toBe('/cache/history.worker-0');
    expect(historyPathForRole('/cache/history',true,false,'1')).not.toBe(historyPathForRole('/cache/history',true,false,'0'));
    expect(()=>historyPathForRole('/cache/history',true,false,'../bad')).toThrow(/workerId/);
  });
  it('refuses a second independent writer and permits an orderly restart', async () => {
    const path=join(directory,'state.gz'); const first=new HistoryStore(path,'signet');
    const service=create(first); service.observeBlock(block(1),[],1000); await service.flushHistory();
    const second=new HistoryStore(path,'signet'); expect(()=>second.read()).toThrow();
    await service.closeHistory();
    const restarted=create(second,2000); expect(restarted.getCoverage().total_checkpoints).toBe(1);
    await restarted.closeHistory();
  });  it('recovers the last atomic snapshot after a real writer process is killed', async () => {
    const path=join(directory,'child.gz');
    const child=spawn(process.execPath,['-r','ts-node/register/transpile-only','-e',
      "const {HistoryStore}=require(process.argv[1]);const store=new HistoryStore(process.argv[2],'signet');store.write({durable:true}).then(()=>{process.stdout.write('ready');process.stdin.resume();});",
      join(__dirname,'history-store.ts'),path],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});
    try {
      await Promise.race([once(child.stdout!,'data'),once(child,'exit').then(()=>{throw new Error('child exited before write');})]);
      const live=new HistoryStore(path,'signet'); expect(()=>live.read()).toThrow();
      const exited=once(child,'exit'); child.kill('SIGKILL'); await exited;
      const recovered=new HistoryStore(path,'signet');
      expect(recovered.read()).toEqual({durable:true}); await recovered.write({durable:'restarted'}); recovered.close();
      const again=new HistoryStore(path,'signet'); expect(again.read()).toEqual({durable:'restarted'}); again.close();
    } finally { if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL'); }
  },15000);  it('rejects conflicting and invalid calendar targets',()=>{
    const service=new TimeMachineService({store:null});
    expect(()=>service.replayToTimestampOrHeight('2026-02-30T00:00:00Z')).toThrow(/ISO-8601/);
    expect(()=>service.replayToTimestampOrHeight('2026-02-28T00:00:00Z',1)).toThrow(/not both/);
  });
});
