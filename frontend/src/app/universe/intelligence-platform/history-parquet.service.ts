import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HISTORY_PARQUET_MAX_BYTES } from './history-parquet';

@Injectable({ providedIn: 'root' })
export class HistoryParquetService {
  read(file: ArrayBuffer, network: string): Observable<any> {
    return new Observable(observer => {
      if (!(file instanceof ArrayBuffer) || file.byteLength > HISTORY_PARQUET_MAX_BYTES) { observer.error(new Error('Retained Parquet export exceeds the supported size.')); return; }
      let worker: Worker;
      try { worker = new Worker(new URL('./history-parquet.worker', import.meta.url), { type: 'module' }); }
      catch { observer.error(new Error('The isolated Parquet reader could not start.')); return; }
      const timer = setTimeout(() => observer.error(new Error('Retained Parquet verification exceeded the local time limit.')), 15000);
      worker.onerror = () => observer.error(new Error('The isolated Parquet reader failed.'));
      worker.onmessage = event => {
        if (event.data?.error || !event.data?.result) { observer.error(new Error('Retained Parquet verification failed.')); return; }
        observer.next(event.data.result); observer.complete();
      };
      // Keep the original bytes for the download after evidence verification.
      try { worker.postMessage({ file, network }); }
      catch {
        clearTimeout(timer); worker.terminate(); observer.error(new Error('The retained Parquet bytes could not be sent to the isolated reader.')); return;
      }
      return () => { clearTimeout(timer); worker.terminate(); };
    });
  }
}
