import { describe, it, expect, vi } from 'vitest';
import { PsbtWorkbenchComponent } from './psbt-workbench.component';
import { SeoService } from '@app/services/seo.service';
import { ChangeDetectorRef } from '@angular/core';

// A real PSBT v0 containing a one-input, one-output unsigned transaction.
function fixture(locktime: number): Uint8Array {
  const tx = [2,0,0,0,1,...Array(32).fill(0),0,0,0,0,0,255,255,255,255,1,...Array(8).fill(0),0,locktime,0,0,0];
  return Uint8Array.from([112,115,98,116,255,1,0,tx.length,...tx,0,0,0]);
}
function setup() {
  const markForCheck = vi.fn();
  const component = new PsbtWorkbenchComponent({ setTitle: vi.fn() } as unknown as SeoService, { markForCheck } as unknown as ChangeDetectorRef);
  function pending(name: string) {
    let resolve!: (value: ArrayBuffer) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no; });
    component.onFileChosen({ target: { files: [{ name, size: 100, arrayBuffer: () => promise }], value: name } } as unknown as Event);
    return { resolve: (bytes: Uint8Array) => resolve(bytes.buffer as ArrayBuffer), reject };
  }
  return { component, pending, markForCheck };
}
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

describe('PSBT file read ownership', () => {
  it('keeps the newer file when an older read completes last', async () => {
    const { component, pending } = setup(); const a = pending('A.psbt'); const b = pending('B.psbt');
    b.resolve(fixture(2)); await flush();
    expect(component.roundTripVerified).toBe(true); const latest = component.input;
    a.resolve(fixture(1)); await flush();
    expect(component.input).toBe(latest); expect(component.fileName).toBe('B.psbt'); expect(component.roundTripVerified).toBe(true);
  });
  it.each(['clear', 'ngOnDestroy'] as const)('does not restore bytes or results after %s', async action => {
    const { component, pending, markForCheck } = setup(); const a = pending('A.psbt'); component[action]();
    a.resolve(fixture(1)); await flush();
    expect(component.input).toBe(''); expect(component.inspection).toBeNull(); expect(component.roundTripVerified).toBe(false); expect(markForCheck).not.toHaveBeenCalled();
  });
  it('does not overwrite pasted input or surface errors from a superseded file', async () => {
    const { component, pending } = setup(); const a = pending('A.psbt');
    component.input = 'new pasted input'; component.inputChanged(); a.reject(new Error('late failure')); await flush();
    expect(component.input).toBe('new pasted input'); expect(component.error).toBeNull();
  });
});
