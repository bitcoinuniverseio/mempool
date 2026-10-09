import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';
import { TaskDrain } from '../api/task-drain';
import { gracefulShutdown } from '../api/graceful-shutdown';
import * as http from 'http';
import { once } from 'events';
import WebSocket from 'ws';

/** Execute the actual entrypoint class without booting its production singleton. */
function sourceServer(mining: Promise<void>, database: Promise<void>) {
  const events: string[] = [];
  const noop = () => undefined;
  const done = async () => undefined;
  const modules: Record<string, unknown> = {
    './config': { default: { MEMPOOL: { SPAWN_CLUSTER_PROCS: 0 }, LIGHTNING: { ENABLED: false }, REDIS: { ENABLED: false } } },
    './api/task-drain': { TaskDrain },
    './api/common': { Common: { isLiquid: () => false } },
    './api/graceful-shutdown': { gracefulShutdown },
    './database': { default: { drain: () => database, close: async () => { events.push('database-closed'); } } },
    './indexer': { default: { stop: () => { events.push('indexer-stopped'); }, drain: () => mining } },
    './api/statistics/statistics': { default: { stop: noop, drain: done } },
    './tasks/pools-updater': { default: { stop: noop } },
    './api/blocks': { default: { drain: done } },
    './api/disk-cache': { default: { drain: done, $saveCacheToDisk: done } },
    './api/intelligence/templates/template-collector.service': { templateCollectorService: { stopPolling: noop, drain: done } },
    './api/backend-info': { default: { stopPolling: noop, getShortCommitHash: () => 'source-fixture' } },
    './api/capabilities': { default: { preflight: () => [] } },
    './api/admin-adapter/admin-adapter.runtime': { runtimeMetrics: { stop: noop } },
    './api/intelligence/private-submission/private-relay.runtime': { stopPrivateRelayWorker: noop, drainPrivateRelayWorker: done },
    './api/intelligence/time-machine/time-machine.service': { timeMachineService: { closeHistory: async () => { events.push('history-flushed'); } } },
    './api/intelligence/events/intelligence-event-bus': { eventBus: { drain: done } },
    './api/fractal/fractal.runtime': { closeFractalRuntime: done },
    './api/mempool-blocks': { default: { closeSelectionWorker: done } },
    './api/bitcoin/bitcoin-api-factory': { default: { closeTransport: () => { events.push('transport-closed'); } } },
    './logger': { default: { debug: noop, notice: noop, err: noop } },
  };
  const source = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
  const bootstrap = '((): Server => new Server())();';
  if (!source.endsWith(bootstrap + '\r\n') && !source.endsWith(bootstrap + '\n')) throw new Error('Source bootstrap contract changed');
  const isolated = source.replace(bootstrap, '') + '\n(globalThis as any).TestServer = Server;';
  const code = ts.transpileModule(isolated, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const processState = { exit: jest.fn(), on: jest.fn(), env: {}, exitCode: undefined as number | undefined };
  const sandbox: any = { exports: {}, process: processState, setInterval, clearInterval, setTimeout, clearTimeout,
    require: (name: string) => {
      const module = modules[name] as Record<string, unknown> | undefined ?? {};
      module.__esModule = true;
      return module;
    } };
  vm.runInNewContext(code, sandbox);
  const server = Object.create(sandbox.TestServer.prototype);
  server.shuttingDown = false;
  server.work = new TaskDrain();
  server.timers = new Set();
  server.mainLoopWatchdog = { end: noop };
  return { server, events, processState, modules };
}

describe('actual native signal shutdown source', () => {
  it('does not exit or close resources before controlled late mining and real driver completion', /** @asyncUnsafe Jest owns the test. */ async () => {
    jest.useFakeTimers();
    let completeMining!: () => void;
    let completeDriver!: () => void;
    const mining = new Promise<void>(resolve => { completeMining = resolve; });
    const driver = new Promise<void>(resolve => { completeDriver = resolve; });
    const { server, events, processState } = sourceServer(mining, driver);
    server.forceExit('SIGTERM');
    server.forceExit('SIGTERM');
    jest.advanceTimersByTime(6000);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(events).toEqual(['indexer-stopped']);
    expect(processState.exit).not.toHaveBeenCalled();
    expect(processState.exitCode).toBeUndefined();
    completeMining();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(events).toEqual(['indexer-stopped']);
    completeDriver();
    for (let i = 0; i < 32; i++) await Promise.resolve();
    expect(events).toEqual(['indexer-stopped', 'history-flushed', 'database-closed', 'transport-closed']);
    expect(processState.exit).not.toHaveBeenCalled();
    expect(processState.exitCode).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('holds an enabled independent owner instead of calling an incomplete drain success', /** @asyncUnsafe Jest owns the test. */ async () => {
    jest.useFakeTimers();
    const { server, events, processState, modules } = sourceServer(Promise.resolve(), Promise.resolve());
    (modules['./config'] as any).default.LIGHTNING.ENABLED = true;
    server.forceExit('SIGTERM');
    for (let i = 0; i < 32; i++) await Promise.resolve();
    expect(events).toEqual(['indexer-stopped']);
    expect(processState.exit).not.toHaveBeenCalled();
    expect(processState.exitCode).toBe(1);
    expect(jest.getTimerCount()).toBe(1);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('retains a diagnostic hold on actual pool close failure', /** @asyncUnsafe Jest owns the test. */ async () => {
    jest.useFakeTimers();
    const { server, events, processState, modules } = sourceServer(Promise.resolve(), Promise.resolve());
    (modules['./database'] as any).default.close = async () => { throw new Error('pool close failed'); };
    server.forceExit('SIGTERM');
    for (let i = 0; i < 32; i++) await Promise.resolve();
    expect(events).toEqual(['indexer-stopped', 'history-flushed']);
    expect(processState.exit).not.toHaveBeenCalled();
    expect(processState.exitCode).toBe(1);
    expect(jest.getTimerCount()).toBe(1);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('drains real HTTP and upgraded WebSocket connections without a shutdown phase deadlock', /** @asyncUnsafe Jest owns the test. */ async () => {
    const nativeHttp = http.createServer((_request, response) => {
      setTimeout(() => response.end('completed'), 15);
    });
    const nativeWs = new WebSocket.Server({ server: nativeHttp });
    await new Promise<void>(resolve => nativeHttp.listen(0, '127.0.0.1', resolve));
    const port = (nativeHttp.address() as { port: number }).port;
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(client, 'open');
    const response = new Promise<void>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}`, result => {
        result.resume();
        result.on('end', resolve);
      }).on('error', reject);
    });
    const requestArrived = once(nativeHttp, 'request');
    await requestArrived;
    const wsClosed = once(client, 'close');
    const httpClosed = once(nativeHttp, 'close');
    const { server, events, processState } = sourceServer(Promise.resolve(), Promise.resolve());
    server.server = nativeHttp;
    server.wss = nativeWs;
    server.forceExit('SIGTERM');
    await Promise.all([response, wsClosed, httpClosed]);
    for (let i = 0; i < 32; i++) await Promise.resolve();
    expect(events).toContain('database-closed');
    expect(processState.exit).not.toHaveBeenCalled();
    expect(processState.exitCode).toBe(0);
  });

  it('does not admit a database owner after actual startup resumes across a shutdown signal', /** @asyncUnsafe Jest owns the test. */ async () => {
    jest.useFakeTimers();
    let startupReady!: () => void;
    const startup = new Promise<void>(resolve => { startupReady = resolve; });
    const { server, events, processState, modules } = sourceServer(Promise.resolve(), Promise.resolve());
    (modules['./config'] as any).default.DATABASE = { ENABLED: true };
    (modules['./api/fractal/fractal.runtime'] as any).startFractalRuntime = () => startup;
    const acquireOwner = jest.fn();
    (modules['./database'] as any).default.getPidLock = acquireOwner;
    const startupWork = server.work.track(server.startServer());
    server.forceExit('SIGTERM');
    jest.advanceTimersByTime(6000);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(events).toEqual(['indexer-stopped']);
    expect(acquireOwner).not.toHaveBeenCalled();
    expect(processState.exitCode).toBeUndefined();
    startupReady();
    await startupWork;
    for (let i = 0; i < 32; i++) await Promise.resolve();
    expect(acquireOwner).not.toHaveBeenCalled();
    expect(server.server).toBeUndefined();
    expect(server.wss).toBeUndefined();
    expect(server.timers.size).toBe(0);
    expect(processState.exit).not.toHaveBeenCalled();
    expect(processState.exitCode).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
