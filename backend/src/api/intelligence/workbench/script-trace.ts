import { execFile } from 'child_process';
import { resolve } from 'path';
import { script } from 'bitcoinjs-lib';
import { CompilerError } from './miniscript-compiler';

export interface ScriptTrace {
  steps: Array<{ step: number; opcode: string; stack_before: string[]; stack_after: string[]; description: string }>;
  count: number;
  completed: boolean;
  script_succeeded: boolean;
  error?: string;
  scope: string;
  engine: string;
}
let active = 0;

export async function traceScript(scriptHex: string, witness: string[]): Promise<ScriptTrace> {
  if (typeof scriptHex !== 'string' || scriptHex.length > 20000 || !/^(?:[0-9a-f]{2})+$/i.test(scriptHex)
    || !Array.isArray(witness) || witness.length > 100 || !witness.every(item => typeof item === 'string' && item.length <= 1040 && /^(?:[0-9a-f]{2})*$/i.test(item))) throw new CompilerError('invalid-script', 'Provide bounded script hex and at most 100 initial stack elements of at most 520 bytes each.', 400);
  const bytes = Buffer.from(scriptHex, 'hex');
  const chunks = script.decompile(bytes);
  if (!chunks) throw new CompilerError('invalid-script', 'Script contains a truncated data push.', 400);
  const contextual = new Set([0xac, 0xad, 0xae, 0xaf, 0xba, 0xb1, 0xb2]);
  if (chunks.some(chunk => typeof chunk === 'number' && contextual.has(chunk))
    || (bytes.length >= 4 && bytes.length <= 42 && (bytes[0] === 0 || bytes[0] >= 0x51 && bytes[0] <= 0x60) && bytes[1] === bytes.length - 2)
    || (bytes.length === 23 && bytes[0] === 0xa9 && bytes[1] === 20 && bytes[22] === 0x87)) throw new CompilerError('transaction-context-required', 'Signatures, timelocks and wrapped output programs require transaction-context verification. Supply a standalone script for this stack tracer.', 400);
  const input = JSON.stringify({ script_hex: scriptHex, witness });
  if (input.length > 65536) throw new CompilerError('invalid-script', 'Combined script and initial stack exceed 64 KiB.', 400);
  if (active >= 2) throw new CompilerError('script-engine-busy', 'The bounded script engine is busy; retry shortly.', 429);
  const executable = process.env.UNIVERSE_SCRIPT_TRACE_ENGINE || resolve(__dirname, '../../../../../rust/script-trace/script-trace' + (process.platform === 'win32' ? '.exe' : ''));
  active++;
  try {
    return await new Promise((accept, reject) => {
      const child = execFile(executable, [], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) return reject(new CompilerError((error as { code?: unknown }).code === 2 ? 'invalid-script' : 'unavailable-script-engine',
          (error as { code?: unknown }).code === 2 ? 'The engine rejected the supplied standalone script.' : 'The pinned script tracer could not complete; build rust/script-trace or configure its executable path.',
          (error as { code?: unknown }).code === 2 ? 400 : 503));
        try {
          const result = JSON.parse(stdout);
          if (result.engine !== 'btcd txscript 1c55c7c18179' || !Array.isArray(result.steps) || result.steps.length > 256
            || result.count !== result.steps.length || typeof result.completed !== 'boolean' || typeof result.script_succeeded !== 'boolean') throw new Error('Invalid trace');
          accept(result);
        } catch { reject(new CompilerError('invalid-script-engine-result', 'The pinned script tracer returned an invalid result.', 503)); }
      });
      child.stdin?.on('error', () => { /* Process exit handled above. */ });
      child.stdin?.end(input);
    });
  } finally { active--; }
}
