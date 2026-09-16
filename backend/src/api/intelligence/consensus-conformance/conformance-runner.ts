import { execFile, spawn, ChildProcess } from 'child_process';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createServer } from 'net';
import { request as httpRequest } from 'http';
import { performance } from 'perf_hooks';
import { Transaction } from 'bitcoinjs-lib';
import { ConformanceManifest } from './conformance-manifest';
import { CampaignInput, parserCorpus } from './conformance-corpus';
import { CAMPAIGN_LIMITS, ConformanceEvidenceError } from './conformance-evidence';
import { NODE_ENGINE_CODE } from './conformance-node-code';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function childJson(path: string, args: string[], input: unknown) {
  const started = performance.now();
  const data: any = await new Promise((resolve, reject) => {
    const child = execFile(
      path,
      args,
      { windowsHide: true, timeout: CAMPAIGN_LIMITS.timeoutMs, maxBuffer: CAMPAIGN_LIMITS.processOutputBytes },
      (error, stdout) => {
        if (error)
          return reject(
            new ConformanceEvidenceError(
              error.killed ? 'runner-timeout' : 'runner-failed',
              'The isolated engine failed to return a bounded result.'
            )
          );
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new ConformanceEvidenceError('invalid-engine-result', 'Engine did not return JSON.'));
        }
      }
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(JSON.stringify(input));
  });
  return { data, elapsed: performance.now() - started };
}
export class IsolatedCore {
  private child!: ChildProcess;
  private cookie = '';
  private port!: number;
  private stopped = false;
  constructor(
    private readonly manifest: ConformanceManifest,
    readonly directory: string
  ) {}
  async start() {
    this.port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as any).port;
        server.close(() => resolve(port));
      });
    });
    mkdirSync(this.directory, { recursive: true });
    this.child = spawn(
      this.manifest.core.path,
      [
        '-datadir=' + this.directory,
        '-regtest',
        '-server=1',
        '-listen=0',
        '-networkactive=0',
        '-discover=0',
        '-dnsseed=0',
        '-rpcbind=127.0.0.1',
        '-rpcallowip=127.0.0.1',
        '-rpcport=' + this.port,
        '-fallbackfee=0.00001',
        '-printtoconsole=0',
      ],
      { windowsHide: true, stdio: 'ignore' }
    );
    let launchError = false;
    this.child.on('error', () => {
      launchError = true;
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (launchError || this.child.exitCode !== null)
        throw new ConformanceEvidenceError('isolated-core-failed', 'The task-owned Core runner failed to start.');
      try {
        this.cookie = readFileSync(join(this.directory, 'regtest', '.cookie'), 'utf8').trim();
        const info: any = await this.rpc('getnetworkinfo');
        if (info.version !== 290000)
          throw new ConformanceEvidenceError('engine-version-mismatch', 'Expected Bitcoin Core 29.0.');
        if (
          (await this.rpc('getblockhash', [0])) !== '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'
        )
          throw new ConformanceEvidenceError(
            'isolated-network-mismatch',
            'The isolated runner is not on the expected regtest genesis.'
          );
        return;
      } catch (e: any) {
        if (e instanceof ConformanceEvidenceError) throw e;
        await sleep(100);
      }
    }
    throw new ConformanceEvidenceError('isolated-core-timeout', 'The task-owned Core runner did not become ready.');
  }
  rpc(method: string, params: any[] = [], wallet?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: this.port,
          path: wallet ? '/wallet/' + encodeURIComponent(wallet) : '/',
          method: 'POST',
          auth: this.cookie,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: 5000,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
            if (text.length > 4 * 1024 * 1024) res.destroy(Error('RPC response exceeds bound'));
          });
          res.on('error', reject);
          res.on('end', () => {
            try {
              const result = JSON.parse(text);
              if (result.error)
                reject(
                  Object.assign(Error(String(result.error.message).slice(0, 256)), { rpcCode: result.error.code })
                );
              else resolve(result.result);
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(Error('RPC timed out')));
      req.on('error', reject);
      req.end(body);
    });
  }
  async close() {
    if (this.stopped || !this.child) return;
    this.stopped = true;
    try {
      await this.rpc('stop');
    } catch {}
    const deadline = Date.now() + 5000;
    while (this.child.exitCode === null && Date.now() < deadline) await sleep(50);
    if (this.child.exitCode === null) {
      this.child.kill();
      await Promise.race([new Promise((resolve) => this.child.once('exit', resolve)), sleep(2000)]);
    }
  }
  async scriptCorpus(): Promise<CampaignInput[]> {
    await this.rpc('createwallet', ['conformance']);
    const address = await this.rpc('getnewaddress', [], 'conformance');
    await this.rpc('generatetoaddress', [101, address]);
    const coins = await this.rpc('listunspent', [101, 9999999, [], true], 'conformance');
    const coin = coins[0];
    if (!coin) throw Error('No mature isolated funding coin');
    const destination = await this.rpc('getnewaddress', [], 'conformance');
    const unsigned = await this.rpc('createrawtransaction', [
      [{ txid: coin.txid, vout: coin.vout }],
      { [destination]: 49.9999 },
    ]);
    const signed = await this.rpc('signrawtransactionwithwallet', [unsigned], 'conformance');
    if (!signed.complete) throw Error('Isolated signature missing');
    const previous_outputs = [
      { txid: coin.txid, vout: coin.vout, script_hex: coin.scriptPubKey, amount_sats: Math.round(coin.amount * 1e8) },
    ];
    const valid = Transaction.fromHex(signed.hex),
      bad = Transaction.fromHex(signed.hex);
    const signature = Buffer.from(bad.ins[0].witness[0]);
    signature[10] ^= 1;
    bad.setWitness(0, [signature, ...bad.ins[0].witness.slice(1)]);
    const tip = await this.rpc('getbestblockhash');
    return [
      {
        id: 'valid-p2wpkh',
        title: 'Actual mature P2WPKH spend with valid signature',
        hex: valid.toHex(),
        context: { previous_outputs, tip },
        expected: { 'bitcoin-core': 'accepted', btcd: 'accepted' },
      },
      {
        id: 'invalid-p2wpkh-signature',
        title: 'Independent signature-byte mutation rejected by both engines',
        hex: bad.toHex(),
        context: { previous_outputs, tip },
        expected: { 'bitcoin-core': 'rejected', btcd: 'rejected' },
      },
    ];
  }
}
export async function runCorpus(m: ConformanceManifest, target: string, inputs: CampaignInput[], core?: IsolatedCore) {
  if (
    inputs.length === 0 ||
    inputs.length > CAMPAIGN_LIMITS.inputs ||
    inputs.some((i) => !/^([0-9a-f]{2})*$/i.test(i.hex) || i.hex.length > CAMPAIGN_LIMITS.inputBytes * 2)
  )
    throw new ConformanceEvidenceError('invalid-corpus', 'Corpus exceeds executable bounds.');
  const rows: any[] = inputs.map((input) => ({ input, outcomes: [] }));
  if (target !== 'script_verify') {
    for (const [id, path, args] of [
      ['rust-bitcoin', m.rust.path, []],
      [
        'bitcoinjs',
        m.node.path,
        ['-e', NODE_ENGINE_CODE, require.resolve('bitcoinjs-lib'), require.resolve('varuint-bitcoin')],
      ],
    ] as [string, string, string[]][]) {
      const { data, elapsed } = await childJson(path, args, { target, inputs });
      if (!Array.isArray(data.results) || data.results.length !== inputs.length)
        throw new ConformanceEvidenceError('invalid-engine-result', 'Engine returned an incomplete corpus.');
      for (let n = 0; n < inputs.length; n++) {
        const item = data.results[n];
        if (item.id !== inputs[n].id || !['accepted', 'rejected', 'unsupported'].includes(item.outcome?.status))
          throw new ConformanceEvidenceError('invalid-engine-result', 'Engine result is not bound to the corpus.');
        rows[n].outcomes.push({
          implementation_id: id,
          ...item.outcome,
          execution_time_ms:
            typeof item.execution_time_ms === 'number' ? item.execution_time_ms : elapsed / inputs.length,
          timing_scope:
            typeof item.execution_time_ms === 'number' ? 'individual-input' : 'batch-wall-time-divided-by-input-count',
        });
      }
    }
  }
  if (target === 'transaction_parse' || target === 'script_verify') {
    if (!core) throw Error('Isolated Core required');
    for (const row of rows) {
      const start = performance.now();
      let outcome: any;
      try {
        if (target === 'transaction_parse') {
          const tx = await core.rpc('decoderawtransaction', [row.input.hex]);
          outcome = { status: 'accepted', txid: tx.txid, wtxid: tx.hash };
        } else {
          if ((await core.rpc('getbestblockhash')) !== row.input.context.tip)
            throw new ConformanceEvidenceError('replay-context-mismatch', 'Isolated script context chain tip changed.');
          const [result] = await core.rpc('testmempoolaccept', [[row.input.hex]]);
          outcome = {
            status: result.allowed ? 'accepted' : 'rejected',
            error: result['reject-reason'] ?? result['package-error'],
          };
        }
      } catch (e: any) {
        if (e instanceof ConformanceEvidenceError) throw e;
        if (typeof e.rpcCode !== 'number')
          throw new ConformanceEvidenceError(
            'isolated-core-rpc-failed',
            'Core transport failed during campaign execution.'
          );
        outcome = { status: 'rejected', error: String(e.message).slice(0, 256) };
      }
      row.outcomes.push({
        implementation_id: 'bitcoin-core',
        ...outcome,
        execution_time_ms: performance.now() - start,
        timing_scope: 'individual-rpc-wall-time',
      });
    }
  }
  if (target === 'script_verify') {
    const { data, elapsed } = await childJson(m.btcd.path, ['--transactions'], {
      transactions: inputs.map((i) => ({
        transaction_hex: i.hex,
        input_index: 0,
        previous_outputs: i.context.previous_outputs,
      })),
    });
    if (
      !Array.isArray(data.results) ||
      data.results.length !== inputs.length ||
      data.results.some((r) => typeof r.script_valid !== 'boolean')
    )
      throw new ConformanceEvidenceError('invalid-engine-result', 'Script engine returned invalid outcomes.');
    rows.forEach((row, n) =>
      row.outcomes.push({
        implementation_id: 'btcd',
        status: data.results[n].script_valid ? 'accepted' : 'rejected',
        error: data.results[n].error,
        execution_time_ms: elapsed / inputs.length,
        timing_scope: 'batch-wall-time-divided-by-input-count',
      })
    );
  }
  return rows;
}
export { parserCorpus };
