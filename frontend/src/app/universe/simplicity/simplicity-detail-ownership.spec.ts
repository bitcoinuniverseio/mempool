import { expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { SimplicityProgramDetailComponent } from './simplicity-program-detail.component';
import { SimplicityTxComponent } from './simplicity-tx.component';
const cdr = {markForCheck:vi.fn()} as any;
const params = (id: string | null) => ({get:()=>id});
it('program detail clears and cancels reused route requests, rejects mismatched IDs and never invents fallback', () => {
  const route=new BehaviorSubject(params('one'));const requests:Subject<any>[]=[];
  const api={getProgramById$:vi.fn(()=>{const request=new Subject<any>();requests.push(request);return request;})};
  const component=new SimplicityProgramDetailComponent({paramMap:route} as any,api as any,cdr,{network:'liquid',networkChanged$:new Subject()} as any);
  component.ngOnInit();route.next(params('two'));expect(requests[0].observed).toBe(false);
  requests[1].next({program_id:'one',resource_bounds:{},jets:[]});requests[1].complete();expect(component.program).toBeNull();
  route.next(params(null));expect(api.getProgramById$).toHaveBeenCalledTimes(2);expect(component.error).toContain('required');component.ngOnDestroy();
});
it('transaction renders the actual executions envelope and rejects mismatches while clearing network changes', () => {
  const id='a'.repeat(64);const route=new BehaviorSubject(params(id));const network=new Subject<string>();const requests:Subject<any>[]=[];
  const api={getTransactionExecution$:vi.fn(()=>{const request=new Subject<any>();requests.push(request);return request;})};
  const component=new SimplicityTxComponent({paramMap:route} as any,api as any,cdr,{network:'liquid',networkChanged$:network} as any);
  component.ngOnInit();requests[0].next({txid:id,has_simplicity:true,executions:[{txid:id,success:false,steps:[]},{txid:id,success:true,steps:[]}]});requests[0].complete();
  expect(component.transaction?.executions).toHaveLength(2);expect(component.transaction?.executions[0].success).toBe(false);
  network.next('liquidtestnet');expect(component.transaction).toBeNull();requests[1].next({txid:'b'.repeat(64),has_simplicity:false,executions:[]});requests[1].complete();expect(component.transaction).toBeNull();
  route.next(params('invalid'));expect(api.getTransactionExecution$).toHaveBeenCalledTimes(2);component.ngOnDestroy();
});
