import { afterEach,describe,expect,it,vi } from 'vitest';
import { SimplicityCompilerService } from './simplicity-compiler.service';
import { SimplicityToolsComponent } from './simplicity-tools.component';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
class LocalWorker {
 static latest:LocalWorker;onmessage:((event:any)=>void)|null=null;onerror:()=>void;terminate=vi.fn();postMessage=vi.fn();
 constructor(public url:URL){LocalWorker.latest=this;}
}
function install(){vi.stubGlobal('Worker',LocalWorker);vi.stubGlobal('document',{baseURI:'https://example.invalid/signet/'});}
describe('bounded compiler worker',()=>{
 it('sends source only to a same-origin worker and terminates after result',async()=>{
  install();const task=new SimplicityCompilerService().compile('fn main() {}','{}','{}');
  expect(LocalWorker.latest.url.href).toBe('https://example.invalid/signet/resources/simplicity-compiler/compiler.worker.js');
  expect(LocalWorker.latest.postMessage).toHaveBeenCalledWith({source:'fn main() {}',arguments:{},witness:{}});
  LocalWorker.latest.onmessage!({data:{result:{cmr:'test'}}});await expect(task.promise).resolves.toEqual({cmr:'test'});expect(LocalWorker.latest.terminate).toHaveBeenCalled();
 });
 it('terminates work on timeout and cancellation',async()=>{
  install();vi.useFakeTimers();const task=new SimplicityCompilerService().compile('fn main() {}','{}','{}');
  const rejected=expect(task.promise).rejects.toThrow('15-second');await vi.advanceTimersByTimeAsync(15000);await rejected;
  expect(LocalWorker.latest.terminate).toHaveBeenCalled();
  const next=new SimplicityCompilerService().compile('fn main() {}','{}','{}');next.cancel();await expect(next.promise).rejects.toThrow('cancelled');
 });
 it('clears stale result and cancels on edits, template changes and destroy',async()=>{
  install();const page=new SimplicityToolsComponent({markForCheck:vi.fn()} as any,new SimplicityCompilerService());
  const compiling=page.compile();page.loadSample();await compiling;expect(page.compiledOutput).toBeNull();expect(page.error).toBeNull();expect(LocalWorker.latest.terminate).toHaveBeenCalled();
  const pending=page.compile();page.ngOnDestroy();await pending;expect(page.compiledOutput).toBeNull();expect(page.witnessJson).toBe('{}');
 });
 it('rejects malformed JSON and clears prior success on failure',async()=>{
  install();const page=new SimplicityToolsComponent({markForCheck:vi.fn()} as any,new SimplicityCompilerService());
  page.compiledOutput={} as any;page.argumentsJson='{';await page.compile();expect(page.compiledOutput).toBeNull();expect(page.error).toBeTruthy();
 });
});
