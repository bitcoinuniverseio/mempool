import { execFile } from 'child_process';
import { resolve } from 'path';
import { CompilerError } from './miniscript-compiler';

export type TransactionScriptContext = { transaction_hex: string; previous_script_hex: string; previous_amount_sats: number } | {
  transaction_hex: string; input_index: number;
  previous_outputs: Array<{ txid: string; vout: number; script_hex: string; amount_sats: number }>;
};
let active = 0;
export async function verifyTransactionScripts(transactions: TransactionScriptContext[]) {
  const input = JSON.stringify({ transactions });
  if (!transactions.length || transactions.length > 512 || input.length > 2100000) throw new CompilerError('invalid-contexts', 'Transaction context count or size exceeds the supported bound.', 400);
  if (active >= 2) throw new CompilerError('script-engine-busy', 'The bounded transaction script engine is busy.', 503);
  active++;
  try {
    return await new Promise<{ engine: string; scope: string; results: Array<{ script_valid: boolean; error?: string }> }>((accept, reject) => {
      const executable = process.env.UNIVERSE_SCRIPT_TRACE_ENGINE || resolve(__dirname, '../../../../../rust/script-trace/script-trace' + (process.platform === 'win32' ? '.exe' : ''));
      const child = execFile(executable, ['--transactions'], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) return reject(new CompilerError(error.code === 2 ? 'invalid-transaction-context' : 'unavailable-script-engine', error.code === 2 ? 'The native engine rejected the supplied transaction contexts.' : 'The transaction script engine is unavailable.', error.code === 2 ? 400 : 503));
        try {
          const result = JSON.parse(stdout);
          if (result.engine !== 'btcd txscript 1c55c7c18179' || !Array.isArray(result.results) || result.results.length !== transactions.length || !result.results.every(item => typeof item.script_valid === 'boolean')) throw Error('Invalid result');
          accept(result);
        } catch { reject(new CompilerError('invalid-script-result', 'The native engine returned invalid transaction evidence.', 503)); }
      });
      child.stdin?.on('error', () => { /* Bounded callback handles process errors. */ });
      child.stdin?.end(input);
    });
  } finally { active--; }
}
