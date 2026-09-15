import { execFile } from 'child_process';
import { resolve } from 'path';
import { isPointCompressed } from 'tiny-secp256k1';

export interface CompiledPolicy {
  miniscript: string;
  descriptor: string;
  script_hex: string;
  max_witness_size: number;
  worst_case_satisfaction_weight: number;
  properties: { non_malleable: boolean; timelock_safe: boolean };
  engine: string;
  scope: string;
}

export class CompilerError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

let active = 0;

export async function inspectTaprootTree(descriptor: string, index: number): Promise<any> {
  if (descriptor.length > 16000 || !Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) throw new CompilerError('invalid-descriptor', 'Unsupported descriptor size or derivation index.', 400);
  if (active >= 2) throw new CompilerError('compiler-busy', 'The bounded descriptor engine is busy; retry shortly.', 429);
  const executable = process.env.UNIVERSE_WORKBENCH_ENGINE || resolve(__dirname, '../../../../../rust/workbench-engine/target/release/universe-workbench-engine' + (process.platform === 'win32' ? '.exe' : ''));
  active++;
  try {
    return await new Promise((accept, reject) => {
      const child = execFile(executable, ['--taproot'], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) return reject(new CompilerError('unavailable-tree-engine', 'The pinned engine could not inspect this Taproot descriptor.', 503));
        try {
          const tree = JSON.parse(stdout);
          if (tree.engine !== 'rust-miniscript 12.3.7' || !/^[0-9a-f]{64}$/.test(tree.internal_key) || !/^5120[0-9a-f]{64}$/.test(tree.script_pub_key)
            || !Array.isArray(tree.leaves) || tree.leaves.length > 128 || !tree.leaves.every(leaf => leaf.commitment_verified === true)) throw new Error('invalid tree');
          accept(tree);
        } catch { reject(new CompilerError('invalid-tree-engine-result', 'The pinned tree engine returned an invalid commitment.', 503)); }
      });
      child.stdin?.on('error', () => { /* Exit handled by callback. */ });
      child.stdin?.end(JSON.stringify({ descriptor, index }));
    });
  } finally { active--; }
}

export async function compilePolicy(policy: string): Promise<CompiledPolicy> {
  if (typeof policy !== 'string' || !policy.trim() || policy.length > 4096 || !/^[a-zA-Z0-9_(),@:\s]+$/.test(policy)) throw new CompilerError('invalid-policy', 'A concrete public-key policy of at most 4096 characters is required.', 400);
  for (const match of policy.matchAll(/\bpk\(([^)]+)\)/g)) {
    if (!/^0[23][0-9a-f]{64}$/i.test(match[1]) || !isPointCompressed(Buffer.from(match[1], 'hex'))) throw new CompilerError('invalid-policy', 'Policy pk() arguments must be compressed public keys, not private keys or placeholders.', 400);
  }
  let depth = 0;
  for (const char of policy) {
    if (char === '(' && ++depth > 32) throw new CompilerError('invalid-policy', 'Policy nesting exceeds 32 levels.', 400);
    if (char === ')' && --depth < 0) throw new CompilerError('invalid-policy', 'Policy parentheses are unbalanced.', 400);
  }
  if (depth !== 0) throw new CompilerError('invalid-policy', 'Policy parentheses are unbalanced.', 400);
  if (active >= 2) throw new CompilerError('compiler-busy', 'The bounded policy compiler is busy; retry shortly.', 429);
  const executable = process.env.UNIVERSE_WORKBENCH_ENGINE || resolve(__dirname, '../../../../../rust/workbench-engine/target/release/universe-workbench-engine' + (process.platform === 'win32' ? '.exe' : ''));
  active++;
  try {
    return await new Promise<CompiledPolicy>((accept, reject) => {
      const child = execFile(executable, [], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }, (error, stdout) => {
        if (error) {
          if ((error as { code?: unknown }).code === 2) return reject(new CompilerError('invalid-policy', 'The pinned compiler rejected this policy or its safety/resource constraints.', 400));
          return reject(new CompilerError('unavailable-compiler', 'The pinned Miniscript compiler could not complete. Build rust/workbench-engine or configure its executable path.', 503));
        }
        try {
          const result = JSON.parse(stdout);
          if (result.engine !== 'rust-miniscript 12.3.7' || typeof result.miniscript !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(result.script_hex)
            || !Number.isSafeInteger(result.max_witness_size) || !Number.isSafeInteger(result.worst_case_satisfaction_weight)
            || typeof result.properties?.non_malleable !== 'boolean' || typeof result.properties?.timelock_safe !== 'boolean') throw new Error('Invalid compiler response');
          accept(result);
        } catch { reject(new CompilerError('invalid-compiler-result', 'The pinned compiler returned an invalid result.', 503)); }
      });
      child.stdin?.on('error', () => { /* Exit is handled by the bounded exec callback. */ });
      child.stdin?.end(policy);
    });
  } finally { active--; }
}
