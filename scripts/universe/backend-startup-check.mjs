import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function databaseReady(document) {
  return document?.schemaVersion === 'universe-explorer-capabilities-v1'
    && Object.values(document.features ?? {}).some(feature => feature.enabled
      && feature.routesRegistered
      && feature.dependencies?.some(dependency => dependency.name === 'database'
        && dependency.configured && dependency.reachable));
}

export function readCapabilities(connection, timeout = 3000) {
  return new Promise((resolveRequest, reject) => {
    const request = http.get({ ...connection, path: '/api/v1/capabilities' }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 1_000_000) request.destroy(new Error('Capability response too large'));
      });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Capability request failed');
          resolveRequest(JSON.parse(body));
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    const deadline = setTimeout(() => request.destroy(new Error('Capability deadline exceeded')), timeout);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'mempool-startup-'));
  let child;
  try {
    const config = JSON.parse(await readFile(process.env.MEMPOOL_CONFIG_FILE, 'utf8'));
    const socketPath = join(directory, 'backend.sock');
    config.MEMPOOL.HTTP_HOST = '127.0.0.1';
    config.MEMPOOL.HTTP_PORT = 0;
    config.MEMPOOL.UNIX_SOCKET_PATH = socketPath;
    config.MEMPOOL.SPAWN_CLUSTER_PROCS = 0;
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    child = spawn(process.execPath, ['dist/index.js'], {
      env: { ...process.env, MEMPOOL_CONFIG_FILE: configPath }, stdio: 'ignore',
    });
    let launchError;
    child.on('error', error => { launchError = error; });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (launchError || child.exitCode !== null || child.signalCode !== null) throw new Error('Backend exited before readiness');
      try {
        if (databaseReady(await readCapabilities({ socketPath }))) {
          console.log('Backend HTTP capability confirms its configured database is reachable');
          return;
        }
      } catch { /* Retry until the bounded startup deadline. */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 500));
    }
    throw new Error('Backend did not confirm database readiness before the deadline');
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolveExit => child.once('exit', resolveExit));
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(force);
    }
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
