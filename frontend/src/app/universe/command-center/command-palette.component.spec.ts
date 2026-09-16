import {describe,it,expect,vi,afterEach} from 'vitest';
import {Injector,runInInjectionContext,DestroyRef} from '@angular/core';
import {Router} from '@angular/router';
import {Subject,of} from 'rxjs';
import {StateService} from '@app/services/state.service';
import {UniverseApiService} from '@app/universe/universe-api.service';
import {CommandPaletteComponent} from './command-palette.component';
import {saveQuery,pushRecent,loadSaved,loadRecent} from './command-history';
function setup(){const ended:Function[]=[],events=new Subject(),networkChanged$=new Subject(),search$=vi.fn(()=>of<any>({groups:[]}));const injector=Injector.create({providers:[{provide:Router,useValue:{url:'/',events}},{provide:StateService,useValue:{network:'mainnet',networkChanged$}},{provide:UniverseApiService,useValue:{search$}},{provide:DestroyRef,useValue:{onDestroy:(cb:Function)=>{ended.push(cb);return ()=>{};}}}]});return {c:runInInjectionContext(injector,()=>new CommandPaletteComponent()),search$,end:()=>{ended.forEach(cb=>cb());injector.destroy();}};}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('command request and secret boundaries',()=>{
 it('refuses known key-shaped history in disposable storage',()=>{const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v)} as any;const input='xprv'+'A'.repeat(30);expect(saveQuery(storage,input)).toBe(false);pushRecent(storage,input);expect(values.size).toBe(0);expect(loadSaved(storage)).toEqual([]);expect(loadRecent(storage)).toEqual([]);});
 it('invalidates remote results immediately and reruns unchanged text when allChains changes',()=>{vi.useFakeTimers();const {c,search$,end}=setup();c.onValueChange('alpha');vi.advanceTimersByTime(250);expect(search$).toHaveBeenCalledTimes(1);c.toggleAllChains();vi.advanceTimersByTime(250);expect(search$).toHaveBeenCalledTimes(2);expect(search$).toHaveBeenLastCalledWith('alpha','bitcoin',false);(c as any).remoteCandidates.set([{label:'old'}]);c.onValueChange('beta');expect((c as any).remoteCandidates()).toEqual([]);end();});
 it('drops late clipboard completion after edit or destroy',async()=>{let resolve!:(v:string)=>void;vi.stubGlobal('navigator',{clipboard:{readText:()=>new Promise<string>(r=>resolve=r)}});const {c,end}=setup();const pending=c.pasteFromClipboard();c.onValueChange('newer');resolve('older');await pending;expect(c.value()).toBe('newer');const second=c.pasteFromClipboard();end();resolve('old');await second;expect(c.value()).toBe('newer');});
 it('drops late QR result and closes its bitmap',async()=>{let resolve!:(v:any)=>void;const close=vi.fn();vi.stubGlobal('window',{BarcodeDetector:class {detect(){return new Promise(r=>resolve=r);}}});vi.stubGlobal('createImageBitmap',async()=>({close}));const {c,end}=setup();const pending=c.onQrImage({target:{files:[{}],value:'x'}} as any);await Promise.resolve();c.onValueChange('newer');resolve([{rawValue:'older'}]);await pending;expect(c.value()).toBe('newer');expect(close).toHaveBeenCalledOnce();end();});
});
