import { Worker } from 'worker_threads';

/**
 * Runs on its own thread, so it still fires when the main thread is blocked
 * inside a synchronous call (writeFileSync on a stalled disk) and no timer
 * there can run. It logs the last step the main thread reported, then kills
 * the process the way an operator's kill -9 would.
 */
export const BACKSTOP_SOURCE = [
  "const { parentPort, workerData } = require('worker_threads');",
  "const { writeSync } = require('fs');",
  "let last = 'not reported';",
  "parentPort.on('message', (description) => { last = String(description); });",
  'setTimeout(() => {',
  "  writeSync(2, 'Shutdown backstop: the main thread did not exit within ' + workerData.delayMs / 1000 + ' s; last reported step: ' + last + '. Killing the process.' + String.fromCharCode(10));",
  "  process.kill(workerData.pid, 'SIGKILL');",
  '}, workerData.delayMs);',
].join('\n');

/** Starts the backstop; the returned function reports the current shutdown step to it. */
export function startShutdownBackstop(delayMs: number): (description: string) => void {
  const worker = new Worker(BACKSTOP_SOURCE, { eval: true, workerData: { pid: process.pid, delayMs } });
  worker.unref();
  return description => worker.postMessage(description);
}
