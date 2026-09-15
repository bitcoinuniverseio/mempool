import {it,expect,vi} from 'vitest';
import {BehaviorSubject,Subject} from 'rxjs';
import {convertToParamMap} from '@angular/router';
import {ConsensusProposalDetailComponent} from './consensus-proposal-detail.component';
import {VaultsDesignerComponent} from './vaults-designer.component';
import {VaultsSimulateComponent} from './vaults-simulate.component';
const cd={markForCheck:vi.fn()} as any;
it('owns proposal route requests and rejects mismatched identity',()=>{const params=new BehaviorSubject(convertToParamMap({proposalId:'a'})),requests:Subject<any>[]=[];const c=new ConsensusProposalDetailComponent({paramMap:params} as any,{getProposalById$:()=>{const p=new Subject();requests.push(p);return p;}} as any,cd);c.ngOnInit();params.next(convertToParamMap({proposalId:'b'}));expect(requests[0].observed).toBe(false);requests[1].next({proposal_id:'a'});expect(c.proposal).toBeNull();params.next(convertToParamMap({}));expect(c.loading).toBe(false);expect(c.error).toContain('does not name');c.ngOnDestroy();});
it('transfers only validated public proposal/delay/commitment context',()=>{const q=new BehaviorSubject(convertToParamMap({proposal:'bip-119',delay:'288',ctv:'ab'.repeat(32)}));const route={queryParamMap:q} as any;const designer=new VaultsDesignerComponent(cd,route);expect(designer.delayBlocks).toBe(288);const sim=new VaultsSimulateComponent({} as any,cd,{networkChanged$:new Subject()} as any,route);expect(sim.covenantScript).toBe('20'+'ab'.repeat(32)+'b3');q.next(convertToParamMap({proposal:'invalid',delay:'-1',ctv:'x'}));expect(designer.error).toContain('Unsupported');expect(sim.errorMessage).toContain('Unsupported');expect(sim.covenantScript).toBe('');designer.ngOnDestroy();sim.ngOnDestroy();expect(q.observed).toBe(false);});
