#!/usr/bin/env node
// Keeps a local copy of a remote Bitcoin Core RPC cookie current.
//
// Core rewrites its .cookie on every restart. A backend that runs on another
// host with a one-time copy of that file answers 401 from the next restart
// on. The JSON-RPC client re-reads its cookie file after a 401, so the only
// missing piece is a copy that follows the node. This script fetches the
// cookie over SSH, writes it atomically when it changed, and can keep doing
// so on an interval. The cookie value is never printed.
//
//   node scripts/universe/rpc-cookie-sync.mjs \
//     --ssh root@production-backend.netbird.cloud \
//     --remote /var/lib/bitcoind-signet/signet/.cookie \
//     --local D:/universe/mempool/.runtime/signet/rpc.cookie \
//     [--identity ~/.ssh/key] [--interval 30] [--once]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const run = promisify(execFile);

export function parseArgs(argv) {
  const out = { interval: 30, once: false, identity: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--once') { out.once = true; continue; }
    const value = argv[++i];
    if (value === undefined) { throw new Error(`missing value for ${key}`); }
    if (key === '--ssh') { out.ssh = value; }
    else if (key === '--remote') { out.remote = value; }
    else if (key === '--local') { out.local = value; }
    else if (key === '--identity') { out.identity = value; }
    else if (key === '--interval') { out.interval = Number(value); }
    else { throw new Error(`unknown option ${key}`); }
  }
  for (const required of ['ssh', 'remote', 'local']) {
    if (!out[required]) { throw new Error(`--${required} is required`); }
  }
  if (!Number.isFinite(out.interval) || out.interval < 5) { throw new Error('--interval must be at least 5 seconds'); }
  return out;
}

// A Core cookie is "__cookie__:<64 hex>". Anything else is not written.
export function isCookie(text) {
  return /^__cookie__:[0-9a-f]{64}\s*$/.test(text);
}

export async function fetchRemoteCookie({ ssh, remote, identity }, exec = run) {
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'];
  if (identity) { args.push('-i', identity); }
  args.push(ssh, 'cat', remote);
  const { stdout } = await exec('ssh', args, { encoding: 'utf8', timeout: 45_000 });
  if (!isCookie(stdout)) { throw new Error('remote file is not a Core cookie'); }
  return stdout.trim();
}

export async function syncOnce(options, exec = run) {
  const fresh = await fetchRemoteCookie(options, exec);
  let current = null;
  try { current = (await readFile(options.local, 'utf8')).trim(); } catch { /* first run */ }
  if (current === fresh) { return 'unchanged'; }
  await mkdir(dirname(options.local), { recursive: true });
  const tmp = `${options.local}.${process.pid}.tmp`;
  // Exactly the cookie bytes, as Core writes them: the RPC client sends the
  // file content verbatim as the auth string, so a trailing newline breaks it.
  await writeFile(tmp, fresh, { mode: 0o600 });
  await rename(tmp, options.local);
  return current === null ? 'written' : 'refreshed';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stamp = () => new Date().toISOString();
  for (;;) {
    try {
      const result = await syncOnce(options);
      if (result !== 'unchanged') { console.log(`${stamp()} cookie ${result}: ${options.local}`); }
    } catch (error) {
      console.error(`${stamp()} cookie sync failed: ${error.message}`);
    }
    if (options.once) { break; }
    await new Promise(resolve => setTimeout(resolve, options.interval * 1000));
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
