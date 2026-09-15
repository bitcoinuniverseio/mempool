import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, rotate, RotatingLog } from './run-logged.mjs';

test('arguments: log and a command after -- are required', () => {
  assert.throws(() => parseArgs(['--log', 'x']), /command after --/);
  assert.throws(() => parseArgs(['--', 'node']), /--log is required/);
  const parsed = parseArgs(['--log', 'x.log', '--max-bytes', '10', '--keep', '2', '--', 'node', '-e', '1']);
  assert.deepEqual(parsed, { log: 'x.log', maxBytes: 10, keep: 2, command: ['node', '-e', '1'] });
});

test('output rotates at the byte ceiling and never keeps more than --keep old files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'run-logged-'));
  try {
    const log = join(dir, 'app.log');
    const sink = new RotatingLog(log, 20, 2);
    for (let i = 0; i < 10; i++) { sink.write(Buffer.from(`line ${i} xxxxxxxx\n`)); }
    sink.close();
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['app.log', 'app.log.1', 'app.log.2']);
    // The newest lines are in the live file; the oldest were dropped, not kept forever.
    assert.match(await readFile(log, 'utf8'), /line 9/);
    assert.doesNotMatch(await readFile(join(dir, 'app.log.2'), 'utf8'), /line 0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rotate shifts names by one and drops the oldest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'run-logged-'));
  try {
    const log = join(dir, 'a.log');
    for (const name of ['a.log', 'a.log.1', 'a.log.2']) {
      const s = new RotatingLog(join(dir, name), 1e9, 1); s.write(Buffer.from(name)); s.close();
    }
    rotate(log, 2);
    assert.equal(existsSync(log), false);
    assert.equal(await readFile(join(dir, 'a.log.1'), 'utf8'), 'a.log');
    assert.equal(await readFile(join(dir, 'a.log.2'), 'utf8'), 'a.log.1');
    assert.equal(existsSync(join(dir, 'a.log.3')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
