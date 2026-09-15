import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, isCookie, syncOnce } from './rpc-cookie-sync.mjs';

const cookie = '__cookie__:' + 'ab'.repeat(32);
const rotated = '__cookie__:' + 'cd'.repeat(32);

test('arguments: ssh, remote and local are required; interval has a floor', () => {
  assert.throws(() => parseArgs(['--ssh', 'x']), /--remote is required/);
  assert.throws(() => parseArgs(['--ssh', 'x', '--remote', 'r', '--local', 'l', '--interval', '1']), /at least 5/);
  const parsed = parseArgs(['--ssh', 'x', '--remote', 'r', '--local', 'l', '--once']);
  assert.equal(parsed.once, true);
  assert.equal(parsed.interval, 30);
});

test('only a real Core cookie is accepted', () => {
  assert.equal(isCookie(cookie + '\n'), true);
  assert.equal(isCookie('rpcuser:rpcpass'), false);
  assert.equal(isCookie('__cookie__:short'), false);
  assert.equal(isCookie(''), false);
});

test('the local copy follows the remote cookie and is rewritten only on change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cookie-sync-'));
  try {
    const local = join(dir, 'nested', 'rpc.cookie');
    let remote = cookie;
    const calls = [];
    const exec = async (cmd, args) => { calls.push([cmd, args]); return { stdout: remote + '\n' }; };
    const options = { ssh: 'host', remote: '/r/.cookie', local, identity: '/k' };

    assert.equal(await syncOnce(options, exec), 'written');
    // Exact bytes, no trailing newline: the RPC client sends the file content as the auth string.
    assert.equal(await readFile(local, 'utf8'), cookie);
    assert.equal(await syncOnce(options, exec), 'unchanged');

    remote = rotated; // the node restarted
    assert.equal(await syncOnce(options, exec), 'refreshed');
    assert.equal((await readFile(local, 'utf8')).trim(), rotated);

    assert.deepEqual(calls[0], ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-i', '/k', 'host', 'cat', '/r/.cookie']]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a remote reply that is not a cookie leaves the local copy untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cookie-sync-'));
  try {
    const local = join(dir, 'rpc.cookie');
    const options = { ssh: 'host', remote: '/r/.cookie', local, identity: null };
    await syncOnce(options, async () => ({ stdout: cookie }));
    await assert.rejects(syncOnce(options, async () => ({ stdout: 'cat: /r/.cookie: No such file' })), /not a Core cookie/);
    assert.equal((await readFile(local, 'utf8')).trim(), cookie);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
