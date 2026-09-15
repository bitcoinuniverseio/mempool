#!/usr/bin/env node
// Runs a command and keeps its combined output in a bounded set of log files.
//
// A backend left writing to one redirected file grew past 16 GB in five days
// on the Signet validation host. This wrapper rotates at --max-bytes and
// keeps --keep older files (name.1, name.2, ...), so the newest evidence is
// always on disk and the disk is never the thing that fails.
//
//   node scripts/universe/run-logged.mjs --log D:/x/backend.log \
//     [--max-bytes 52428800] [--keep 5] -- node --max-old-space-size=2048 dist/index.js
import { spawn } from 'node:child_process';
import { openSync, writeSync, closeSync, existsSync, renameSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function parseArgs(argv) {
  const out = { maxBytes: 50 * 1024 * 1024, keep: 5, command: [] };
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  out.command = split === -1 ? [] : argv.slice(split + 1);
  for (let i = 0; i < own.length; i += 2) {
    const key = own[i];
    const value = own[i + 1];
    if (value === undefined) { throw new Error(`missing value for ${key}`); }
    if (key === '--log') { out.log = value; }
    else if (key === '--max-bytes') { out.maxBytes = Number(value); }
    else if (key === '--keep') { out.keep = Number(value); }
    else { throw new Error(`unknown option ${key}`); }
  }
  if (!out.log) { throw new Error('--log is required'); }
  if (!out.command.length) { throw new Error('a command after -- is required'); }
  if (!(out.maxBytes > 0) || !(out.keep >= 1)) { throw new Error('--max-bytes and --keep must be positive'); }
  return out;
}

// name.log -> name.log.1 -> ... -> name.log.<keep>; the oldest is dropped.
export function rotate(log, keep) {
  const oldest = `${log}.${keep}`;
  if (existsSync(oldest)) { unlinkSync(oldest); }
  for (let i = keep - 1; i >= 1; i--) {
    const from = `${log}.${i}`;
    if (existsSync(from)) { renameSync(from, `${log}.${i + 1}`); }
  }
  if (existsSync(log)) { renameSync(log, `${log}.1`); }
}

// Synchronous writes on a descriptor: the file is closed before it is
// renamed, which Windows requires, and nothing is buffered when the
// process dies.
export class RotatingLog {
  constructor(log, maxBytes, keep) {
    this.log = log;
    this.maxBytes = maxBytes;
    this.keep = keep;
    mkdirSync(dirname(log), { recursive: true });
    this.size = existsSync(log) ? statSync(log).size : 0;
    this.fd = openSync(log, 'a');
  }

  write(chunk) {
    if (this.size + chunk.length > this.maxBytes) {
      closeSync(this.fd);
      rotate(this.log, this.keep);
      this.size = 0;
      this.fd = openSync(this.log, 'a');
    }
    this.size += chunk.length;
    writeSync(this.fd, chunk);
  }

  close() {
    closeSync(this.fd);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sink = new RotatingLog(options.log, options.maxBytes, options.keep);
  const [command, ...args] = options.command;
  // No shell: the child is the command itself, so a signal to this wrapper
  // reaches the process that matters and nothing is left running behind.
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => sink.write(chunk));
  child.stderr.on('data', chunk => sink.write(chunk));
  const forward = signal => () => { child.kill(signal); };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('exit', (code, signal) => {
    sink.write(Buffer.from(`${new Date().toISOString()} run-logged: child exited code=${code} signal=${signal}\n`));
    sink.close();
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
