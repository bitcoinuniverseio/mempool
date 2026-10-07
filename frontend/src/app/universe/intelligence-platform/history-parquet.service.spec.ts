import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryParquetService } from './history-parquet.service';

class OwnedWorker {
  static instances: OwnedWorker[] = [];
  static throwOnPost = false;
  onmessage: (event: any) => void;
  onerror: () => void;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { OwnedWorker.instances.push(this); if (OwnedWorker.throwOnPost) { this.postMessage.mockImplementation(() => { throw new Error('controlled synchronous clone failure'); }); } }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); OwnedWorker.instances = []; OwnedWorker.throwOnPost = false; });
function setup() { vi.stubGlobal('Worker', OwnedWorker); return new HistoryParquetService(); }

describe('isolated Parquet reader lifecycle', () => {
  it('retires worker and deadline when posting bytes throws synchronously', () => {
    vi.useFakeTimers(); const service = setup(), error = vi.fn(); OwnedWorker.throwOnPost = true;
    service.read(new ArrayBuffer(12), 'signet').subscribe({error});
    expect(error).toHaveBeenCalledOnce(); expect(OwnedWorker.instances[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps original bytes and retires the worker after exactly one verified response', () => {
    const service = setup(), bytes = new ArrayBuffer(12), next = vi.fn(), complete = vi.fn();
    service.read(bytes, 'signet').subscribe({next, complete});
    const worker = OwnedWorker.instances[0]; expect(worker.postMessage).toHaveBeenCalledWith({file: bytes, network: 'signet'});
    worker.onmessage({data: {result: {format: 'parquet', state: {}, txids: []}}});
    expect(next).toHaveBeenCalledOnce(); expect(complete).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce(); expect(bytes.byteLength).toBe(12);
  });
  it('destroys parsing on cancellation and suppresses a late result', () => {
    const service = setup(), next = vi.fn(), subscription = service.read(new ArrayBuffer(12), 'signet').subscribe(next);
    const worker = OwnedWorker.instances[0]; subscription.unsubscribe(); worker.onmessage({data: {result: {format: 'parquet'}}});
    expect(next).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('enforces its fixed local deadline and terminates failed parsing', () => {
    vi.useFakeTimers(); const service = setup(), error = vi.fn();
    service.read(new ArrayBuffer(12), 'signet').subscribe({error});
    vi.advanceTimersByTime(14999); expect(error).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
    expect(error).toHaveBeenCalledOnce(); expect(OwnedWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('rejects excessive bytes before creating a worker', () => {
    const service = setup(), error = vi.fn(); service.read(new ArrayBuffer(64 * 1024 * 1024 + 1), 'signet').subscribe({error});
    expect(error).toHaveBeenCalledOnce(); expect(OwnedWorker.instances).toHaveLength(0);
  });
  it('retires a worker on an error or malformed response', () => {
    const service = setup();
    for (const malformed of [false, true]) {
      const error = vi.fn(); service.read(new ArrayBuffer(12), 'signet').subscribe({error});
      const worker = OwnedWorker.instances.at(-1); if (malformed) { worker.onmessage({data: {}}); } else { worker.onerror(); }
      expect(error).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
    }
  });
});
