import { spawnSync } from 'child_process';
import { BACKSTOP_SOURCE } from './shutdown-backstop';

/** Runs the actual backstop source in a child whose main thread then behaves as given. */
function child(mainThread: string): { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; elapsedMs: number } {
  const script = [
    "const { Worker } = require('worker_threads');",
    "const worker = new Worker(process.env.BACKSTOP_SOURCE, { eval: true, workerData: { pid: process.pid, delayMs: 300 } });",
    'worker.unref();',
    "worker.postMessage('flushHistory (waiting on: disk cache save)');",
    mainThread,
  ].join('\n');
  const started = Date.now();
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, BACKSTOP_SOURCE }, encoding: 'utf8', timeout: 20_000 });
  return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, elapsedMs: Date.now() - started };
}

describe('off-thread shutdown backstop', () => {
  it('kills a process whose main thread is blocked in a synchronous call and names the last step', () => {
    const result = child("const end = Date.now() + 15000; while (Date.now() < end) {} process.stdout.write('survived');");
    expect(result.stdout).toBe('');
    expect(result.signal === 'SIGKILL' || (result.status !== null && result.status !== 0)).toBe(true);
    expect(result.stderr).toContain('Shutdown backstop: the main thread did not exit within 0.3 s; last reported step: flushHistory (waiting on: disk cache save). Killing the process.');
    expect(result.elapsedMs).toBeLessThan(10_000);
  });

  it('never holds or kills a process that exits on its own', () => {
    const result = child("process.stdout.write('exited cleanly');");
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('exited cleanly');
    expect(result.stderr).toBe('');
  });
});
