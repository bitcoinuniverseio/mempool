import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimpleChange } from '@angular/core';
import { ClipboardComponent } from './clipboard.component';

describe('shared Clipboard result ownership', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('deduplicates a pending attempt, reports failure accessibly and does not claim success', async () => {
    const component = new ClipboardComponent({ markForCheck: vi.fn() } as never); component.text = '0';
    let reject!: (error: Error) => void;
    const copy = vi.spyOn(component, 'copyToClipboard').mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const pending = component.copyText(); await component.copyText(); expect(copy).toHaveBeenCalledTimes(1); expect(component.copying).toBe(true);
    reject(new Error('permission denied')); await pending;
    expect(component.copying).toBe(false); expect(component.showMessage).toBe(false); expect(component.copyError).toContain('Select the text'); component.ngOnDestroy();
  });
  it('does not announce an older value and clears success timer on destroy', async () => {
    vi.useFakeTimers(); const changed=vi.fn(); const component=new ClipboardComponent({markForCheck:changed} as never);component.text='first';
    let resolve!: () => void;vi.spyOn(component,'copyToClipboard').mockImplementation(()=>new Promise<void>(done=>{resolve=done;}));
    const pending=component.copyText();component.text='second';component.ngOnChanges({text:new SimpleChange('first','second',false)});resolve();await pending;expect(component.showMessage).toBe(false);
    vi.spyOn(component,'copyToClipboard').mockResolvedValue(undefined);await component.copyText();expect(component.showMessage).toBe(true);expect(vi.getTimerCount()).toBe(1);
    component.ngOnDestroy();const calls=changed.mock.calls.length;expect(vi.getTimerCount()).toBe(0);vi.runAllTimers();expect(changed).toHaveBeenCalledTimes(calls);
  });
  it('handles a late rejected pending operation after route destruction without updating the view', async()=>{
    const changed=vi.fn();const component=new ClipboardComponent({markForCheck:changed} as never);component.text='address';let reject!:(error:Error)=>void;
    vi.spyOn(component,'copyToClipboard').mockImplementation(()=>new Promise<void>((_done,fail)=>{reject=fail;}));const pending=component.copyText();component.ngOnDestroy();reject(new Error('denied'));await pending;
    expect(changed).not.toHaveBeenCalled();expect(component.showMessage).toBe(false);expect(component.copyError).toBeNull();
  });
  it('copies the captured fallback argument and reports execCommand(false), always removing the element',async()=>{
    const textarea={value:'',style:{opacity:''},setAttribute:vi.fn(),select:vi.fn(),remove:vi.fn()};
    vi.stubGlobal('navigator',{});vi.stubGlobal('document',{createElement:()=>textarea,body:{appendChild:vi.fn()},execCommand:vi.fn(()=>false)});
    const component=new ClipboardComponent({markForCheck:vi.fn()} as never);component.text='newer';
    await expect(component.copyToClipboard('captured')).rejects.toThrow('not accepted');expect(textarea.value).toBe('captured');expect(textarea.remove).toHaveBeenCalledOnce();component.ngOnDestroy();
  });

});
